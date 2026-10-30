-- Track command-only disconnect, atomic listing editor, and Storage ownership hardening.
-- No existing user records are changed by this migration; functions execute only on authorized app actions.
create or replace function public.swish_disconnect_marketplace(p_tenant_id uuid,p_marketplace_id text)
returns void language plpgsql security definer set search_path=pg_catalog,public
as $$ begin
if auth.uid() is null or not public.swish_can_manage_memberships(p_tenant_id) then raise exception 'Owner or admin permission required' using errcode='42501'; end if;
update public.marketplace_connectors set status='disconnected',updated_at=now() where tenant_id=p_tenant_id and marketplace_id=p_marketplace_id;
if not found then raise exception 'Connector not found' using errcode='P0002'; end if;
end; $$;
revoke all on function public.swish_disconnect_marketplace(uuid,text) from public,anon;
grant execute on function public.swish_disconnect_marketplace(uuid,text) to authenticated;

create or replace function public.swish_save_listing_editor(p_tenant_id uuid,p_listing_id uuid,p_listing_patch jsonb,p_item_patch jsonb,p_specifics jsonb)
returns uuid language plpgsql security invoker set search_path=pg_catalog,public
as $$ declare v_item_id uuid; v_quantity integer; begin
if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
if jsonb_typeof(p_listing_patch)<>'object' or jsonb_typeof(p_item_patch)<>'object' or jsonb_typeof(p_specifics)<>'array' then raise exception 'Invalid editor payload' using errcode='22023'; end if;
if jsonb_array_length(p_specifics)>25 or exists(select 1 from jsonb_array_elements(p_specifics) s where jsonb_typeof(s)<>'object' or nullif(btrim(s->>'name'),'') is null or nullif(btrim(s->>'value'),'') is null or length(s->>'name')>65 or length(s->>'value')>65) then raise exception 'Invalid item specifics' using errcode='22023'; end if;
if (select count(distinct lower(s->>'name')) from jsonb_array_elements(p_specifics) s)<>jsonb_array_length(p_specifics) then raise exception 'Duplicate item-specific names' using errcode='22023'; end if;
if nullif(btrim(p_listing_patch->>'title'),'') is null or length(p_listing_patch->>'title')>80 then raise exception 'Invalid listing title' using errcode='22023'; end if;
v_quantity=(p_item_patch->>'quantity')::integer;
if v_quantity is null or v_quantity<1 or (p_listing_patch->>'price')::numeric<0 or (p_listing_patch->>'shipping_cost')::numeric<0 then raise exception 'Invalid prices or quantity' using errcode='22023'; end if;
select item_id into v_item_id from public.listings where id=p_listing_id and tenant_id=p_tenant_id for update;
if v_item_id is null or not exists(select 1 from public.items where id=v_item_id and tenant_id=p_tenant_id) then raise exception 'Listing not found or access denied' using errcode='42501'; end if;
perform 1 from public.items where id=v_item_id and tenant_id=p_tenant_id for update;
update public.listings set title=p_listing_patch->>'title',description=coalesce(p_listing_patch->>'description',''),price=(p_listing_patch->>'price')::numeric,shipping_cost=(p_listing_patch->>'shipping_cost')::numeric,floor_price=(p_listing_patch->>'floor_price')::numeric,ceiling_price=(p_listing_patch->>'ceiling_price')::numeric,category_id=nullif(p_listing_patch->>'category_id',''),updated_at=now() where id=p_listing_id and tenant_id=p_tenant_id;
update public.items set condition=p_item_patch->>'condition',condition_grade=p_item_patch->>'condition_grade',quantity=v_quantity,sku=coalesce(p_item_patch->>'sku',''),attributes=coalesce(attributes,'{}'::jsonb)||jsonb_build_object('ebay_item_specifics',p_specifics,'ebay_category_id',p_item_patch->>'ebay_category_id','ebay_category_name',p_item_patch->>'ebay_category_name'),updated_at=now() where id=v_item_id and tenant_id=p_tenant_id;
return p_listing_id;
end; $$;
revoke all on function public.swish_save_listing_editor(uuid,uuid,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.swish_save_listing_editor(uuid,uuid,jsonb,jsonb,jsonb) to authenticated;

create or replace function public.swish_can_write_item_image(p_name text)
returns boolean language sql stable security definer set search_path=pg_catalog,public
as $$ select auth.uid() is not null and (
exists(select 1 from public.items i where i.id::text=split_part(p_name,'/',1) and i.tenant_id in (select public.swish_user_tenant_ids()))
or exists(select 1 from public.tenant_memberships m where m.tenant_id::text=split_part(p_name,'/',1) and m.user_id=auth.uid())); $$;
revoke all on function public.swish_can_write_item_image(text) from public,anon;
grant execute on function public.swish_can_write_item_image(text) to authenticated;
-- Idempotently add restrictive policies without replacing existing public-read/bucket policies.
do $$ begin
if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='authenticated_insert_owned_item_image') then
execute 'create policy authenticated_insert_owned_item_image on storage.objects as restrictive for insert to authenticated with check (bucket_id <> ''item-images'' or public.swish_can_write_item_image(name))'; end if;
if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='authenticated_update_owned_item_image') then
execute 'create policy authenticated_update_owned_item_image on storage.objects as restrictive for update to authenticated using (bucket_id <> ''item-images'' or public.swish_can_write_item_image(name)) with check (bucket_id <> ''item-images'' or public.swish_can_write_item_image(name))'; end if;
end $$;
