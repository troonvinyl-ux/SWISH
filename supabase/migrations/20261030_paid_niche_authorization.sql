-- Trusted paid-niche cache and restrictive inventory authorization.
-- Additive schema only: no item, listing, membership or historical specialist IDs are rewritten.
begin;
create table if not exists public.niche_entitlements (
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  niche_id text not null,
  expires_at timestamptz not null,
  checked_at timestamptz not null,
  primary key(user_id,niche_id),
  constraint niche_entitlement_known_product check (niche_id in ('coins','motocross','bicycles','clothing','trading_cards','antiques','fossils','beauty','tech','surplus_flip'))
);
create table if not exists public.niche_entitlement_checks (
  user_id uuid primary key references public.user_profiles(id) on delete cascade,
  checked_at timestamptz not null
);
alter table public.niche_entitlements enable row level security;
alter table public.niche_entitlement_checks enable row level security;
revoke all on public.niche_entitlements,public.niche_entitlement_checks from public,anon,authenticated;
grant select on public.niche_entitlements to authenticated;
grant all on public.niche_entitlements,public.niche_entitlement_checks to service_role;
-- Client may inspect its own cache, never grant/refresh/revoke access.
create policy authenticated_select_own_niche_entitlements on public.niche_entitlements for select to authenticated using(user_id=auth.uid());

create or replace function public.swish_specialist_niche(p_specialist text)
returns text language sql immutable set search_path=pg_catalog,public as $$
  select niche from (values
    ('coins','coins'),('islamic_silver','coins'),('banknotes','coins'),('gold','coins'),('silver','coins'),('jewellery_precious_metals','coins'),('ancient_artefacts','coins'),('coins_uk','coins'),('coins_world','coins'),('coins_currency','coins'),('numismatic','coins'),
    ('motocross','motocross'),('mx','motocross'),('bicycles','bicycles'),('bikes','bicycles'),('cycling','bicycles'),
    ('clothing','clothing'),('trainers_sneakers','clothing'),('clothing_specialist','clothing'),('threads','clothing'),('threads_flip','clothing'),
    ('pokemon_cards','trading_cards'),('trading_cards','trading_cards'),('cards','trading_cards'),
    ('antiques','antiques'),('books','antiques'),('fossils','fossils'),('beauty','beauty'),('tech','tech'),('retro_games','tech'),('retro_consoles','tech'),('surplus_trader','surplus_flip'),('surplus_flip','surplus_flip')
  ) as mapping(specialist,niche) where specialist=p_specialist;
