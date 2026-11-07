-- Read-only canonical inventory acceptance queries. No user record mutations.
select c.tenant_id,c.niche_id,count(distinct c.item_id) as unique_items,
 count(*) filter(where inventory_tab='stock') as stock,count(*) filter(where inventory_tab='draft') as draft,
 count(*) filter(where inventory_tab='live') as live_items,count(*) filter(where inventory_tab='sold') as sold,
 count(*) filter(where inventory_tab='archived') as archived,sum(quantity) as recorded_units
from public.swish_inventory_canonical_rows c group by c.tenant_id,c.niche_id order by c.tenant_id,c.niche_id;

select tenant_id,item_id,count(*) from public.swish_inventory_canonical_rows group by tenant_id,item_id having count(*)>1;
select tenant_id,btrim(external_listing_id) as external_id,count(*) as rows,count(distinct item_id) as canonical_items
from public.listings where lower(btrim(marketplace_id)) in ('ebay','ebay_gb') and nullif(btrim(external_listing_id),'') is not null
 group by tenant_id,btrim(external_listing_id) having count(*)>1;
select tenant_id,attributes->>'_ebay_item_id' as external_id,array_agg(id) as ambiguous_item_ids
from public.items where nullif(btrim(attributes->>'_ebay_item_id'),'') is not null group by tenant_id,attributes->>'_ebay_item_id' having count(*)>1;
select tenant_id,external_order_id,item_id,count(*) as duplicate_order_rows from public.orders
where nullif(btrim(external_order_id),'') is not null group by tenant_id,external_order_id,item_id having count(*)>1;
select count(*) as unlinked_orders from public.orders where item_id is null;
select count(*) as unclassified_items from public.items where public.swish_specialist_niche(specialist_id) is null;
-- Compare swish_inventory_tab_counts and swish_command_snapshot only using an
-- authenticated real module/owner session. Do not fabricate identity or entitlements.
