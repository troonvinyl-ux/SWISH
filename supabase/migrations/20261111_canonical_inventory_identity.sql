-- SWISH canonical inventory: read projections and future-write identity guards.
-- Existing items, listings, orders, sales, entitlements and credentials are never rewritten.
begin;
set local lock_timeout='5s';

-- One winning observation per tenant/external eBay ID, including marketplace aliases.
-- Non-eBay records and unpublished drafts retain their legitimate separate identities.
create or replace view public.swish_inventory_listing_rows with (security_invoker=true) as
select (r.record).* from (
  select l as record,row_number() over(partition by l.tenant_id,
    case when lower(btrim(l.marketplace_id)) in ('ebay','ebay_gb') and nullif(btrim(l.external_listing_id),'') is not null
      then 'ebay:'||btrim(l.external_listing_id) else 'row:'||l.id::text end
    order by l.updated_at desc nulls last,l.created_at desc nulls last,l.id) as identity_rank
  from public.listings l
) r where r.identity_rank=1;
revoke all on public.swish_inventory_listing_rows from public,anon;
grant select on public.swish_inventory_listing_rows to authenticated;

-- A single classification per canonical item. No listing/order join multiplies items.
create or replace view public.swish_inventory_canonical_rows with (security_invoker=true) as
select i.tenant_id,i.specialist_id,i.id as item_id,
  case when state.sold then 'sold'
    when lower(btrim(i.status)) in ('held','bundled','wholesaled','scrapped','disposed','archived') then 'archived'
    when l.id is not null and lower(btrim(l.status)) in ('active','live') and nullif(btrim(l.external_listing_id),'') is not null and l.ended_at is null then 'live'
    when l.id is not null and lower(btrim(l.status)) in ('draft','pending','failed') and nullif(btrim(l.external_listing_id),'') is null and l.ended_at is null then 'draft'
    else 'stock' end as inventory_tab,
  to_jsonb(i)||case when state.sold then jsonb_build_object('status','sold') else '{}'::jsonb end as item,
  case when l.id is not null then to_jsonb(l) else null end as listing,
  coalesce(l.updated_at,i.updated_at,i.created_at) as sort_at,
  public.swish_specialist_niche(i.specialist_id) as niche_id,
  coalesce(i.quantity,1) as quantity
from public.items i
cross join lateral (
  select lower(btrim(i.status)) in ('sold','fulfilled','completed') or i.sold_at is not null
    or (coalesce(i.quantity,1)<=1 and (
      exists(select 1 from public.swish_inventory_listing_rows x where x.item_id=i.id and x.tenant_id=i.tenant_id and lower(btrim(x.status)) in ('sold','fulfilled','completed'))
      or exists(select 1 from public.sales s where s.item_id=i.id and s.tenant_id=i.tenant_id
        and not exists(select 1 from public.orders o where o.tenant_id=s.tenant_id and
          (o.sale_id=s.id or (o.item_id=s.item_id and o.external_order_id=s.external_order_id and nullif(s.external_order_id,'') is not null))
          and (lower(o.status) in ('cancelled','canceled','refunded','returned','partially_refunded') or lower(o.fulfilment_status) in ('cancelled','canceled','refunded','returned')))
        and not exists(select 1 from public.ebay_returns r where r.tenant_id=s.tenant_id and (r.item_id=i.id or (r.ebay_order_id=s.external_order_id and nullif(s.external_order_id,'') is not null)) and (coalesce(r.refund_amount,0)>0 or r.refund_issued_at is not null)))
      or exists(select 1 from public.orders o where o.item_id=i.id and o.tenant_id=i.tenant_id
        and lower(o.status) in ('completed','paid','sold','dispatched','shipped','delivered','fulfilled')
        and lower(coalesce(o.fulfilment_status,'')) not in ('cancelled','canceled','refunded','returned'))
    ))
    or (i.attributes->>'_ebay_status_source'='GetItem' and i.attributes->>'_ebay_listing_status'='sold'
      and i.attributes->>'_ebay_quantity_remaining'='0') as sold
) state
left join lateral (
  select x.* from public.swish_inventory_listing_rows x where x.item_id=i.id and x.tenant_id=i.tenant_id
  order by case
    when lower(btrim(x.status)) in ('active','live') and nullif(btrim(x.external_listing_id),'') is not null and x.ended_at is null then 0
    when lower(btrim(x.status)) in ('draft','pending','failed') and nullif(btrim(x.external_listing_id),'') is null and x.ended_at is null then 1
    else 2 end,x.updated_at desc nulls last,x.id
  limit 1
) l on true;
revoke all on public.swish_inventory_canonical_rows from public,anon;
grant select on public.swish_inventory_canonical_rows to authenticated;

-- Preserve the existing projection's columns, grants and callers.
create or replace view public.swish_inventory_tab_rows with (security_invoker=true) as
select tenant_id,specialist_id,item_id,inventory_tab,item,listing,sort_at
from public.swish_inventory_canonical_rows where inventory_tab<>'archived';

