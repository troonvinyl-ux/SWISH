-- A physical item has one current marketplace state. Historical listing links
-- remain audit evidence, but must never let an old `active` row outrank the
-- latest confirmed GetItem observation and keep an ended item in the Live tab.
begin;

create or replace view public.swish_inventory_canonical_rows with (security_invoker=true) as
with item_state as (
  select i.*,
    nullif(btrim(i.attributes->>'_ebay_item_id'),'') as observed_ebay_id,
    case when i.attributes->>'_ebay_status_source'='GetItem'
      then lower(btrim(coalesce(i.attributes->>'_ebay_listing_status','')))
      else null end as observed_ebay_status,
    (
      lower(btrim(i.status)) in ('sold','fulfilled','completed') or i.sold_at is not null
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
        and i.attributes->>'_ebay_quantity_remaining'='0')
    ) as terminal_sold
  from public.items i
), classified as (
  select i.tenant_id,i.specialist_id,i.id as item_id,
    case when i.terminal_sold then 'sold'
      when lower(btrim(i.status)) in ('held','bundled','wholesaled','scrapped','disposed','archived') then 'archived'
      -- A confirmed eBay observation belongs to the item, not a competing
      -- historical listing row. An ended observation deliberately returns it
      -- to stock; only a confirmed active observation can sort it as Live.
      when i.observed_ebay_status='active' and i.observed_ebay_id is not null then 'live'
      when i.observed_ebay_status in ('ended','sold') then 'stock'
      when l.id is not null and lower(btrim(l.status)) in ('active','live') and nullif(btrim(l.external_listing_id),'') is not null and l.ended_at is null then 'live'
      when l.id is not null and lower(btrim(l.status)) in ('draft','pending','failed') and nullif(btrim(l.external_listing_id),'') is null and l.ended_at is null then 'draft'
      else 'stock' end as inventory_tab,
    to_jsonb(i)-'terminal_sold'-'observed_ebay_id'-'observed_ebay_status' as item,
    case when l.id is not null then to_jsonb(l) else null end as listing,
    coalesce(l.updated_at,i.updated_at,i.created_at) as sort_at,
    public.swish_specialist_niche(i.specialist_id) as niche_id,
    coalesce(i.quantity,1) as quantity
  from item_state i
  left join lateral (
    select x.* from public.swish_inventory_listing_rows x
    where x.item_id=i.id and x.tenant_id=i.tenant_id
    -- Prefer the relationship that supplied the latest authoritative item
    -- observation. Without it, most recently changed listing wins; an old
    -- Active record can never outrank a newer Ended record merely by status.
    order by case when i.observed_ebay_id is not null and btrim(x.external_listing_id)=i.observed_ebay_id then 0 else 1 end,
      coalesce(x.updated_at,x.created_at) desc,x.id
    limit 1
  ) l on true
)
select tenant_id,specialist_id,item_id,inventory_tab,item,listing,sort_at,niche_id,quantity
from classified;

revoke all on public.swish_inventory_canonical_rows from public,anon;
grant select on public.swish_inventory_canonical_rows to authenticated;

create or replace view public.swish_inventory_tab_rows with (security_invoker=true) as
select tenant_id,specialist_id,item_id,inventory_tab,item,listing,sort_at
from public.swish_inventory_canonical_rows where inventory_tab<>'archived';

commit;

