create function public.swish_recover_pending_ebay_publish(
  p_tenant_id uuid, p_listing_id uuid, p_claim_id uuid, p_binding_id uuid,
  p_external_id text, p_status text, p_quantity integer, p_quantity_sold integer,
  p_started_at timestamptz, p_ended_at timestamptz
) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  saved public.listings%rowtype;
  binding public.swish_ebay_bindings%rowtype;
begin
  if p_external_id is null or p_external_id !~ '^[0-9]{6,20}$' or p_claim_id is null then
    raise exception 'Invalid eBay recovery evidence';
  end if;
  select * into binding from public.swish_ebay_bindings
    where id=p_binding_id and tenant_id=p_tenant_id and status='connected' for share;
  if not found then raise exception 'Seller binding changed'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || p_external_id, 0));
  select * into saved from public.listings
    where id=p_listing_id and tenant_id=p_tenant_id and marketplace_id='ebay'
      and publish_claim_id=p_claim_id and nullif(external_listing_id,'') is null
      and (ebay_binding_id=p_binding_id or (ebay_binding_id is null and binding.revision=1 and import_source is null))
    for update;
  if not found or saved.publish_claimed_at is null or p_started_at is null
    or p_started_at < saved.publish_claimed_at - interval '2 minutes'
    or p_started_at > saved.publish_claimed_at + interval '30 minutes' then
    raise exception 'Pending submission changed or listing time differs';
  end if;
  if exists (select 1 from public.listings where tenant_id=p_tenant_id
    and marketplace_id in ('ebay','ebay_gb') and external_listing_id=p_external_id and id<>p_listing_id) then
    raise exception 'eBay item is already linked';
  end if;
  update public.items set ebay_binding_id=binding.id, ebay_account_id=binding.ebay_account_id, ebay_member_id=binding.user_id
    where id=saved.item_id and tenant_id=p_tenant_id
      and (ebay_binding_id is null or ebay_binding_id=binding.id)
      and (ebay_account_id is null or ebay_account_id=binding.ebay_account_id)
      and (ebay_member_id is null or ebay_member_id=binding.user_id);
  if not found then raise exception 'Inventory belongs to another seller'; end if;
  update public.listings set external_listing_id=p_external_id, ebay_binding_id=binding.id,
    published_at=p_started_at, publish_claim_id=null, publish_claimed_at=null
    where id=p_listing_id;
  perform public.swish_apply_ebay_listing_status(p_tenant_id,p_listing_id,p_external_id,p_status,p_quantity,p_quantity_sold,p_ended_at);
end;
$$;
revoke all on function public.swish_recover_pending_ebay_publish(uuid,uuid,uuid,uuid,text,text,integer,integer,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.swish_recover_pending_ebay_publish(uuid,uuid,uuid,uuid,text,text,integer,integer,timestamptz,timestamptz) to service_role;
