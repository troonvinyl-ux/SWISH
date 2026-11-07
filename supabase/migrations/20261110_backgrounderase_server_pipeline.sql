-- BackgroundErase: protect server-created studio PNGs and permit linked provider cutouts in draft saves.
-- Schema/policy changes only; no existing images, inventory or listings are rewritten.
create or replace function public.swish_listing_photo_allowed(p_media text[],p_attributes jsonb,p_tenant_id uuid,p_niche_id text,p_uri text)
returns boolean language sql stable security invoker set search_path=pg_catalog,public as $$
 select p_uri=any(coalesce(p_media,'{}'::text[])) or exists(
  select 1 from jsonb_each(case when jsonb_typeof(p_attributes->'_smart_studio_images')='object' then p_attributes->'_smart_studio_images' else '{}'::jsonb end) e
  where e.value->>'enhancedUri'=p_uri and e.value->>'originalUri'=any(coalesce(p_media,'{}'::text[]))
   and e.value->>'status'='ready' and e.value->>'version'='backgrounderase-3.0.0'
   and e.value->>'sourceHash' ~ '^[a-f0-9]{64}$' and e.value->>'cacheKey' ~ '^[a-f0-9]{64}$'
   and e.value#>>'{quality,method}'='backgrounderase' and e.value#>>'{quality,provider}'='BackgroundErase'
   and e.value#>>'{quality,checks,validPng}'='true' and e.value#>>'{quality,checks,dimensionsUnchanged}'='true'
   and e.value#>>'{quality,checks,foregroundPresent}'='true' and e.value#>>'{quality,checks,transparencyPresent}'='true'
   and p_uri like 'https://%/storage/v1/object/public/item-images/'||p_tenant_id::text||'/studio/%/'||p_niche_id||'/'||(e.value->>'cacheKey')||'/presentation.png'
 );
$$;
revoke all on function public.swish_listing_photo_allowed(text[],jsonb,uuid,text,text) from public,anon;
grant execute on function public.swish_listing_photo_allowed(text[],jsonb,uuid,text,text) to authenticated;
-- RLS is already enabled on storage.objects. Service role alone creates studio artefacts.
-- Separate restrictive policies prevent callers forging provenance even with another permissive policy.
do $$
declare role_name text; operation_name text; policy_name text; expression text;
begin
 foreach role_name in array array['anon','authenticated'] loop
  foreach operation_name in array array['insert','update','delete'] loop
   policy_name := role_name||'_'||operation_name||'_server_studio_boundary';
   expression := '(bucket_id <> ''item-images'' or split_part(name,''/'',2) <> ''studio'')';
   if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname=policy_name) then
    if operation_name='insert' then
     execute format('create policy %I on storage.objects as restrictive for insert to %I with check (%s)',policy_name,role_name,expression);
    elsif operation_name='update' then
     execute format('create policy %I on storage.objects as restrictive for update to %I using (%s) with check (%s)',policy_name,role_name,expression,expression);
    else
     execute format('create policy %I on storage.objects as restrictive for delete to %I using (%s)',policy_name,role_name,expression);
    end if;
   end if;
  end loop;
 end loop;
end;
$$;
