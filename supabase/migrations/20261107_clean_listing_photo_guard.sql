-- Allow comparison-accepted, item-linked AI cutouts in existing draft persistence.
-- Only functions are defined. No existing inventory/listing rows are modified.
-- eBay publication additionally verifies PNG provenance against server storage.
create or replace function public.swish_listing_photo_allowed(p_media text[],p_attributes jsonb,p_tenant_id uuid,p_niche_id text,p_uri text)
returns boolean language sql stable security invoker set search_path=pg_catalog,public as $$
 select p_uri=any(coalesce(p_media,'{}'::text[])) or exists(
  select 1 from jsonb_each(case when jsonb_typeof(p_attributes->'_smart_studio_images')='object' then p_attributes->'_smart_studio_images' else '{}'::jsonb end) e
  where e.value->>'enhancedUri'=p_uri and e.value->>'originalUri'=any(coalesce(p_media,'{}'::text[]))
   and e.value->>'status'='ready' and e.value->>'version'='smart-studio-2.0.0'
   and e.value->>'sourceHash' ~ '^[a-f0-9]{64}$' and e.value->>'cacheKey' ~ '^[a-f0-9]{64}$'
   and e.value#>>'{quality,method}'='ai_cutout' and e.value#>>'{quality,fidelityPassed}'='true'
   and e.value#>>'{quality,checks,sameProduct}'='true' and e.value#>>'{quality,checks,defectsPreserved}'='true'
   and e.value#>>'{quality,checks,textUnchanged}'='true' and e.value#>>'{quality,checks,nothingInvented}'='true'
   and e.value#>>'{quality,checks,complete}'='true' and e.value#>>'{quality,checks,centred}'='true'
   and e.value#>>'{quality,checks,backgroundRemoved}'='true'
   and p_uri like 'https://%/storage/v1/object/public/item-images/'||p_tenant_id::text||'/studio/%/'||p_niche_id||'/'||(e.value->>'cacheKey')||'/presentation.png'
 );
$$;
revoke all on function public.swish_listing_photo_allowed(text[],jsonb,uuid,text,text) from public,anon;
grant execute on function public.swish_listing_photo_allowed(text[],jsonb,uuid,text,text) to authenticated;
do $$
declare definition text;
begin
 select pg_get_functiondef(p.oid) into definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='swish_save_listing_editor';
 if definition is null then raise exception 'Existing atomic editor is required'; end if;
 if position('public.swish_listing_photo_allowed(' in definition)=0 then
  if position('u=any(i.media)' in definition)=0 then raise exception 'Existing editor guard not found; no editor definition changed'; end if;
  definition=replace(definition,'u=any(i.media)','public.swish_listing_photo_allowed(i.media,i.attributes,i.tenant_id,public.swish_specialist_niche(i.specialist_id),u)');
  definition=replace(definition,'Choose original inventory photographs','Choose original or accepted clean inventory photographs');
  execute definition;
 end if;
end;
$$;
