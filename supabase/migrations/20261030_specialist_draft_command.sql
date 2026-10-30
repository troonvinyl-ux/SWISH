-- Atomic authorised draft command on existing items/listings. Installation changes no user records.
-- SECURITY INVOKER preserves tenant RLS; retry lock retains the existing draft and seller specifics.
create or replace function public.swish_create_listing_draft(p_tenant_id uuid,p_item_id uuid,p_marketplace_id text,p_listing jsonb,p_shipping_cost numeric,p_category_id text default null)
returns uuid language plpgsql security invoker set search_path=pg_catalog,public
as $$
declare v_item public.items%rowtype; v_id uuid; v_specifics jsonb; v_existing jsonb; v_generated jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if jsonb_typeof(p_listing) is distinct from 'object' or nullif(btrim(p_listing->>'title'),'') is null or length(p_listing->>'title')>80 or length(coalesce(p_listing->>'description',''))>50000 then raise exception 'Invalid draft content' using errcode='22023'; end if;
  if nullif(btrim(p_marketplace_id),'') is null or p_shipping_cost is null or p_shipping_cost<0 then raise exception 'Invalid marketplace or delivery cost' using errcode='22023'; end if;
  if (p_listing->>'recommended_price') is null or (p_listing->>'recommended_price')::numeric<0 or (p_listing->>'floor_price') is null or (p_listing->>'floor_price')::numeric<0 or (p_listing->>'ceiling_price') is null or (p_listing->>'ceiling_price')::numeric<0 then raise exception 'Invalid draft prices' using errcode='22023'; end if;
  select * into v_item from public.items where id=p_item_id and tenant_id=p_tenant_id for update;
  if v_item.id is null then raise exception 'Item not found or access denied' using errcode='42501'; end if;
  select id into v_id from public.listings where tenant_id=p_tenant_id and item_id=p_item_id and marketplace_id=p_marketplace_id and status='draft' order by created_at desc limit 1;
  if v_id is not null then return v_id; end if;
  v_existing=case when jsonb_typeof(v_item.attributes->'ebay_item_specifics')='array' then v_item.attributes->'ebay_item_specifics' else '[]'::jsonb end;
  if jsonb_typeof(p_listing->'item_specifics') is distinct from 'object' then raise exception 'Invalid draft specifics' using errcode='22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('name',g.key,'value',g.value)),'[]'::jsonb) into v_generated
  from jsonb_each_text(p_listing->'item_specifics') g
  where nullif(btrim(g.value),'') is not null and not exists(select 1 from jsonb_array_elements(v_existing) e where lower(e->>'name')=lower(g.key));
  v_specifics=v_existing||v_generated;
  if jsonb_array_length(v_specifics)>25 or exists(select 1 from jsonb_array_elements(v_specifics) s where jsonb_typeof(s) is distinct from 'object' or nullif(btrim(s->>'name'),'') is null or nullif(btrim(s->>'value'),'') is null or length(s->>'name')>65 or length(s->>'value')>65) then raise exception 'Invalid or excessive item specifics; no fields were truncated' using errcode='22023'; end if;
  if (select count(distinct lower(s->>'name')) from jsonb_array_elements(v_specifics) s)<>jsonb_array_length(v_specifics) then raise exception 'Duplicate specifics' using errcode='22023'; end if;
  insert into public.listings(tenant_id,item_id,marketplace_id,title,description,price,floor_price,ceiling_price,shipping_cost,category_id,status)
  values(p_tenant_id,p_item_id,p_marketplace_id,btrim(p_listing->>'title'),coalesce(p_listing->>'description',''),(p_listing->>'recommended_price')::numeric,(p_listing->>'floor_price')::numeric,(p_listing->>'ceiling_price')::numeric,p_shipping_cost,nullif(p_category_id,''),'draft') returning id into v_id;
  update public.items set attributes=coalesce(attributes,'{}'::jsonb)||jsonb_build_object('ebay_item_specifics',v_specifics) where id=p_item_id and tenant_id=p_tenant_id;
  return v_id;
end; $$;
revoke all on function public.swish_create_listing_draft(uuid,uuid,text,jsonb,numeric,text) from public,anon;
grant execute on function public.swish_create_listing_draft(uuid,uuid,text,jsonb,numeric,text) to authenticated;
