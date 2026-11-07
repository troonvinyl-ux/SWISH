-- Atomic eBay intake into the EXISTING items/listings relationship.
-- Installation changes schema only; no historical identities are merged, deleted or rewritten.
begin;
create or replace function public.swish_import_ebay_inventory(p_tenant_id uuid,p_niche_id text,p_external_id text,p_item jsonb,p_listing jsonb,p_existing_item_id uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_scope jsonb;v_ids uuid[];v_item public.items%rowtype;v_listing uuid;v_new boolean:=false;v_qty integer;v_attrs jsonb;v_ref text;
begin
  v_scope:=public.swish_current_module();
  if auth.uid() is null or v_scope->>'tenant_id' is distinct from p_tenant_id::text or v_scope->>'niche_id' is distinct from p_niche_id
    or not public.swish_can_access_niche(p_tenant_id,p_niche_id) then raise exception 'Current tenant and paid module required' using errcode='42501'; end if;
  p_external_id:=btrim(p_external_id);
  if p_external_id is null or p_external_id !~ '^[0-9]{6,20}$' or jsonb_typeof(p_item)<>'object' or jsonb_typeof(p_listing)<>'object'
    or octet_length(p_item::text)>90000 or octet_length(p_listing::text)>90000 then raise exception 'Invalid import payload' using errcode='22023'; end if;
  if public.swish_specialist_niche(p_item->>'specialist_id') is distinct from p_niche_id then raise exception 'Import specialist scope mismatch' using errcode='42501'; end if;
  v_qty:=coalesce((p_item->>'quantity')::integer,1);
  if v_qty<0 or v_qty>1000000 then raise exception 'Invalid inventory quantity' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('ebay-item:'||p_tenant_id::text||':'||p_external_id,0));
  select array_agg(distinct i.id) into v_ids from public.items i where i.tenant_id=p_tenant_id and
    (btrim(i.attributes->>'_ebay_item_id')=p_external_id or exists(select 1 from public.listings l where l.item_id=i.id and l.tenant_id=i.tenant_id
      and lower(btrim(l.marketplace_id)) in ('ebay','ebay_gb') and btrim(l.external_listing_id)=p_external_id));
  if cardinality(v_ids)>1 then raise exception 'Ambiguous historical eBay identity: review required; nothing imported' using errcode='23505'; end if;
  if cardinality(v_ids)=1 then
    select * into v_item from public.items where id=v_ids[1] and tenant_id=p_tenant_id for update;
  elsif p_existing_item_id is not null then
    select * into v_item from public.items where id=p_existing_item_id and tenant_id=p_tenant_id for update;
    if not found then raise exception 'Selected canonical item not in this account' using errcode='42501'; end if;
  else
    -- Only a permanent canonical inventory reference may auto-link a different
    -- external listing. A barcode, generic SKU or matching title is not copy identity.
    v_ref:=nullif(btrim(p_item->>'sku'),'');
    if v_ref is not null then
      select array_agg(id) into v_ids from public.items where tenant_id=p_tenant_id and inventory_id=v_ref;
      if cardinality(v_ids)>1 then raise exception 'Ambiguous inventory reference requires review' using errcode='23505'; end if;
      if cardinality(v_ids)=1 then select * into v_item from public.items where id=v_ids[1] and tenant_id=p_tenant_id for update; end if;
    end if;
  end if;
  if v_item.id is not null and public.swish_specialist_niche(v_item.specialist_id) is distinct from p_niche_id then
    raise exception 'Existing identity belongs to another module; no import performed' using errcode='42501';
  end if;
  if v_item.id is not null then
    select id into v_listing from public.listings where tenant_id=p_tenant_id and item_id=v_item.id
      and lower(btrim(marketplace_id)) in ('ebay','ebay_gb') and btrim(external_listing_id)=p_external_id order by updated_at desc nulls last,id limit 1;
    if v_listing is not null then return jsonb_build_object('itemId',v_item.id,'listingId',v_listing,'inventoryId',v_item.inventory_id,'existing',true); end if;
  else
    if nullif(p_item->>'acquisition_id','') is not null and not exists(select 1 from public.acquisitions where id=(p_item->>'acquisition_id')::uuid and tenant_id=p_tenant_id) then raise exception 'Acquisition scope mismatch' using errcode='42501'; end if;
    v_attrs:=coalesce(p_item->'attributes','{}'::jsonb)||jsonb_build_object('_ebay_item_id',p_external_id,'niche_id',p_niche_id);
    insert into public.items(tenant_id,acquisition_id,canonical_title,description,specialist_id,status,disposition_decision,condition,condition_grade,condition_notes,identification_confidence,identification_source,valuation_low,valuation_mid,valuation_high,valuation_confidence,expected_selling_price,expected_net,expected_profit,sale_prob_30d,attributes,media,warnings,tags,acquired_cost,inventory_id,folder_number,pocket_position,catalogue_number,sku,quantity,ruler,denomination,year_made,country_of_origin,material,period,mint,sold_price,sold_at,marketplace,inventory_origin,source_import_id)
    values(p_tenant_id,nullif(p_item->>'acquisition_id','')::uuid,left(p_item->>'canonical_title',200),coalesce(p_item->>'description',''),p_item->>'specialist_id',coalesce(p_item->>'status','identified'),coalesce(p_item->>'disposition_decision','sell_individual'),coalesce(p_item->>'condition',''),coalesce(p_item->>'condition_grade',''),coalesce(p_item->>'condition_notes',''),coalesce((p_item->>'identification_confidence')::numeric,0),coalesce(p_item->>'identification_source','unknown'),coalesce((p_item->>'valuation_low')::numeric,0),coalesce((p_item->>'valuation_mid')::numeric,0),coalesce((p_item->>'valuation_high')::numeric,0),coalesce(p_item->>'valuation_confidence','unknown'),coalesce((p_item->>'expected_selling_price')::numeric,0),coalesce((p_item->>'expected_net')::numeric,0),coalesce((p_item->>'expected_profit')::numeric,0),coalesce((p_item->>'sale_prob_30d')::numeric,0),v_attrs,array(select jsonb_array_elements_text(coalesce(p_item->'media','[]'::jsonb))),array(select jsonb_array_elements_text(coalesce(p_item->'warnings','[]'::jsonb))),array(select jsonb_array_elements_text(coalesce(p_item->'tags','[]'::jsonb))),coalesce((p_item->>'acquired_cost')::numeric,0),coalesce(nullif(p_item->>'inventory_id',''),public.kc_next_inventory_id(p_tenant_id)),coalesce(p_item->>'folder_number',''),coalesce(p_item->>'pocket_position',''),coalesce(p_item->>'catalogue_number',''),coalesce(p_item->>'sku',''),v_qty,coalesce(p_item->>'ruler',''),coalesce(p_item->>'denomination',''),coalesce(p_item->>'year_made',''),coalesce(p_item->>'country_of_origin',''),coalesce(p_item->>'material',''),coalesce(p_item->>'period',''),coalesce(p_item->>'mint',''),(p_item->>'sold_price')::numeric,(p_item->>'sold_at')::timestamptz,p_item->>'marketplace',coalesce(p_item->>'inventory_origin','ebay_import'),nullif(p_item->>'source_import_id','')::uuid) returning * into v_item;
    v_new:=true;
  end if;
  insert into public.listings(tenant_id,item_id,marketplace_id,external_listing_id,title,description,price,floor_price,ceiling_price,status,shipping_cost,views,watchers,published_at,ended_at,category_id,import_source,import_id)
    values(p_tenant_id,v_item.id,'ebay',p_external_id,coalesce(p_listing->>'title',v_item.canonical_title),coalesce(p_listing->>'description',''),coalesce((p_listing->>'price')::numeric,0),coalesce((p_listing->>'floor_price')::numeric,0),coalesce((p_listing->>'ceiling_price')::numeric,0),coalesce(p_listing->>'status','active'),coalesce((p_listing->>'shipping_cost')::numeric,0),coalesce((p_listing->>'views')::integer,0),coalesce((p_listing->>'watchers')::integer,0),(p_listing->>'published_at')::timestamptz,(p_listing->>'ended_at')::timestamptz,nullif(p_listing->>'category_id',''),p_listing->>'import_source',nullif(p_listing->>'import_id','')::uuid) returning id into v_listing;
  return jsonb_build_object('itemId',v_item.id,'listingId',v_listing,'inventoryId',v_item.inventory_id,'existing',not v_new);
end; $$;
revoke all on function public.swish_import_ebay_inventory(uuid,text,text,jsonb,jsonb,uuid) from public,anon;
grant execute on function public.swish_import_ebay_inventory(uuid,text,text,jsonb,jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
