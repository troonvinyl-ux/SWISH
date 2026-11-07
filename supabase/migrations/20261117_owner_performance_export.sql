-- Owner-only aggregate performance export over existing telemetry.
-- No provider requests, credentials, identities, item payloads or production writes.
-- Existing RLS and telemetry retention remain unchanged; no new reporting store.
begin;
create or replace function public.swish_performance_export()
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public set statement_timeout='10s' as $$
declare result jsonb;
begin
 if auth.uid() is null or public.swish_is_platform_owner() is not true then
  raise exception 'Platform owner access required' using errcode='42501';
 end if;
 with edge_rows as materialized (
  select case when function_name=any(array[
   'swish-check-subscription','swish-coin-image-enhance','swish-create-checkout','swish-customer-portal',
   'swish-decompose','swish-discogs','swish-ebay-browse','swish-ebay-category','swish-ebay-draft-sync-test',
   'swish-ebay-finances','swish-ebay-list','swish-ebay-listing-status','swish-ebay-messages','swish-ebay-oauth',
   'swish-ebay-orders','swish-ebay-post-order','swish-ebay-sync','swish-identify','swish-image-download',
   'swish-islamic-identify','swish-list-generate','swish-market-value','swish-migrate-credentials',
   'swish-privacy-policy','swish-reprice','swish-unified-health','swish-verification','swish-verify'
  ]) then function_name else 'other' end as function_name,duration_ms,status_code
  from public.edge_function_logs where created_at between now()-interval '7 days' and now()
 ), edge_groups as (
  select function_name,count(*) as records,count(*) filter(where status_code>=400) as http_failures,
   count(*) filter(where duration_ms>=0) as samples,
   percentile_cont(0.5) within group(order by duration_ms) filter(where duration_ms>=0) as median_ms,
   percentile_cont(0.9) within group(order by duration_ms) filter(where duration_ms>=0) as p90_ms
  from edge_rows group by function_name
 ), sync_rows as materialized (
  select status,case when completed_at>=started_at then extract(epoch from completed_at-started_at)*1000 else null end as duration_ms
  from public.ebay_sync_log where started_at between now()-interval '7 days' and now()
 ), timing_latest as materialized (
  select distinct on(tenant_id,entity_id) tenant_id,entity_id,data
  from public.commercial_events where event_type='quick_list_timing' and entity_type='quick_list'
   and created_at between now()-interval '30 days' and now()
   and data->>'nicheId'=any(array['coins','motocross','bicycles','clothing','trading_cards','antiques','fossils','beauty','tech','surplus_flip','collectibles','tunes_flip'])
  order by tenant_id,entity_id,created_at desc,id desc
 ), timing_evidence as materialized (
  select t.data,t.data->>'publicationAttempted'='true' as attempted,
   t.data->>'publicationAttempted'='true' and t.data->>'outcome'='live' and t.data->>'externalListingId' ~ '^[0-9]+$'
   and exists(select 1 from public.commercial_events e where e.tenant_id=t.tenant_id and e.entity_id=t.entity_id
    and e.entity_type='quick_list' and e.event_type='quick_list_live_confirmation'
    and e.created_at between now()-interval '30 days' and now()
    and e.data->>'nicheId'=t.data->>'nicheId' and e.data->>'externalListingId'=t.data->>'externalListingId'
    and e.data->>'listingStatus'='Active') as confirmed,
   case when jsonb_typeof(t.data->'timestamps'->'T2')='number' and jsonb_typeof(t.data->'timestamps'->'T7')='number'
    and t.data->'timestamps'->>'T2' ~ '^[0-9]{10,16}$' and t.data->'timestamps'->>'T7' ~ '^[0-9]{10,16}$'
    then (t.data->'timestamps'->>'T7')::numeric-(t.data->'timestamps'->>'T2')::numeric else null end as duration_ms
  from timing_latest t
 )
 select jsonb_build_object('version','swish-performance-export-v1','verifiedOwner',true,'scope','platform','checkedAt',now(),
  'edge',jsonb_build_object('windowDays',7,'records',(select count(*) from edge_rows),
   'functions',(select coalesce(jsonb_agg(jsonb_build_object('functionName',function_name,'records',records,'httpFailures',http_failures,
    'samples',samples,'medianMs',median_ms,'p90Ms',p90_ms) order by function_name),'[]'::jsonb) from edge_groups)),
  'sync',(select jsonb_build_object('windowDays',7,'records',count(*),'completed',count(*) filter(where status='completed'),
   'failed',count(*) filter(where status in('failed','error')),'running',count(*) filter(where status='running'),
   'other',count(*) filter(where status is null or status not in('completed','failed','error','running')),
   'samples',count(duration_ms),'missingDurationRecords',count(*) filter(where duration_ms is null),
   'medianMs',percentile_cont(0.5) within group(order by duration_ms),'p90Ms',percentile_cont(0.9) within group(order by duration_ms)) from sync_rows),
  'captureToLive',(select jsonb_build_object('windowDays',30,'sessions',count(*),'publicationAttempts',count(*) filter(where attempted),
   'confirmedLiveSessions',count(*) filter(where confirmed),'samples',count(*) filter(where confirmed and duration_ms>=0),
   'excludedConfirmedDurations',count(*) filter(where confirmed and (duration_ms is null or duration_ms<0)),
   'medianMs',percentile_cont(0.5) within group(order by duration_ms) filter(where confirmed and duration_ms>=0),
   'p90Ms',percentile_cont(0.9) within group(order by duration_ms) filter(where confirmed and duration_ms>=0)) from timing_evidence)
 ) into result;
 return result;
end;$$;
revoke all on function public.swish_performance_export() from public,anon;
grant execute on function public.swish_performance_export() to authenticated;
comment on function public.swish_performance_export() is 'Trusted platform-owner check then aggregate-only telemetry; no provider calls, secrets or item payloads.';
notify pgrst,'reload schema';
commit;