create or replace function public.swish_inventory_tab_counts(p_tenant_id uuid,p_niche_id text)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.swish_can_access_niche(p_tenant_id,p_niche_id) then
    raise exception 'Inventory niche access denied' using errcode='42501';
  end if;
  return (select jsonb_build_object('total',count(distinct item_id),'units',coalesce(sum(quantity),0),
    'stock',count(*) filter(where inventory_tab='stock'),'draft',count(*) filter(where inventory_tab='draft'),
    'live',count(*) filter(where inventory_tab='live'),'sold',count(*) filter(where inventory_tab='sold'),
    'archived',count(*) filter(where inventory_tab='archived'),
    'live_listings',(select count(*) from public.swish_inventory_listing_rows l join public.swish_inventory_canonical_rows c
      on c.tenant_id=l.tenant_id and c.item_id=l.item_id where c.tenant_id=p_tenant_id and c.niche_id=p_niche_id
      and c.inventory_tab not in ('sold','archived') and lower(btrim(l.marketplace_id)) in ('ebay','ebay_gb')
      and lower(btrim(l.status)) in ('active','live') and l.ended_at is null and nullif(btrim(l.external_listing_id),'') is not null))
    from public.swish_inventory_canonical_rows where tenant_id=p_tenant_id and niche_id=p_niche_id);
end; $$;
revoke all on function public.swish_inventory_tab_counts(uuid,text) from public,anon;
grant execute on function public.swish_inventory_tab_counts(uuid,text) to authenticated;

-- Surgical replacement of reporting CTEs in the installed owner/tenant RPC.
-- Preserve its twelve-niche registry, auth, paid entitlements, inspectors and sale/refund rules.
do $migration$
declare v_definition text; v_start integer; v_end integer;
begin
  v_definition:=pg_get_functiondef('public.swish_command_snapshot(uuid,boolean,text,text)'::regprocedure);
  v_start:=position('with scoped_items as materialized (' in v_definition);
  v_end:=position('), eligible_sales as materialized (' in v_definition);
  if v_start=0 or v_end<=v_start then raise exception 'Unreviewed command reporting definition'; end if;
  v_definition:=substring(v_definition from 1 for v_start-1)||$cte$
