-- Production acceptance observations, administrative role only; never seller/device certification.
-- No inventory writes, cleanup, provider calls, JWT impersonation or schema migration.
begin;
select now() as checked_at;
with physical as(select tenant_id,public.swish_specialist_niche(specialist_id) niche,count(*) n from public.items group by 1,2), projected as(select tenant_id,niche_id niche,count(*) n,count(distinct item_id) u from public.swish_inventory_canonical_rows group by 1,2)
select count(*) scopes,count(*) filter(where p.n is null or c.n is null) missing_scopes,bool_and(p.n=c.n and c.n=c.u) totals_match from physical p full join projected c on p.tenant_id=c.tenant_id and p.niche is not distinct from c.niche;
with niches as(select unnest(array['coins','motocross','bicycles','clothing','trading_cards','antiques','fossils','beauty','tech','surplus_flip','collectibles','tunes_flip']) id)
select n.id,count(i.id) items,count(i.id) filter(where coalesce(cardinality(i.media),0)>0) with_media from niches n left join public.items i on public.swish_specialist_niche(i.specialist_id)=n.id group by n.id order by n.id;
select count(*) unclassified from public.items where public.swish_specialist_niche(specialist_id) is null;
select count(*) duplicate_order_line_groups from(select tenant_id,external_order_id,item_id from public.orders where nullif(btrim(external_order_id),'') is not null group by 1,2,3 having count(*)>1)d;
select count(*) duplicate_item_external_groups from(select tenant_id,btrim(attributes->>'_ebay_item_id') from public.items where nullif(btrim(attributes->>'_ebay_item_id'),'') is not null group by 1,2 having count(*)>1)d;
select count(*) live_with_end_date from public.listings where lower(btrim(status)) in('active','live') and ended_at is not null;
select count(distinct i.id) sold_with_live_listing from public.items i join public.listings l on l.item_id=i.id and l.tenant_id=i.tenant_id where i.status='sold' and lower(btrim(l.status)) in('active','live') and l.ended_at is null;
with refs as(select m.url,split_part(split_part(m.url,'/storage/v1/object/public/item-images/',2),'?',1) object_path from public.items i cross join lateral unnest(i.media)m(url))
select count(*) local_refs,count(*) filter(where not exists(select 1 from storage.objects o where o.bucket_id='item-images' and o.name=refs.object_path)) missing_local_objects from refs where url like 'https://iwgaqieyoahmcjfziwga.backend.onspace.ai/storage/v1/object/public/item-images/%';
select count(*) quick_list_samples from public.commercial_events where event_type='quick_list_timing' and created_at between now()-interval '30 days' and now();
-- A real rejection is required, not the mere presence of a function.
do $checks$ begin
 if auth.uid() is not null then raise exception 'This negative audit requires no JWT session';end if;
 begin perform public.swish_inventory_tab_counts('00000000-0000-0000-0000-000000000001'::uuid,'coins');raise exception 'Counts allowed without session';exception when insufficient_privilege then null;end;
 begin perform public.swish_command_snapshot(null,true,null,null);raise exception 'Command allowed without session';exception when insufficient_privilege then null;end;
 begin perform public.swish_performance_export();raise exception 'Export allowed without session';exception when insufficient_privilege then null;end;
end $checks$;
rollback;
