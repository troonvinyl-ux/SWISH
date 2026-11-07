-- Read-only production evidence. Never publishes, captures, updates or attaches photos.
select public.swish_specialist_niche(specialist_id) niche,count(*) items,
 count(*) filter(where coalesce(cardinality(media),0)>0) items_with_media,
 count(*) filter(where exists(select 1 from unnest(media) m where m ~ '^(file:|blob:|content:|data:)')) temporary_reference_items
from public.items group by 1 order by 1;
select count(*) original_objects,count(*) filter(where exists(select 1 from unnest(i.media) m where m like '%'||o.name)) canonical_original_links
from storage.objects o join public.items i on i.id::text=split_part(o.name,'/',1)
where o.bucket_id='item-images' and split_part(o.name,'/',2)='originals';
select count(*) as persistence_trigger_installed from pg_trigger
where not tgisinternal and tgname='preserve_captured_photo_references';
select position('_photo_pipeline' in pg_get_functiondef('public.swish_claim_listing_publish(uuid,uuid)'::regprocedure))>0 as claim_guard_installed;
-- Pure fixture checks the publication expectation contract without changing inventory.
with fixture(media,expected) as(values(array['https://stored/front']::text[],'[{"slotId":"front","url":"https://stored/front"},{"slotId":"back"}]'::jsonb))
select exists(select 1 from jsonb_array_elements(expected) e where e->>'url' is null or not(e->>'url'=any(media))) as partial_capture_is_blocked from fixture;