with scoped_items as materialized (
  select i.*,r.inventory_tab as canonical_state,public.swish_specialist_niche(i.specialist_id) as niche
  from public.items i join public.swish_inventory_canonical_rows r on r.item_id=i.id and r.tenant_id=i.tenant_id
  where (p_platform or i.tenant_id=p_tenant_id) and public.swish_specialist_niche(i.specialist_id)=any(v_allowed)
), item_stats as (
  select niche,count(distinct id) as inventory,count(*) filter(where canonical_state='sold') as sold,
    count(*) filter(where canonical_state='stock') as stock_total,coalesce(sum(quantity),0) as inventory_units,
    count(*) filter(where status in ('review_required','needs_review','review','flagged') or disposition_decision='review') as review
  from scoped_items group by niche
), listing_stats as (
  select i.niche,count(distinct i.id) filter(where i.canonical_state='live') as listed_inventory,
    count(distinct (l.tenant_id,btrim(l.external_listing_id))) filter(where lower(btrim(l.marketplace_id)) in ('ebay','ebay_gb')
      and lower(btrim(l.status)) in ('active','live') and l.ended_at is null and nullif(btrim(l.external_listing_id),'') is not null
      and i.canonical_state not in ('sold','archived')) as live,
    count(distinct i.id) filter(where i.canonical_state='draft') as drafts,
    coalesce(sum(l.price*case when i.attributes->>'_ebay_status_source'='GetItem' and i.attributes->>'_ebay_quantity_remaining' ~ '^[0-9]+$'
      then (i.attributes->>'_ebay_quantity_remaining')::numeric else greatest(coalesce(i.quantity,1),0) end)
      filter(where lower(btrim(l.marketplace_id)) in ('ebay','ebay_gb') and lower(btrim(l.status)) in ('active','live')
        and l.ended_at is null and nullif(btrim(l.external_listing_id),'') is not null and i.canonical_state not in ('sold','archived')),0) as listed_value
  from scoped_items i left join public.swish_inventory_listing_rows l on l.item_id=i.id and l.tenant_id=i.tenant_id group by i.niche
$cte$||substring(v_definition from v_end);
  v_start:=position('order_stats as (' in v_definition);v_end:=position('), tenants_in_scope as (' in v_definition);
  if v_start=0 or v_end<=v_start then raise exception 'Unreviewed order reporting definition'; end if;
  v_definition:=substring(v_definition from 1 for v_start-1)||$cte$
order_stats as (
  select i.niche,count(distinct (o.tenant_id,lower(o.marketplace_id),coalesce(nullif(btrim(o.external_order_id),''),o.id::text)))
    filter(where lower(o.status) not in ('cancelled','canceled','refunded','returned','partially_refunded','delivered')
      and lower(coalesce(o.fulfilment_status,'')) not in ('cancelled','canceled','refunded','returned','completed','delivered')
      and (o.requires_action is true or lower(o.fulfilment_status) in ('awaiting_dispatch','packing','packed','label_created'))) as outstanding
  from public.orders o left join public.listings l on l.id=o.listing_id and l.tenant_id=o.tenant_id
  join scoped_items i on i.id=coalesce(o.item_id,l.item_id) and i.tenant_id=o.tenant_id group by i.niche
$cte$||substring(v_definition from v_end);
  if position('coalesce(i.inventory,0) as inventory' in v_definition)=0 then raise exception 'Unreviewed module row contract'; end if;
  v_definition:=replace(v_definition,'coalesce(i.inventory,0) as inventory','coalesce(i.inventory,0) as inventory,coalesce(i.stock_total,0) as stock_total,coalesce(i.inventory_units,0) as inventory_units');
  v_definition:=replace(v_definition,$note$'Listed value is recorded asking price times remaining quantity, not revenue.'$note$, $note$'Unique items are canonical records retained through sale. Units and stock/draft/live/sold/orders/sales metrics are separate, never additive inventory totals. Listed value is recorded asking price times remaining quantity, not revenue.'$note$);
  execute v_definition;
end $migration$;

create index if not exists idx_items_ebay_identity on public.items(tenant_id,(btrim(attributes->>'_ebay_item_id')));
create index if not exists idx_items_capture_identity on public.items(tenant_id,(attributes->>'_capture_session_id'));

-- Future inserts/identity changes only. Legacy ambiguous records remain untouched.
create or replace function public.swish_guard_inventory_identity() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_external text;v_capture text;
begin
  if new.quantity is null or new.quantity<0 then raise exception 'Inventory quantity must be a non-negative whole number' using errcode='22023'; end if;
  v_external:=nullif(btrim(new.attributes->>'_ebay_item_id'),'');
  v_capture:=nullif(new.attributes->>'_capture_session_id','');
  if v_external is not null and (tg_op='INSERT' or v_external is distinct from nullif(btrim(old.attributes->>'_ebay_item_id'),'')) then
    perform pg_advisory_xact_lock(hashtextextended('ebay-item:'||new.tenant_id::text||':'||v_external,0));
    if exists(select 1 from public.items x where x.tenant_id=new.tenant_id and x.id<>new.id and btrim(x.attributes->>'_ebay_item_id')=v_external)
      or exists(select 1 from public.listings l where l.tenant_id=new.tenant_id and l.item_id<>new.id and lower(btrim(l.marketplace_id)) in ('ebay','ebay_gb') and btrim(l.external_listing_id)=v_external) then
      raise exception 'Existing eBay identity requires canonical item reuse or duplicate review' using errcode='23505';
    end if;
  end if;
  if v_capture is not null and (tg_op='INSERT' or v_capture is distinct from old.attributes->>'_capture_session_id') then
    perform pg_advisory_xact_lock(hashtextextended('capture:'||new.tenant_id::text||':'||v_capture,0));
    if exists(select 1 from public.items x where x.tenant_id=new.tenant_id and x.id<>new.id and x.attributes->>'_capture_session_id'=v_capture) then
      raise exception 'Capture already saved; reopen the canonical item' using errcode='23505';
    end if;
  end if;
  return new;
end; $$;
create or replace trigger guard_canonical_inventory_identity before insert or update of attributes,quantity on public.items
for each row execute function public.swish_guard_inventory_identity();

create or replace function public.swish_guard_external_listing_identity() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_external text;
begin
  v_external:=nullif(btrim(new.external_listing_id),'');
  if lower(btrim(new.marketplace_id)) not in ('ebay','ebay_gb') or v_external is null then return new; end if;
  if tg_op='UPDATE' and new.tenant_id=old.tenant_id and new.item_id=old.item_id and v_external=btrim(old.external_listing_id)
    and lower(btrim(old.marketplace_id)) in ('ebay','ebay_gb') then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('ebay-item:'||new.tenant_id::text||':'||v_external,0));
  if exists(select 1 from public.listings l where l.tenant_id=new.tenant_id and l.id<>new.id and lower(btrim(l.marketplace_id)) in ('ebay','ebay_gb') and btrim(l.external_listing_id)=v_external) then
    raise exception 'External eBay listing already linked; reuse canonical listing' using errcode='23505';
  end if;
  if exists(select 1 from public.items i where i.tenant_id=new.tenant_id and i.id<>new.item_id and btrim(i.attributes->>'_ebay_item_id')=v_external) then
    raise exception 'Ambiguous external identity requires review before linking' using errcode='23505';
  end if;
  return new;
end; $$;
create or replace trigger guard_external_listing_identity before insert or update of external_listing_id,item_id,tenant_id,marketplace_id on public.listings
for each row execute function public.swish_guard_external_listing_identity();
revoke all on function public.swish_guard_inventory_identity(),public.swish_guard_external_listing_identity() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
