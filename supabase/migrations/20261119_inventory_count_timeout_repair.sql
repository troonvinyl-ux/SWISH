-- Repair swish_inventory_tab_counts statement timeouts without changing inventory or RLS.
-- Scope skinny records first; deduplicate listing observations once, not once per item.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
create index if not exists idx_orders_tenant_sale on public.orders(tenant_id,sale_id);
create index if not exists idx_orders_tenant_external_order on public.orders(tenant_id,external_order_id);
create index if not exists idx_ebay_returns_tenant_item on public.ebay_returns(tenant_id,item_id);
create index if not exists idx_ebay_returns_tenant_order on public.ebay_returns(tenant_id,ebay_order_id);

create or replace function public.swish_inventory_tab_counts(p_tenant_id uuid,p_niche_id text)
returns jsonb language plpgsql stable security invoker
set search_path=pg_catalog,public set statement_timeout='10s' set jit=off as $$
begin
 if auth.uid() is null or not public.swish_can_access_niche(p_tenant_id,p_niche_id) then
  raise exception 'Inventory niche access denied' using errcode='42501';
 end if;
 return (
  with scoped_items as materialized (
   select i.id,i.tenant_id,i.status,i.sold_at,i.updated_at,coalesce(i.quantity,1) as quantity,
    i.attributes->>'_ebay_status_source' as status_source,
    i.attributes->>'_ebay_listing_status' as ebay_status,
    i.attributes->>'_ebay_quantity_remaining' as remaining
   from public.items i
   where i.tenant_id=p_tenant_id and public.swish_specialist_niche(i.specialist_id)=p_niche_id
  ), ranked_listings as materialized (
   select l.id,l.tenant_id,l.item_id,l.marketplace_id,l.external_listing_id,l.status,l.ended_at,l.updated_at,
    row_number() over (partition by l.tenant_id,
     case when lower(btrim(l.marketplace_id)) in ('ebay','ebay_gb') and nullif(btrim(l.external_listing_id),'') is not null
      then 'ebay:'||btrim(l.external_listing_id) else 'row:'||l.id::text end
     order by l.updated_at desc nulls last,l.created_at desc nulls last,l.id) as identity_rank
   from public.listings l
   where l.tenant_id=p_tenant_id and exists(select 1 from scoped_items i where i.id=l.item_id and i.tenant_id=l.tenant_id)
  ), listing_rows as materialized (
   select * from ranked_listings where identity_rank=1
  ), selected_listings as materialized (
   select distinct on (l.item_id) l.* from listing_rows l
   order by l.item_id,case
    when lower(btrim(l.status)) in ('active','live') and nullif(btrim(l.external_listing_id),'') is not null and l.ended_at is null then 0
    when lower(btrim(l.status)) in ('draft','pending','failed') and nullif(btrim(l.external_listing_id),'') is null and l.ended_at is null then 1
    else 2 end,l.updated_at desc nulls last,l.id
  ), scoped_orders as materialized (
   select o.id,o.tenant_id,o.item_id,o.sale_id,o.external_order_id,o.status,o.fulfilment_status
   from public.orders o where o.tenant_id=p_tenant_id
  ), scoped_returns as materialized (
   select r.tenant_id,r.item_id,r.ebay_order_id,r.refund_amount,r.refund_issued_at
   from public.ebay_returns r where r.tenant_id=p_tenant_id
  ), valid_sales as materialized (
   select s.item_id,s.tenant_id from public.sales s
   where s.tenant_id=p_tenant_id and exists(select 1 from scoped_items i where i.id=s.item_id and i.tenant_id=s.tenant_id)
    and not exists(select 1 from scoped_orders o where o.tenant_id=s.tenant_id
     and (o.sale_id=s.id or (o.item_id=s.item_id and o.external_order_id=s.external_order_id and nullif(s.external_order_id,'') is not null))
     and (lower(o.status) in ('cancelled','canceled','refunded','returned','partially_refunded')
      or lower(o.fulfilment_status) in ('cancelled','canceled','refunded','returned')))
    and not exists(select 1 from scoped_returns r where r.tenant_id=s.tenant_id
     and (r.item_id=s.item_id or (r.ebay_order_id=s.external_order_id and nullif(s.external_order_id,'') is not null))
     and (coalesce(r.refund_amount,0)>0 or r.refund_issued_at is not null))
  ), sold_evidence as materialized (
   select item_id,tenant_id from listing_rows where lower(btrim(status)) in ('sold','fulfilled','completed')
   union select item_id,tenant_id from valid_sales
   union select item_id,tenant_id from scoped_orders where lower(status) in ('completed','paid','sold','dispatched','shipped','delivered','fulfilled')
    and lower(coalesce(fulfilment_status,'')) not in ('cancelled','canceled','refunded','returned')
  ), physical as materialized (
   select i.id as item_id,i.tenant_id,i.status as recorded_status,i.updated_at,i.quantity,
    l.id as listing_id,l.updated_at as listing_updated_at,
    case when lower(btrim(i.status)) in ('sold','fulfilled','completed') or i.sold_at is not null
      or (i.quantity<=1 and exists(select 1 from sold_evidence e where e.item_id=i.id and e.tenant_id=i.tenant_id))
      or (i.status_source='GetItem' and i.ebay_status='sold' and i.remaining='0') then 'sold'
     when lower(btrim(i.status)) in ('held','bundled','wholesaled','scrapped','disposed','archived') then 'archived'
     when l.id is not null and lower(btrim(l.status)) in ('active','live') and nullif(btrim(l.external_listing_id),'') is not null and l.ended_at is null then 'live'
     when l.id is not null and lower(btrim(l.status)) in ('draft','pending','failed') and nullif(btrim(l.external_listing_id),'') is null and l.ended_at is null then 'draft'
     else 'stock' end as inventory_tab
   from scoped_items i left join selected_listings l on l.item_id=i.id and l.tenant_id=i.tenant_id
  ), live_metric as (
   select count(*) as n from listing_rows l join physical c on c.item_id=l.item_id and c.tenant_id=l.tenant_id
   where c.inventory_tab not in ('sold','archived') and lower(btrim(l.marketplace_id)) in ('ebay','ebay_gb')
    and lower(btrim(l.status)) in ('active','live') and l.ended_at is null and nullif(btrim(l.external_listing_id),'') is not null
  )
  select jsonb_build_object('total',count(distinct item_id),'units',coalesce(sum(quantity),0),
   'stock',count(*) filter(where inventory_tab='stock'),'draft',count(*) filter(where inventory_tab='draft'),
   'live',count(*) filter(where inventory_tab='live'),'sold',count(*) filter(where inventory_tab='sold'),
   'archived',count(*) filter(where inventory_tab='archived'),'live_listings',(select n from live_metric),
   'revision',md5(coalesce(string_agg(jsonb_build_array(item_id,to_jsonb(updated_at)#>>'{}',listing_id::text,to_jsonb(listing_updated_at)#>>'{}',inventory_tab,quantity)::text,',' order by item_id),'')||':'||(select n from live_metric)::text),
   'status_counts',(select coalesce(jsonb_object_agg(recorded_status,n),'{}'::jsonb) from (select recorded_status,count(*) as n from physical group by recorded_status) s))
  from physical
 );
end;$$;
revoke all on function public.swish_inventory_tab_counts(uuid,text) from public,anon;
grant execute on function public.swish_inventory_tab_counts(uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
