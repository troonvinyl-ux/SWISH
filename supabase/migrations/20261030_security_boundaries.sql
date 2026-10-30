-- Security boundary hardening: tenant_memberships, tenants, marketplace_connectors.
-- Metadata-only migration; no existing user rows or credential payloads are changed.
begin;

-- Client enrolment is forbidden; provisioning retains its existing RPC contract.
revoke insert, update on public.tenant_memberships from public, anon, authenticated;
grant update (role, is_owner) on public.tenant_memberships to authenticated;

create or replace function public.swish_can_manage_memberships(p_tenant_id uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, public
as $$
  select exists (select 1 from public.tenant_memberships
    where tenant_id = p_tenant_id and user_id = auth.uid() and role in ('owner','admin'));
$$;
revoke all on function public.swish_can_manage_memberships(uuid) from public, anon;
grant execute on function public.swish_can_manage_memberships(uuid) to authenticated;
-- Avoid the prior recursive self-query in the membership UPDATE policy.
alter policy owner_manage_memberships on public.tenant_memberships
using (public.swish_can_manage_memberships(tenant_id))
with check (public.swish_can_manage_memberships(tenant_id));

create or replace function public.swish_provision_tenant(p_user_id uuid, p_tenant_name text, p_slug text)
returns uuid language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_tenant_id uuid;
begin
  if auth.uid() is null or p_user_id is distinct from auth.uid() then
    raise exception 'Provisioning is restricted to the authenticated user' using errcode = '42501';
  end if;
  if nullif(btrim(p_tenant_name),'') is null or length(p_tenant_name) > 200
     or nullif(btrim(p_slug),'') is null or length(p_slug) > 100 then
    raise exception 'Invalid tenant details' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
  select tenant_id into v_tenant_id from public.tenant_memberships
    where user_id=p_user_id order by created_at, id limit 1;
  if v_tenant_id is not null then return v_tenant_id; end if;
  -- Only new tenants start free; existing paid/lifetime tiers remain untouched.
  insert into public.tenants(name,slug,subscription_tier,active_specialists)
    values (btrim(p_tenant_name),btrim(p_slug),'starter',array[]::text[])
    returning id into v_tenant_id;
  insert into public.tenant_memberships(tenant_id,user_id,role,is_owner)
    values(v_tenant_id,p_user_id,'owner',true);
  return v_tenant_id;
end;
$$;
revoke all on function public.swish_provision_tenant(uuid,text,text) from public, anon;
grant execute on function public.swish_provision_tenant(uuid,text,text) to authenticated;
alter function public.swish_user_tenant_ids() set search_path = pg_catalog, public;

-- A safe SELECT list in JavaScript is not a database permission boundary.
revoke select, insert, update on public.marketplace_connectors from public, anon, authenticated;
revoke select(credential_ref), insert(credential_ref), update(credential_ref)
  on public.marketplace_connectors from public, anon, authenticated;
grant select(id,tenant_id,marketplace_id,display_name,status,auth_type,access_token_expires_at,
  can_list,can_publish,can_reprice,can_read_orders,can_fulfil,can_buy,can_bid,can_make_offer,
  can_search_opportunities,default_shipping_profile,default_returns_policy,payment_policy_id,
  store_category_tree,seller_account_id,api_calls_today,api_calls_limit,last_sync_at,last_error,
  connected_at,created_at,updated_at,selected_fulfillment_policy_id,selected_return_policy_id,
  selected_payment_policy_id,policies_cached_at) on public.marketplace_connectors to authenticated;
grant insert(tenant_id,marketplace_id,display_name,status) on public.marketplace_connectors to authenticated;
grant update(display_name,default_shipping_profile,default_returns_policy,payment_policy_id,
  selected_fulfillment_policy_id,selected_return_policy_id,selected_payment_policy_id,updated_at)
  on public.marketplace_connectors to authenticated;

-- Billing tiers and identity must only be changed by trusted server operations.
revoke update on public.tenants from public, anon, authenticated;
grant update(name,settings,active_specialists,updated_at) on public.tenants to authenticated;
commit;
