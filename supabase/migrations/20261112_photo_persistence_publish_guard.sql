-- Schema-only publication guard. Existing items, media, claims and credentials are not modified.
-- Serialize with canonical photo metadata CAS so a pending capture cannot win a publish race.
create or replace function public.swish_claim_listing_publish(p_listing_id uuid,p_tenant_id uuid)
returns uuid language plpgsql security definer set search_path=pg_catalog,public
as $$ declare v_claim uuid;v_item public.items%rowtype;begin
 select i.* into v_item from public.items i join public.listings l on l.item_id=i.id and l.tenant_id=i.tenant_id
 where l.id=p_listing_id and l.tenant_id=p_tenant_id for update of i;
 if not found or coalesce(cardinality(v_item.media),0)=0 then return null;end if;
 if v_item.attributes ? '_photo_pipeline' then
  if v_item.attributes->'_photo_pipeline'->>'version' is distinct from 'canonical-photos-v1'
   or v_item.attributes->'_photo_pipeline'->>'status' is distinct from 'complete'
   or jsonb_typeof(v_item.attributes->'_photo_pipeline'->'expected') is distinct from 'array' then return null;end if;
  if jsonb_array_length(v_item.attributes->'_photo_pipeline'->'expected')=0
   or exists(select 1 from jsonb_array_elements(v_item.attributes->'_photo_pipeline'->'expected') e
    where e->>'url' is null or not (e->>'url'=any(v_item.media))) then return null;end if;
 end if;
 update public.listings set publish_claim_id=gen_random_uuid(),publish_claimed_at=now()
 where id=p_listing_id and tenant_id=p_tenant_id and marketplace_id='ebay'
  and status in ('draft','pending','failed') and nullif(external_listing_id,'') is null
  and publish_claim_id is null returning publish_claim_id into v_claim;
 return v_claim;
end;$$;
revoke all on function public.swish_claim_listing_publish(uuid,uuid) from public,anon,authenticated;
grant execute on function public.swish_claim_listing_publish(uuid,uuid) to service_role;
notify pgrst,'reload schema';
