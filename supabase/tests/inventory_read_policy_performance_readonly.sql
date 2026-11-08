-- Read-only diagnostic, run by an authorized administrator on OnSpace Cloud.
-- Uses the latest EXISTING coin session; does not create sessions, change grants or mutate data.
-- Do not output the claims/session identifiers or treat this as installed-device acceptance.
begin;
set local statement_timeout='6s';
select set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated')::text,true) is not null as diagnostic_scope_available
from public.swish_module_sessions where niche_id='coins' order by updated_at desc limit 1;
set local role authenticated;
with timer as materialized (select clock_timestamp() as started), measured as materialized (
 select started,public.swish_inventory_tab_counts((public.swish_current_module()->>'tenant_id')::uuid,public.swish_current_module()->>'niche_id') as counts from timer
)
select round(extract(epoch from clock_timestamp()-started)*1000,2) as authenticated_count_ms,counts-'revision'-'status_counts' as counts from measured;
with timer as materialized (select clock_timestamp() as started), collection as materialized (
 select c.item_id,c.inventory_tab from public.swish_inventory_canonical_rows c
 where c.tenant_id=(public.swish_current_module()->>'tenant_id')::uuid and c.niche_id=public.swish_current_module()->>'niche_id'
), measured as materialized (
 select timer.started,count(distinct c.item_id) as total,count(*) filter(where inventory_tab='live') as live,count(*) filter(where inventory_tab='sold') as sold from timer cross join collection c group by timer.started
)
select round(extract(epoch from clock_timestamp()-started)*1000,2) as authenticated_collection_ms,total,live,sold from measured;
do $test$
declare m jsonb:=public.swish_current_module(); denied boolean:=false;
begin
 if m is null then raise exception 'An existing coin diagnostic session is required'; end if;
 begin perform public.swish_inventory_tab_counts((m->>'tenant_id')::uuid,'tech'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Inactive module count was not denied'; end if;
 denied:=false;
 begin perform public.swish_inventory_tab_counts('00000000-0000-4000-8000-000000000001'::uuid,m->>'niche_id'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Other tenant count was not denied'; end if;
end $test$;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001","session_id":"swish-read-diagnostic-unbound"}',true) is not null as unbound_scope_set;
do $test$ begin
 if exists(select 1 from public.swish_readable_module()) or exists(select 1 from public.items) or exists(select 1 from public.listings) or exists(select 1 from public.orders) or exists(select 1 from public.sales) or exists(select 1 from public.ebay_returns) then
  raise exception 'Unbound session exposed protected inventory';
 end if;
end $test$;
select true as denial_assertions_passed;
rollback;
