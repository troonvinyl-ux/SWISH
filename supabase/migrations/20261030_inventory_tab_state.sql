-- Niche-scoped inventory tab projection and server-only eBay status reconciliation.
-- No existing records are rewritten or removed by this migration.
begin;
create or replace view public.swish_inventory_tab_rows with (security_invoker = true) as
with item_state as (
  select i.*, (
    lower(btrim(i.status)) in ('sold','fulfilled','completed') or i.sold_at is not null
    or exists(select 1 from public.listings x where x.item_id=i.id and x.tenant_id=i.tenant_id and lower(btrim(x.status)) in ('sold','fulfilled','completed'))
    or (coalesce(i.quantity,1)<=1 and (
      exists(select 1 from public.sales s where s.item_id=i.id and s.tenant_id=i.tenant_id)
      or exists(select 1 from public.orders o where o.item_id=i.id and o.tenant_id=i.tenant_id and lower(btrim(o.status)) in ('completed','paid','sold','dispatched','shipped','delivered','fulfilled'))
    ))
    or (i.attributes->>'_ebay_status_source'='GetItem' and i.attributes->>'_ebay_listing_status'='sold')
  ) as terminal_sold from public.items i
), classified as (
 select i.id item_id,i.tenant_id,i.specialist_id,coalesce(l.updated_at,i.updated_at,i.created_at) sort_at,
   case when i.terminal_sold then 'sold'
     when lower(btrim(i.status)) in ('held','bundled','wholesaled','scrapped','disposed','archived') then 'archived'
     when lower(btrim(l.status)) in ('active','live') and nullif(btrim(l.external_listing_id),'') is not null and l.ended_at is null then 'live'
     when lower(btrim(l.status)) in ('draft','pending','failed') and nullif(btrim(l.external_listing_id),'') is null and l.ended_at is null then 'draft'
     else 'stock' end inventory_tab,
   (to_jsonb(i)-'terminal_sold') || case when i.terminal_sold then jsonb_build_object('status','sold') else '{}'::jsonb end item,
   case when l.id is not null then to_jsonb(l) else null end listing,
   row_number() over(partition by i.id order by l.updated_at desc nulls last,l.id) item_row
 from item_state i left join public.listings l on l.item_id=i.id and l.tenant_id=i.tenant_id
), eligible as (
 select c.* from classified c where (inventory_tab in ('live','draft')) or (inventory_tab='sold' and item_row=1)
 or (inventory_tab='stock' and item_row=1 and not exists(select 1 from classified x where x.item_id=c.item_id and x.tenant_id=c.tenant_id and x.inventory_tab in ('live','draft','sold','archived')))
)
select tenant_id,specialist_id,item_id,inventory_tab,item,listing,sort_at from eligible;
revoke all on public.swish_inventory_tab_rows from public,anon;
grant select on public.swish_inventory_tab_rows to authenticated;

create or replace function public.swish_apply_ebay_listing_status(p_tenant_id uuid,p_listing_id uuid,p_external_id text,p_status text,p_quantity integer,p_quantity_sold integer,p_ended_at timestamptz)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_item_id uuid; v_before text; v_listing_before text; v_sold_at timestamptz; v_remaining integer; v_now timestamptz=now();
begin
 if p_status is null or p_status not in ('active','sold','ended') or p_quantity is null or p_quantity_sold is null or p_quantity<1 or p_quantity_sold<0 then raise exception 'Invalid eBay observation' using errcode='22023'; end if;
 select item_id,status into v_item_id,v_listing_before from public.listings where id=p_listing_id and tenant_id=p_tenant_id and marketplace_id='ebay' and external_listing_id=p_external_id for update;
 if v_item_id is null then raise exception 'Listing scope mismatch' using errcode='42501'; end if;
 select status,sold_at into v_before,v_sold_at from public.items where id=v_item_id and tenant_id=p_tenant_id for update;
 if v_before is null then raise exception 'Item scope mismatch' using errcode='42501'; end if;
 v_remaining=greatest(0,p_quantity-p_quantity_sold);
 if p_status='active' and (v_sold_at is not null or lower(btrim(v_before)) in ('sold','fulfilled','completed')) then raise exception 'Sold item conflicts with active eBay response; review canonical item' using errcode='22023'; end if;
 update public.listings set status=p_status,ended_at=case when p_status='active' then null else p_ended_at end,updated_at=v_now where id=p_listing_id and tenant_id=p_tenant_id;
 update public.items set status=case when p_status='sold' then 'sold' when p_status='active' then 'listed' when lower(btrim(v_before)) in ('sold','fulfilled','completed') then v_before else 'identified' end,
 sold_at=case when p_status='sold' then coalesce(sold_at,p_ended_at) else sold_at end,
 attributes=coalesce(attributes,'{}'::jsonb)||jsonb_build_object('_ebay_listing_status',p_status,'_ebay_quantity_remaining',v_remaining,'_ebay_quantity_sold',p_quantity_sold,'_ebay_status_source','GetItem','_ebay_status_checked_at',v_now),updated_at=v_now where id=v_item_id and tenant_id=p_tenant_id;
 if p_status='sold' and lower(btrim(v_before)) not in ('sold','fulfilled','completed') then
 insert into public.item_lifecycle_events(tenant_id,item_id,from_status,to_status,triggered_by,notes) values(p_tenant_id,v_item_id,v_before,'sold','ebay_status_sync','GetItem confirmed sold: '||p_external_id);
 end if;
 if v_listing_before is distinct from p_status or (p_status='sold' and lower(btrim(v_before)) not in ('sold','fulfilled','completed')) then
 insert into public.audit_events(tenant_id,entity_type,entity_id,action,before_state,after_state) values(p_tenant_id,'listing',p_listing_id::text,'ebay_status_reconciled',jsonb_build_object('item_status',v_before,'listing_status',v_listing_before),jsonb_build_object('source','GetItem','external_listing_id',p_external_id,'status',p_status,'remaining',v_remaining));
 end if;
end; $$;
revoke all on function public.swish_apply_ebay_listing_status(uuid,uuid,text,text,integer,integer,timestamptz) from public,anon,authenticated;
grant execute on function public.swish_apply_ebay_listing_status(uuid,uuid,text,text,integer,integer,timestamptz) to service_role;
commit;
