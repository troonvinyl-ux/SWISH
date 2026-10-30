-- Atomic idempotent manifest intake, reusing existing acquisitions/items/listings.
-- Installation mutates no user records; actual writes run only after an authorized purchase confirmation.
create or replace function public.swish_import_manifest_lot(p_tenant_id uuid,p_niche_id text,p_lot jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare
  v_acquisition uuid; v_item uuid; v_listing uuid; v_unit jsonb; v_attrs jsonb;
  v_items jsonb='[]'::jsonb; v_listings jsonb='[]'::jsonb; v_key text; v_specialist text;
  v_physical numeric; v_paid numeric; v_multiplier numeric; v_inbound numeric; v_cost numeric;
  v_qty integer; v_units integer; v_price numeric; v_share numeric; v_spec jsonb;
  v_allocated numeric=0; v_index integer=0;
begin
  if auth.uid() is null or not public.swish_can_access_niche(p_tenant_id,p_niche_id) then raise exception 'Verified paid niche access and tenant membership required' using errcode='42501'; end if;
  if jsonb_typeof(p_lot) is distinct from 'object' or octet_length(p_lot::text)>850000 then raise exception 'Invalid or oversized manifest' using errcode='22023'; end if;
  v_key=p_lot->>'key'; v_specialist=p_lot->>'specialist';
  if v_key is null or v_key !~ '^[a-f0-9]{64}$' or public.swish_specialist_niche(v_specialist) is distinct from p_niche_id then raise exception 'Invalid manifest identity/specialist' using errcode='22023'; end if;
  if jsonb_typeof(p_lot->'units') is distinct from 'array' or jsonb_array_length(p_lot->'units') not between 1 and 1000 then raise exception 'Invalid sale units' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('manifest:'||p_tenant_id::text||':'||p_niche_id||':'||v_key,0));
  select id into v_acquisition from public.acquisitions where tenant_id=p_tenant_id and tags @> array['manifest:'||v_key] limit 1;
  if v_acquisition is not null then
    select coalesce(jsonb_agg(id),'[]'::jsonb) into v_items from public.items where tenant_id=p_tenant_id and acquisition_id=v_acquisition;
    select coalesce(jsonb_agg(l.id),'[]'::jsonb) into v_listings from public.listings l join public.items i on i.id=l.item_id where l.tenant_id=p_tenant_id and i.acquisition_id=v_acquisition;
    return jsonb_build_object('acquisitionId',v_acquisition,'itemIds',v_items,'listingIds',v_listings,'existing',true);
  end if;
  v_paid=(p_lot->>'paid_hammer')::numeric;
  v_multiplier=(1+(p_lot->'assumptions'->>'premiumRate')::numeric)*(1+(p_lot->'assumptions'->>'vatRate')::numeric);
  v_inbound=(p_lot->'assumptions'->>'inbound')::numeric;
  if v_paid is null or v_paid<0 or v_paid>10000000 or v_multiplier is null or v_multiplier not between 1 and 4 or v_inbound is null or v_inbound<0 then raise exception 'Invalid paid costs' using errcode='22023'; end if;
  select sum((u->>'physicalUnits')::numeric) into v_physical from jsonb_array_elements(p_lot->'units') u;
  if v_physical is null or v_physical<=0 or v_physical>1000000 then raise exception 'Invalid physical quantity' using errcode='22023'; end if;
  v_cost=v_paid*v_multiplier+v_inbound;
  insert into public.acquisitions(tenant_id,title,source,purchase_price,transport_cost,item_count,status,tags,notes)
  values(p_tenant_id,left(coalesce(nullif(p_lot->>'name',''),'Manifest lot'),200),'supplier_manifest',v_paid*v_multiplier,v_inbound,v_physical::integer,'pending',array[p_niche_id,'supplier_manifest','manifest:'||v_key],jsonb_build_object('engine_version','manifest-lot-v1','niche_id',p_niche_id,'manifest_key',v_key,'assumptions',p_lot->'assumptions','paid_hammer',v_paid,'analysis',p_lot->'analysis','note','Estimates are user scenarios, not realised profits.')::text) returning id into v_acquisition;
  for v_unit in select value from jsonb_array_elements(p_lot->'units') loop
    v_qty=(v_unit->>'quantity')::integer; v_units=(v_unit->>'physicalUnits')::integer; v_price=(v_unit->>'price')::numeric; v_attrs=v_unit->'attributes';
    if octet_length(v_unit::text)>90000 then raise exception 'Draft item payload too large; split the sale plan' using errcode='22023'; end if;
    if v_qty is null or v_qty not between 1 and 1000000 or v_units is null or v_units<v_qty or v_units%v_qty<>0 or v_price is null or v_price<0 or v_price>10000000 or nullif(btrim(v_unit->>'title'),'') is null or length(v_unit->>'title')>80 or jsonb_typeof(v_attrs) is distinct from 'object' or jsonb_typeof(v_attrs->'ebay_item_specifics') is distinct from 'array' then raise exception 'Invalid draft item' using errcode='22023'; end if;
    if jsonb_array_length(v_attrs->'ebay_item_specifics')>25 then raise exception 'Too many specifics' using errcode='22023'; end if;
    for v_spec in select value from jsonb_array_elements(v_attrs->'ebay_item_specifics') loop
      if nullif(btrim(v_spec->>'name'),'') is null or nullif(btrim(v_spec->>'value'),'') is null or length(v_spec->>'name')>65 or length(v_spec->>'value')>65 then raise exception 'Invalid item specific' using errcode='22023'; end if;
    end loop;
    v_index=v_index+1;
    v_share=case when v_index=jsonb_array_length(p_lot->'units') then round(v_cost,2)-v_allocated else floor(v_cost*v_units/v_physical*100)/100 end;
    v_allocated=v_allocated+v_share;
    insert into public.items(tenant_id,acquisition_id,canonical_title,description,specialist_id,status,condition,condition_notes,identification_source,identification_confidence,valuation_confidence,expected_selling_price,quantity,sku,attributes,media,acquired_cost,warnings,tags)
    values(p_tenant_id,v_acquisition,v_unit->>'title',v_unit->>'description',v_specialist,'review_required',v_unit->>'condition','Manifest proposal; inspect actual item before listing.','unknown',0,'unknown',v_price,v_qty,left(v_unit->>'sku',100),v_attrs||jsonb_build_object('_manifest_key',v_key),array(select jsonb_array_elements_text(coalesce(v_unit->'media','[]'::jsonb))),v_share,array['Supplier manifest is not verified identification or sold-price evidence.'],array['supplier_manifest',p_niche_id]) returning id into v_item;
    v_items=v_items||jsonb_build_array(v_item);
    insert into public.listings(tenant_id,item_id,marketplace_id,title,description,price,floor_price,ceiling_price,shipping_cost,category_id,status)
    values(p_tenant_id,v_item,'ebay',v_unit->>'title',v_unit->>'description',v_price,0,v_price,(p_lot->'assumptions'->>'buyerPostage')::numeric,nullif(v_attrs->>'ebay_category_id',''),'draft') returning id into v_listing;
    v_listings=v_listings||jsonb_build_array(v_listing);
  end loop;
  return jsonb_build_object('acquisitionId',v_acquisition,'itemIds',v_items,'listingIds',v_listings,'existing',false);
end; $$;
revoke all on function public.swish_import_manifest_lot(uuid,text,jsonb) from public,anon;
grant execute on function public.swish_import_manifest_lot(uuid,text,jsonb) to authenticated;
