-- Minority Report: extend the existing consolidated reporting RPC, not a second dashboard.
-- Schema only. Preserve auth, owner checks, tenant/niche guards, inspectors and ledger exclusions.
begin;
create index if not exists idx_commercial_events_preflight_scope
  on public.commercial_events(tenant_id,entity_id,created_at desc,id desc)
  where event_type='listing_preflight' and entity_type='listing';
do $migration$
declare d text; anchor text := '), module_rows as (';
begin
 d:=pg_get_functiondef('public.swish_command_snapshot(uuid,boolean,text,text)'::regprocedure);
 if position('''operations''' in d)>0 then return; end if;
 if position(anchor in d)=0 or position('''subscriptionRevenue'',null,' in d)=0
   or position('eligible_sales as materialized' in d)=0 then raise exception 'Unreviewed command snapshot contract';end if;
 d:=replace(d,anchor,$ctes$
), preflight_latest as materialized (
 select distinct on(e.tenant_id,e.entity_id) e.tenant_id,e.entity_id,e.data,e.created_at
 from public.commercial_events e
 where e.event_type='listing_preflight' and e.entity_type='listing'
   and (p_platform or e.tenant_id=p_tenant_id) and e.data->>'nicheId'=any(v_allowed)
   and e.created_at between now()-interval '15 minutes' and now()
 order by e.tenant_id,e.entity_id,e.created_at desc,e.id desc
), preflight_current as materialized (
 select i.id,i.niche,p.data
 from preflight_latest p join public.listings l on l.id::text=p.entity_id and l.tenant_id=p.tenant_id
 join scoped_items i on i.id=l.item_id and i.tenant_id=l.tenant_id
 where i.niche=p.data->>'nicheId' and i.canonical_state in('stock','draft')
   and nullif(btrim(l.external_listing_id),'') is null and l.ended_at is null
   and p.data->>'source'='shared_specialist_preflight'
   and p.data->>'itemUpdatedAt'=to_jsonb(i.updated_at)#>>'{}'
   and p.data->>'listingUpdatedAt'=to_jsonb(l.updated_at)#>>'{}'
), identity_keys as materialized (
 select tenant_id,id,'inventory:'||btrim(inventory_id) key from scoped_items where nullif(btrim(inventory_id),'') is not null
 union select tenant_id,id,'capture:'||(attributes->>'_capture_session_id') from scoped_items where nullif(attributes->>'_capture_session_id','') is not null
 union select tenant_id,id,'ebay:'||btrim(attributes->>'_ebay_item_id') from scoped_items where nullif(btrim(attributes->>'_ebay_item_id'),'') is not null
 union select i.tenant_id,i.id,'ebay:'||btrim(l.external_listing_id) from scoped_items i join public.listings l on l.item_id=i.id and l.tenant_id=i.tenant_id
   where lower(btrim(l.marketplace_id)) in('ebay','ebay_gb') and nullif(btrim(l.external_listing_id),'') is not null
), duplicate_keys as (
 select tenant_id,key from identity_keys group by tenant_id,key having count(distinct id)>1
), duplicate_items as (
 select distinct k.tenant_id,k.id from identity_keys k join duplicate_keys d using(tenant_id,key)
 union select distinct i.tenant_id,i.id from scoped_items i join public.listings l on l.item_id=i.id and l.tenant_id=i.tenant_id
 where lower(btrim(l.marketplace_id)) in('ebay','ebay_gb') and nullif(btrim(l.external_listing_id),'') is not null
 and exists(select 1 from public.listings x where x.tenant_id=l.tenant_id and x.id<>l.id
   and lower(btrim(x.marketplace_id)) in('ebay','ebay_gb') and btrim(x.external_listing_id)=btrim(l.external_listing_id))
), item_flags as materialized (
 select i.id,i.niche,i.canonical_state,
   exists(select 1 from preflight_current p where p.id=i.id) assessed,
   exists(select 1 from preflight_current p where p.id=i.id and p.data->>'ready'='true')
     and exists(select 1 from public.marketplace_connectors c where c.tenant_id=i.tenant_id and lower(c.marketplace_id)='ebay'
       and c.status='connected' and c.can_publish is true and nullif(c.selected_fulfillment_policy_id,'') is not null
       and nullif(c.selected_return_policy_id,'') is not null and nullif(c.selected_payment_policy_id,'') is not null) ready,
   i.attributes->'_photo_pipeline'->>'status'='retry_required' photo_failure,
   exists(select 1 from public.listings l where l.tenant_id=i.tenant_id and l.item_id=i.id
     and lower(l.marketplace_id) in('ebay','ebay_gb') and l.status='failed' and nullif(btrim(l.external_listing_id),'') is null) publish_failure,
   exists(select 1 from preflight_current p where p.id=i.id and p.data->>'issue'='specifics') missing_specifics,
   coalesce(i.identification_source,'unknown')<>'unknown' and i.identification_confidence>=0 and i.identification_confidence<0.5 low_confidence,
   (i.canonical_state='live' and lower(i.status) not in('listed','live','active'))
     or (lower(i.status)='listed' and i.canonical_state not in('live','sold','archived')) sync_issue,
   exists(select 1 from duplicate_items d where d.id=i.id and d.tenant_id=i.tenant_id) duplicate_issue,
   i.status in('review_required','needs_review','review','flagged') or i.disposition_decision='review' review_issue,
   exists(select 1 from preflight_current p where p.id=i.id and p.data->>'ready'='false') preflight_issue
 from scoped_items i
), operation_rows as materialized (
 select n.id,
   case when count(f.id) filter(where f.canonical_state in('stock','draft'))>0 and count(f.id) filter(where f.assessed)=0 then null
     else count(f.id) filter(where f.ready) end ready,
   count(f.id) filter(where f.assessed) readiness_assessed,
   count(f.id) filter(where f.canonical_state in('stock','draft')) unpublished,
   count(f.id) filter(where f.photo_failure) photo_failures,
   count(f.id) filter(where f.publish_failure) publication_failures,
   case when count(f.id) filter(where f.canonical_state in('stock','draft'))>0 and count(f.id) filter(where f.assessed)=0 then null
     else count(f.id) filter(where f.missing_specifics) end missing_specifics,
   count(f.id) filter(where f.low_confidence) low_confidence,
   count(f.id) filter(where f.sync_issue) sync_discrepancies,
   count(f.id) filter(where f.duplicate_issue) duplicate_items,
   count(f.id) filter(where f.photo_failure or f.publish_failure or f.missing_specifics or f.low_confidence
     or f.sync_issue or f.duplicate_issue or f.review_issue or f.preflight_issue) issues,
   (select coalesce(sum(s.sale_price),0) from eligible_sales s where s.niche=n.id and s.ordinal=1
     and s.sold_at between (date_trunc('day',now() at time zone 'Europe/London') at time zone 'Europe/London') and now()) sales_today
 from unnest(v_allowed) n(id) left join item_flags f on f.niche=n.id group by n.id
), timing_latest as materialized (
 select distinct on(e.tenant_id,e.entity_id) e.tenant_id,e.entity_id,e.data
 from public.commercial_events e where e.entity_type='quick_list' and e.event_type='quick_list_timing'
   and (p_platform or e.tenant_id=p_tenant_id) and e.data->>'nicheId'=any(v_allowed)
   and e.created_at between now()-interval '30 days' and now()
 order by e.tenant_id,e.entity_id,e.created_at desc,e.id desc
), measured_sessions as materialized (
 select t.*,
   t.data->>'publicationAttempted'='true' and t.data->>'outcome' in('live','failed','unconfirmed','abandoned') attempted,
   t.data->>'publicationAttempted'='true' and t.data->>'outcome'='live'
     and t.data->>'externalListingId' ~ '^[0-9]+$'
     and exists(select 1 from public.commercial_events e where e.tenant_id=t.tenant_id and e.entity_id=t.entity_id
       and e.event_type='quick_list_live_confirmation' and e.entity_type='quick_list'
       and e.data->>'nicheId'=t.data->>'nicheId' and e.data->>'externalListingId'=t.data->>'externalListingId'
       and e.data->>'listingStatus'='Active') confirmed,
   case when t.data->'timestamps'->>'T2' ~ '^[0-9]{10,16}$' and t.data->'timestamps'->>'T7' ~ '^[0-9]{10,16}$'
     then (t.data->'timestamps'->>'T7')::numeric-(t.data->'timestamps'->>'T2')::numeric else null end capture_ms
 from timing_latest t
), measured_performance as (
 select count(*) filter(where attempted) attempts,count(*) filter(where confirmed) confirmed,
   count(*) filter(where confirmed and capture_ms>=0) duration_samples,
   avg(capture_ms) filter(where confirmed and capture_ms>=0) average_capture_to_live_ms
 from measured_sessions
), module_rows as (
$ctes$);
 d:=replace(d,'''subscriptionRevenue'',null,',$output$
'subscriptionRevenue',null,
'operations',jsonb_build_object(
 'version','minority-text-v1','niches',(select coalesce(jsonb_agg(to_jsonb(o)),'[]'::jsonb) from operation_rows o),
 'totals',(select jsonb_build_object('ready',case when count(*) filter(where ready is null)>0 then null else coalesce(sum(ready),0) end,
   'readinessAssessed',coalesce(sum(readiness_assessed),0),'unpublished',coalesce(sum(unpublished),0),
   'issues',coalesce(sum(issues),0),'salesToday',coalesce(sum(sales_today),0)) from operation_rows),
 'performance',(select jsonb_build_object('windowDays',30,'attempts',attempts,'confirmed',confirmed,'durationSamples',duration_samples,
   'publicationSuccessPct',case when attempts>0 then round(confirmed*100.0/attempts,2) else null end,
   'averageCaptureToLiveMs',average_capture_to_live_ms) from measured_performance)
),
$output$);
 execute d;
end $migration$;
notify pgrst,'reload schema';
commit;
