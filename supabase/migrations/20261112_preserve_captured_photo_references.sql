-- Schema only: preserve captured originals/roles across future stale editor and sync writes.
-- No historical records are updated, deleted, merged, regenerated or reclassified.
create or replace function public.swish_preserve_captured_photo_references() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
declare v_asset jsonb;v_url text;begin
 new.attributes:=coalesce(new.attributes,'{}'::jsonb);
 if old.attributes ? '_photo_pipeline' and not (new.attributes ? '_photo_pipeline') then
  new.attributes:=new.attributes||jsonb_build_object('_photo_pipeline',old.attributes->'_photo_pipeline');
 end if;
 if jsonb_typeof(old.attributes->'_photo_assets')='array' then
  if jsonb_typeof(new.attributes->'_photo_assets') is distinct from 'array' then
   new.attributes:=new.attributes||jsonb_build_object('_photo_assets','[]'::jsonb);
  end if;
  for v_asset in select value from jsonb_array_elements(old.attributes->'_photo_assets') loop
   if not exists(select 1 from jsonb_array_elements(new.attributes->'_photo_assets') e
      where e->>'slotId'=v_asset->>'slotId' and e->>'url'=v_asset->>'url') then
    new.attributes:=jsonb_set(new.attributes,'{_photo_assets}',(new.attributes->'_photo_assets')||jsonb_build_array(v_asset));
   end if;
  end loop;
 end if;
 if jsonb_typeof(old.attributes->'_smart_studio_images')='object' then
  new.attributes:=new.attributes||jsonb_build_object('_smart_studio_images',
   (old.attributes->'_smart_studio_images')||case when jsonb_typeof(new.attributes->'_smart_studio_images')='object' then new.attributes->'_smart_studio_images' else '{}'::jsonb end);
 end if;
 new.media:=coalesce(new.media,'{}'::text[]);
 for v_url in select unnest(coalesce(old.media,'{}'::text[])) loop
  if (v_url like '%/item-images/'||old.id::text||'/originals/%'
    or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(old.attributes->'_photo_assets')='array' then old.attributes->'_photo_assets' else '[]'::jsonb end) e where e->>'url'=v_url))
   and not (v_url=any(new.media)) then new.media:=array_append(new.media,v_url);end if;
 end loop;
 return new;
end;$$;
create or replace trigger preserve_captured_photo_references before update of media,attributes on public.items
for each row execute function public.swish_preserve_captured_photo_references();
revoke all on function public.swish_preserve_captured_photo_references() from public,anon,authenticated;
notify pgrst,'reload schema';
