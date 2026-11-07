-- Read-only SQL evidence. Run with audit privileges; these are NOT subscriber/network timings.
-- No inventory writes, sync claims, marketplace operations or JWT impersonation.
begin;
create or replace function pg_temp.swish_performance_samples(p_tenant uuid,p_niche text)
returns jsonb language plpgsql as $$
declare source text;query text;plan jsonb;times numeric[]:='{}';hits numeric[]:='{}';counts jsonb;
begin
 select prosrc into source from pg_proc where oid='public.swish_inventory_tab_counts(uuid,text)'::regprocedure;
 if position('return(' in source)=0 then raise exception 'Count contract is not the audited version';end if;
 query:=substring(source from position('return(' in source)+7);
 query:=regexp_replace(query,'\);\s*end;\s*$','','i');
 query:=replace(query,'p_tenant_id',quote_literal(p_tenant)||'::uuid');query:=replace(query,'p_niche_id',quote_literal(p_niche));
 for i in 1..5 loop execute 'explain (analyze,buffers,format json) '||query into plan;
  times:=array_append(times,(plan->0->>'Execution Time')::numeric);hits:=array_append(hits,(plan->0->'Plan'->>'Shared Hit Blocks')::numeric);
 end loop;
 execute query into counts;
 return jsonb_build_object('sql_only',true,'sample_count',5,'samples_ms',times,'shared_hit_blocks',hits,
  'median_ms',(select percentile_cont(0.5) within group(order by t) from unnest(times)t),
  'p90_ms',(select percentile_cont(0.9) within group(order by t) from unnest(times)t),'counts',counts);
end;$$;
select pg_temp.swish_performance_samples('53d169c0-8d37-4378-b8ef-84fbb3991661'::uuid,'coins');
select function_name,count(*) as samples,percentile_cont(0.5) within group(order by duration_ms) as median_ms,
 percentile_cont(0.9) within group(order by duration_ms) as p90_ms,count(*) filter(where status_code>=400) as failures
from public.edge_function_logs where created_at>=now()-interval '7 days' group by function_name;
select status,count(*),avg(extract(epoch from completed_at-started_at)*1000) as recorded_sync_ms from public.ebay_sync_log where started_at>=now()-interval '7 days' group by status;
select has_function_privilege('anon','public.swish_claim_ebay_sync(uuid,uuid,text,text)','execute') as anon_lease,
 has_function_privilege('authenticated','public.swish_claim_ebay_sync(uuid,uuid,text,text)','execute') as client_lease,
 has_function_privilege('service_role','public.swish_claim_ebay_sync(uuid,uuid,text,text)','execute') as server_lease;
rollback;
