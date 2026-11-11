-- Read-only synthetic regression of the DEPLOYED count query; no fixture/user-data writes.
-- This verifies SQL aggregation semantics, not authenticated RLS/device acceptance.
with source as (
 select split_part(split_part(prosrc,' return (',2),E'\n );',1) as query
 from pg_proc where oid='public.swish_inventory_tab_counts(uuid,text)'::regprocedure
), fixtures as (
 select $fixture$
 fixture_items as (
  select md5(name)::uuid as id,'00000000-0000-4000-8000-000000000001'::uuid as tenant_id,
   'coins'::text as specialist_id,status,null::timestamptz as sold_at,'2026-11-08T00:00:00Z'::timestamptz as updated_at,quantity,
   case when name='observed' then '{"_ebay_status_source":"GetItem","_ebay_listing_status":"sold","_ebay_quantity_remaining":"0"}'::jsonb else '{}'::jsonb end as attributes
  from (values ('stock','identified',1),('draft','identified',1),('live','listed',1),('sale','identified',1),
   ('refunded','identified',1),('partial','listed',3),('archive','held',1),('observed','identified',1),
   ('alias','identified',1),('cancel','identified',1),('terminal','sold',1)) v(name,status,quantity)
 ), fixture_listings as (
  select md5(row_name)::uuid as id,'00000000-0000-4000-8000-000000000001'::uuid as tenant_id,md5(item_name)::uuid as item_id,
   marketplace_id,external_listing_id,status,
   case when status='ended' then '2026-11-08T00:00:00Z'::timestamptz else null::timestamptz end as ended_at,
   updated_at::timestamptz,'2026-11-01T00:00:00Z'::timestamptz as created_at
  from (values ('draft-row','draft','ebay',null,'draft','2026-11-07T00:00:00Z'),
   ('live-row','live','ebay','100','active','2026-11-07T00:00:00Z'),
   ('partial-row','partial','ebay','200','active','2026-11-07T00:00:00Z'),
   ('alias-old','alias','ebay','300','active','2026-11-06T00:00:00Z'),
   ('alias-new','alias','EBAY_GB',' 300 ','ended','2026-11-08T00:00:00Z')) v(row_name,item_name,marketplace_id,external_listing_id,status,updated_at)
 ), fixture_sales as (
  select md5(name||'-sale')::uuid as id,md5(name)::uuid as item_id,
   '00000000-0000-4000-8000-000000000001'::uuid as tenant_id,name||'-order' as external_order_id
  from (values ('sale'),('refunded'),('partial'),('cancel')) v(name)
 ), fixture_orders as (
  select md5('cancel-order')::uuid as id,'00000000-0000-4000-8000-000000000001'::uuid as tenant_id,
   md5('cancel')::uuid as item_id,md5('cancel-sale')::uuid as sale_id,'cancel-order'::text as external_order_id,
   'cancelled'::text as status,'cancelled'::text as fulfilment_status
 ), fixture_returns as (
  select '00000000-0000-4000-8000-000000000001'::uuid as tenant_id,md5('refunded')::uuid as item_id,
   'refunded-order'::text as ebay_order_id,10::numeric as refund_amount,'2026-11-08T00:00:00Z'::timestamptz as refund_issued_at
 ),
$fixture$::text as prefix
), prepared as (
 select replace(replace(replace(replace(replace(replace(replace(replace(source.query,
  'with scoped_items','with '||fixtures.prefix||' scoped_items'),
  'public.items','fixture_items'),'public.listings','fixture_listings'),'public.sales','fixture_sales'),
  'public.orders','fixture_orders'),'public.ebay_returns','fixture_returns'),
  'p_tenant_id',quote_literal('00000000-0000-4000-8000-000000000001')||'::uuid'),
  'p_niche_id',quote_literal('coins')) as query
 from source cross join fixtures
), result as (
 select x.counts::jsonb as counts from prepared cross join lateral
 xmltable('/table/row' passing query_to_xml(prepared.query,false,false,'') columns counts text path 'jsonb_build_object') x
)
select counts-'revision'-'status_counts'='{"total":11,"units":13,"stock":4,"draft":1,"live":2,"sold":3,"archived":1,"live_listings":2}'::jsonb as fixture_counts_match,
 counts-'revision'-'status_counts' as fixture_counts,
 (select sum(value::bigint) from jsonb_each_text(counts->'status_counts'))=(counts->>'total')::bigint as status_total_matches,
 counts->>'revision' ~ '^[a-f0-9]{32}$' as revision_valid
from result;

-- Separate production security config check: no temporary role/JWT or RLS changes.
select p.prosecdef as security_definer,p.proconfig,
 has_function_privilege('anon',p.oid,'execute') as anon_can_call,
 has_function_privilege('authenticated',p.oid,'execute') as authenticated_can_call
from pg_proc p where p.oid='public.swish_inventory_tab_counts(uuid,text)'::regprocedure;
