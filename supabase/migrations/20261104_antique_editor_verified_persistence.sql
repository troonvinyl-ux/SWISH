-- Antique editor repair: existing canonical command; installation does not change user records.
-- Applied via OnSpace SQL during the 2026-11-04 audit. Safe to reapply this function definition.
create or replace function public.swish_save_listing_editor(p_tenant_id uuid,p_listing_id uuid,p_listing_patch jsonb,p_item_patch jsonb,p_specifics jsonb)
returns uuid language plpgsql security invoker set search_path=pg_catalog,public as $$
declare v_item_id uuid; v_quantity integer; v_antique boolean; v_extra jsonb := '{}'::jsonb;
begin
if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
if jsonb_typeof(p_listing_patch) is distinct from 'object' or jsonb_typeof(p_item_patch) is distinct from 'object' or jsonb_typeof(p_specifics) is distinct from 'array' then raise exception 'Invalid editor payload' using errcode='22023'; end if;
if jsonb_array_length(p_specifics)>25 or exists(select 1 from jsonb_array_elements(p_specifics) s where jsonb_typeof(s) is distinct from 'object' or nullif(btrim(s->>'name'),'') is null or nullif(btrim(s->>'value'),'') is null or length(s->>'name')>65 or length(s->>'value')>65) then raise exception 'Invalid item specifics' using errcode='22023'; end if;
if (select count(distinct lower(btrim(s->>'name'))) from jsonb_array_elements(p_specifics) s)<>jsonb_array_length(p_specifics) then raise exception 'Duplicate item-specific names' using errcode='22023'; end if;
if nullif(btrim(p_listing_patch->>'title'),'') is null or length(p_listing_patch->>'title')>80 then raise exception 'Invalid listing title' using errcode='22023'; end if;
v_quantity=(p_item_patch->>'quantity')::integer;
if v_quantity is null or v_quantity<1 or (p_listing_patch->>'price') is null or (p_listing_patch->>'price')::numeric<0 or (p_listing_patch->>'shipping_cost') is null or (p_listing_patch->>'shipping_cost')::numeric<0 then raise exception 'Invalid prices or quantity' using errcode='22023'; end if;
select item_id into v_item_id from public.listings where id=p_listing_id and tenant_id=p_tenant_id for update;
if v_item_id is null then raise exception 'Listing not found or access denied' using errcode='42501'; end if;
select public.swish_specialist_niche(specialist_id)='antiques' into v_antique from public.items where id=v_item_id and tenant_id=p_tenant_id for update;
if not found then raise exception 'Item not found or access denied' using errcode='42501'; end if;
if v_antique then
 if length(coalesce(p_item_patch->>'condition_notes',''))>1000 then raise exception 'Condition notes exceed eBay limit' using errcode='22023'; end if;
 if p_item_patch ? 'ebay_listing_options' then
  if jsonb_typeof(p_item_patch->'ebay_listing_options') is distinct from 'object' then raise exception 'Invalid listing options' using errcode='22023'; end if;
  v_extra=v_extra||jsonb_build_object('ebay_listing_options',p_item_patch->'ebay_listing_options');
 end if;
 if p_item_patch ? 'ebay_listing_media' then
  if jsonb_typeof(p_item_patch->'ebay_listing_media') is distinct from 'array' or jsonb_array_length(p_item_patch->'ebay_listing_media')>12 then raise exception 'Invalid listing photos' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements_text(p_item_patch->'ebay_listing_media') u where u not like 'https://%' or not exists(select 1 from public.items i where i.id=v_item_id and i.tenant_id=p_tenant_id and u=any(i.media))) then raise exception 'Choose original inventory photographs' using errcode='22023'; end if;
  v_extra=v_extra||jsonb_build_object('ebay_listing_media',p_item_patch->'ebay_listing_media');
 end if;
 if p_item_patch ? 'ebay_condition_id' then v_extra=v_extra||jsonb_build_object('ebay_condition_id',coalesce(p_item_patch->>'ebay_condition_id','')); end if;
end if;
update public.listings set title=p_listing_patch->>'title',description=coalesce(p_listing_patch->>'description',''),price=(p_listing_patch->>'price')::numeric,shipping_cost=(p_listing_patch->>'shipping_cost')::numeric,floor_price=(p_listing_patch->>'floor_price')::numeric,ceiling_price=(p_listing_patch->>'ceiling_price')::numeric,category_id=nullif(p_listing_patch->>'category_id',''),updated_at=now() where id=p_listing_id and tenant_id=p_tenant_id;
if not found then raise exception 'Listing save denied' using errcode='42501'; end if;
update public.items set condition=p_item_patch->>'condition',condition_grade=case when v_antique then condition_grade else p_item_patch->>'condition_grade' end,condition_notes=case when v_antique and p_item_patch ? 'condition_notes' then p_item_patch->>'condition_notes' else condition_notes end,quantity=v_quantity,sku=coalesce(p_item_patch->>'sku',''),attributes=coalesce(attributes,'{}'::jsonb)||jsonb_build_object('ebay_item_specifics',p_specifics,'ebay_category_id',p_item_patch->>'ebay_category_id','ebay_category_name',p_item_patch->>'ebay_category_name')||v_extra,updated_at=now() where id=v_item_id and tenant_id=p_tenant_id;
if not found then raise exception 'Item save denied' using errcode='42501'; end if;
return p_listing_id;
end; $$;
revoke all on function public.swish_save_listing_editor(uuid,uuid,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.swish_save_listing_editor(uuid,uuid,jsonb,jsonb,jsonb) to authenticated;