$$;
create or replace function public.swish_can_access_niche(p_tenant_id uuid,p_niche_id text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select auth.uid() is not null
    and exists(select 1 from public.tenant_memberships where user_id=auth.uid() and tenant_id=p_tenant_id)
    and (
      exists(select 1 from public.tenants where id=p_tenant_id and subscription_tier in ('professional','business','enterprise','lifetime'))
      or exists(select 1 from public.niche_entitlements where user_id=auth.uid() and niche_id=p_niche_id and expires_at>now())
    );
$$;
revoke all on function public.swish_specialist_niche(text),public.swish_can_access_niche(uuid,text) from public,anon;
grant execute on function public.swish_specialist_niche(text),public.swish_can_access_niche(uuid,text) to authenticated,service_role;

create or replace function public.swish_cache_verified_niches(p_user_id uuid,p_checked_at timestamptz,p_grants jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_last timestamptz; v_grant jsonb;
begin
  -- This RPC is executable only by service_role. No caller-supplied client claims.
  if p_user_id is null or p_checked_at is null or p_checked_at>clock_timestamp()+interval '5 seconds'
    or jsonb_typeof(p_grants) is distinct from 'array' or jsonb_array_length(p_grants)>10 then
    raise exception 'Invalid verified entitlement snapshot' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('swish_entitlements:'||p_user_id::text,0));
  select checked_at into v_last from public.niche_entitlement_checks where user_id=p_user_id;
  if v_last is not null and v_last>=p_checked_at then return true; end if;
  for v_grant in select value from jsonb_array_elements(p_grants) loop
    if public.swish_specialist_niche(v_grant->>'niche_id') is distinct from (v_grant->>'niche_id')
      or (v_grant->>'expires_at')::timestamptz<=p_checked_at
      or (v_grant->>'expires_at')::timestamptz>p_checked_at+interval '5 minutes' then
      raise exception 'Invalid entitlement validity' using errcode='22023';
    end if;
  end loop;
  -- Cache-only expiry update, not inventory or user profile modification. Runs only after verified Stripe response.
  update public.niche_entitlements set expires_at=p_checked_at,checked_at=p_checked_at where user_id=p_user_id;
  for v_grant in select value from jsonb_array_elements(p_grants) loop
    insert into public.niche_entitlements(user_id,niche_id,expires_at,checked_at)
      values(p_user_id,v_grant->>'niche_id',(v_grant->>'expires_at')::timestamptz,p_checked_at)
      on conflict(user_id,niche_id) do update set expires_at=excluded.expires_at,checked_at=excluded.checked_at;
  end loop;
  insert into public.niche_entitlement_checks(user_id,checked_at) values(p_user_id,p_checked_at)
    on conflict(user_id) do update set checked_at=excluded.checked_at;
  return true;
end;
$$;
revoke all on function public.swish_cache_verified_niches(uuid,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.swish_cache_verified_niches(uuid,timestamptz,jsonb) to service_role;

-- Retain original ownership policies and AND paid access with them; no permissive bypass.
create policy authenticated_select_paid_items on public.items as restrictive for select to authenticated using(public.swish_can_access_niche(tenant_id,public.swish_specialist_niche(specialist_id)));
create policy authenticated_insert_paid_items on public.items as restrictive for insert to authenticated with check(public.swish_can_access_niche(tenant_id,public.swish_specialist_niche(specialist_id)));
create policy authenticated_update_paid_items on public.items as restrictive for update to authenticated using(public.swish_can_access_niche(tenant_id,public.swish_specialist_niche(specialist_id))) with check(public.swish_can_access_niche(tenant_id,public.swish_specialist_niche(specialist_id)));
create policy authenticated_delete_paid_items on public.items as restrictive for delete to authenticated using(public.swish_can_access_niche(tenant_id,public.swish_specialist_niche(specialist_id)));
-- Prevent listing joins from exposing inventory in an unpaid niche.
create policy authenticated_select_paid_listings on public.listings as restrictive for select to authenticated using(exists(select 1 from public.items where id=item_id and tenant_id=listings.tenant_id));
create policy authenticated_insert_paid_listings on public.listings as restrictive for insert to authenticated with check(exists(select 1 from public.items where id=item_id and tenant_id=listings.tenant_id));
create policy authenticated_update_paid_listings on public.listings as restrictive for update to authenticated using(exists(select 1 from public.items where id=item_id and tenant_id=listings.tenant_id)) with check(exists(select 1 from public.items where id=item_id and tenant_id=listings.tenant_id));
create policy authenticated_select_paid_valuations on public.valuations as restrictive for select to authenticated using(exists(select 1 from public.items where id=item_id and tenant_id=valuations.tenant_id));

-- Close direct tenant creation (the established provisioning RPC still creates starter tenants).
revoke insert on public.tenants from public,anon,authenticated;
create or replace function public.swish_guard_paid_identity()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  if auth.role()='authenticated' then
    if tg_table_name='tenants' then
      if new.subscription_tier is distinct from old.subscription_tier then raise exception 'Billing tier is server-managed' using errcode='42501'; end if;
    elsif tg_table_name='items' then
      if new.specialist_id is distinct from old.specialist_id then raise exception 'Historical specialist identity is immutable through client inventory APIs' using errcode='42501'; end if;
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_tenant_paid_tier before update on public.tenants for each row execute function public.swish_guard_paid_identity();
create trigger guard_item_specialist_identity before update on public.items for each row execute function public.swish_guard_paid_identity();
commit;
