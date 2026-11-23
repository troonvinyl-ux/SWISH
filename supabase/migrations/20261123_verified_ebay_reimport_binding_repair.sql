-- Verified seller re-import repairs ownership on EXISTING eBay-linked items.
-- No new tables, no client-write grants, no status changes or eBay commands.
-- Only trusted Edge code may call this after reading the exact listing IDs
-- from the current member's freshly verified eBay seller account.
begin;
create or replace function public.swish_repair_verified_ebay_import(
 p_tenant_id uuid,p_user_id uuid,p_binding_id uuid,p_niche_id text,p_external_ids text[]
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$
declare
 v_binding public.swish_ebay_bindings%rowtype;
 v_external text;
 v_listing public.listings%rowtype;
 v_item public.items%rowtype;
 v_count integer;
 v_updated integer:=0;
 v_already integer:=0;
 v_unlinked integer:=0;
 v_conflicts integer:=0;
 v_conflict_ids text[]:=array[]::text[];
begin
 if auth.role() is distinct from 'service_role' then
  raise exception 'Trusted eBay seller import required' using errcode='42501';
 end if;
 if p_niche_id is null or p_niche_id='' or p_external_ids is null
    or cardinality(p_external_ids)<1 or cardinality(p_external_ids)>100
    or exists(select 1 from unnest(p_external_ids) x where x !~ '^[0-9]{6,20}$')
 then raise exception 'Invalid bounded eBay import evidence' using errcode='22023';end if;
 select * into v_binding from public.swish_ebay_bindings
 where id=p_binding_id and tenant_id=p_tenant_id and user_id=p_user_id
  and status='connected' and credential_ref is not null
  and ebay_account_id is not null and seller_account_id is not null;
 if not found then raise exception 'The verified member binding has changed' using errcode='42501';end if;

 -- Stable order and explicit row locks: no re-import may transfer records
 -- already bound to another eBay account or another member.
 for v_external in select distinct x from unnest(p_external_ids) x order by x loop
  select count(*) into v_count from public.listings l
  where l.tenant_id=p_tenant_id and lower(btrim(l.marketplace_id)) in ('ebay','ebay_gb')
   and btrim(l.external_listing_id)=v_external;
  if v_count=0 then v_unlinked:=v_unlinked+1;continue;end if;
  if v_count<>1 then
    v_conflicts:=v_conflicts+1;v_conflict_ids:=array_append(v_conflict_ids,v_external);continue;
  end if;
  select * into v_listing from public.listings l
    where l.tenant_id=p_tenant_id and lower(btrim(l.marketplace_id)) in ('ebay','ebay_gb')
     and btrim(l.external_listing_id)=v_external for update;
  select * into v_item from public.items i
    where i.id=v_listing.item_id and i.tenant_id=p_tenant_id for update;
  if not found or public.swish_specialist_niche(v_item.specialist_id) is distinct from p_niche_id
    or (v_item.ebay_binding_id is not null and v_item.ebay_binding_id<>v_binding.id)
    or (v_item.ebay_account_id is not null and v_item.ebay_account_id<>v_binding.ebay_account_id)
    or (v_item.ebay_member_id is not null and v_item.ebay_member_id<>p_user_id)
    or (v_listing.ebay_binding_id is not null and v_listing.ebay_binding_id<>v_binding.id)
    or (v_listing.ebay_account_id is not null and v_listing.ebay_account_id<>v_binding.ebay_account_id)
    or (v_listing.ebay_member_id is not null and v_listing.ebay_member_id<>p_user_id)
    or (nullif(btrim(v_item.attributes->>'_ebay_item_id'),'') is not null
      and btrim(v_item.attributes->>'_ebay_item_id')<>v_external)
  then
    v_conflicts:=v_conflicts+1;v_conflict_ids:=array_append(v_conflict_ids,v_external);continue;
  end if;
  if v_item.ebay_binding_id=v_binding.id and v_item.ebay_account_id=v_binding.ebay_account_id
     and v_item.ebay_member_id=p_user_id and v_listing.ebay_binding_id=v_binding.id
     and v_listing.ebay_account_id=v_binding.ebay_account_id
     and v_listing.ebay_member_id=p_user_id
  then v_already:=v_already+1;continue;end if;

  update public.items set ebay_binding_id=v_binding.id,
    ebay_account_id=v_binding.ebay_account_id,ebay_member_id=p_user_id
    where id=v_item.id and tenant_id=p_tenant_id;
  update public.listings set ebay_binding_id=v_binding.id,
    ebay_account_id=v_binding.ebay_account_id,ebay_member_id=p_user_id
    where id=v_listing.id and tenant_id=p_tenant_id;
  v_updated:=v_updated+1;
 end loop;
 return jsonb_build_object('updated',v_updated,'alreadyLinked',v_already,
   'unlinked',v_unlinked,'conflicts',v_conflicts,'conflictEbayIds',v_conflict_ids,
   'sellerAccountId',v_binding.seller_account_id,'processed',v_updated+v_already+v_unlinked+v_conflicts);
end; $$;
revoke all on function public.swish_repair_verified_ebay_import(uuid,uuid,uuid,text,text[]) from public,anon,authenticated;
grant execute on function public.swish_repair_verified_ebay_import(uuid,uuid,uuid,text,text[]) to service_role;
notify pgrst,'reload schema';
commit;
