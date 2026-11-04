-- Unified SWISH shell: trusted owner identity and per-auth-session module scope.
-- Existing accounts, items, listings, eBay credentials and paid policies are retained.
begin;
create table if not exists public.swish_platform_owners (
  user_id uuid primary key references public.user_profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.swish_platform_owners enable row level security;
revoke all on public.swish_platform_owners from public,anon,authenticated;
grant select on public.swish_platform_owners to authenticated;
grant all on public.swish_platform_owners to service_role;
create policy authenticated_select_own_platform_role on public.swish_platform_owners for select to authenticated using(user_id=auth.uid());
-- Only verified auth identities can be bound; editable profile/metadata email never grants a role.
insert into public.swish_platform_owners(user_id)
select u.id from auth.users u join public.user_profiles p on p.id=u.id
where lower(u.email)='troonvinyl@gmail.com' and u.email_confirmed_at is not null
on conflict do nothing;
create or replace function public.swish_bind_platform_owner()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if lower(new.email)='troonvinyl@gmail.com' and new.email_confirmed_at is not null
     and exists(select 1 from public.user_profiles where id=new.id) then
    insert into public.swish_platform_owners(user_id) values(new.id) on conflict do nothing;
  end if;
  return new;
end; $$;
create trigger swish_bind_verified_owner after insert or update of email,email_confirmed_at on auth.users for each row execute function public.swish_bind_platform_owner();
create or replace function public.swish_owner_for_user(p_user_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
select exists(select 1 from public.swish_platform_owners r join auth.users u on u.id=r.user_id
where r.user_id=p_user_id and lower(u.email)='troonvinyl@gmail.com' and u.email_confirmed_at is not null); $$;
revoke all on function public.swish_owner_for_user(uuid) from public,anon,authenticated;
grant execute on function public.swish_owner_for_user(uuid) to service_role;
create or replace function public.swish_is_platform_owner()
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
select auth.uid() is not null and public.swish_owner_for_user(auth.uid()); $$;
revoke all on function public.swish_is_platform_owner() from public,anon;
grant execute on function public.swish_is_platform_owner() to authenticated,service_role;

create table if not exists public.swish_module_sessions (
 session_id text primary key,
 user_id uuid not null references public.user_profiles(id) on delete cascade,
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 niche_id text,
 updated_at timestamptz not null default now()
);
alter table public.swish_module_sessions enable row level security;
revoke all on public.swish_module_sessions from public,anon,authenticated;
grant select on public.swish_module_sessions to authenticated;
grant all on public.swish_module_sessions to service_role;
create policy authenticated_select_own_module_session on public.swish_module_sessions for select to authenticated
using(user_id=auth.uid() and session_id=auth.jwt()->>'session_id');

-- No duplicated taxonomy: preserve canonical specialist identities, add the existing Collectibles identity.
create or replace function public.swish_specialist_niche(p_specialist text)
returns text language sql immutable set search_path=pg_catalog,public as $$
select niche from (values
('coins','coins'),('islamic_silver','coins'),('banknotes','coins'),('gold','coins'),('silver','coins'),('jewellery_precious_metals','coins'),('ancient_artefacts','coins'),('coins_uk','coins'),('coins_world','coins'),('coins_currency','coins'),('numismatic','coins'),
('motocross','motocross'),('mx','motocross'),('bicycles','bicycles'),('bikes','bicycles'),('cycling','bicycles'),
('clothing','clothing'),('trainers_sneakers','clothing'),('clothing_specialist','clothing'),('threads','clothing'),('threads_flip','clothing'),
('pokemon_cards','trading_cards'),('trading_cards','trading_cards'),('cards','trading_cards'),('antiques','antiques'),('books','antiques'),
('fossils','fossils'),('beauty','beauty'),('tech','tech'),('retro_games','tech'),('retro_consoles','tech'),('surplus_trader','surplus_flip'),('surplus_flip','surplus_flip'),('collectibles','collectibles')
) as mapping(specialist,niche) where specialist=p_specialist; $$;

create or replace function public.swish_has_niche_entitlement(p_tenant_id uuid,p_niche_id text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
select auth.uid() is not null and exists(select 1 from public.tenant_memberships where user_id=auth.uid() and tenant_id=p_tenant_id)
and (public.swish_is_platform_owner() or exists(select 1 from public.tenants where id=p_tenant_id and subscription_tier in ('professional','business','enterprise','lifetime'))
or exists(select 1 from public.niche_entitlements where user_id=auth.uid() and niche_id=p_niche_id and expires_at>now())); $$;
create or replace function public.swish_current_module()
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
select jsonb_build_object('tenant_id',tenant_id,'niche_id',niche_id) from public.swish_module_sessions
where session_id=auth.jwt()->>'session_id' and user_id=auth.uid(); $$;
create or replace function public.swish_can_access_niche(p_tenant_id uuid,p_niche_id text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
select public.swish_has_niche_entitlement(p_tenant_id,p_niche_id) and
-- Existing separately installed clients have no scope row until migrated. Their paid RLS remains unchanged.
(not exists(select 1 from public.swish_module_sessions where session_id=auth.jwt()->>'session_id' and user_id=auth.uid())
or exists(select 1 from public.swish_module_sessions where session_id=auth.jwt()->>'session_id' and user_id=auth.uid() and tenant_id=p_tenant_id and niche_id=p_niche_id)); $$;
create or replace function public.swish_open_module(p_tenant_id uuid,p_niche_id text)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_session text:=auth.jwt()->>'session_id';
begin
 if auth.uid() is null or v_session is null then raise exception 'Authenticated session required' using errcode='42501'; end if;
 if not exists(select 1 from public.tenant_memberships where user_id=auth.uid() and tenant_id=p_tenant_id) then raise exception 'Account access denied' using errcode='42501'; end if;
 if p_niche_id is not null and not public.swish_has_niche_entitlement(p_tenant_id,p_niche_id) then raise exception 'Niche entitlement required' using errcode='42501'; end if;
 insert into public.swish_module_sessions(session_id,user_id,tenant_id,niche_id) values(v_session,auth.uid(),p_tenant_id,p_niche_id)
 on conflict(session_id) do update set tenant_id=excluded.tenant_id,niche_id=excluded.niche_id,updated_at=now() where swish_module_sessions.user_id=auth.uid();
 return true;
end; $$;
revoke all on function public.swish_has_niche_entitlement(uuid,text),public.swish_current_module(),public.swish_open_module(uuid,text) from public,anon;
grant execute on function public.swish_has_niche_entitlement(uuid,text),public.swish_current_module(),public.swish_open_module(uuid,text) to authenticated,service_role;

-- Scope realized sales and feedback as well as the already protected items/listings/orders.
create policy authenticated_select_module_sales on public.sales as restrictive for select to authenticated
using(public.swish_can_access_niche(tenant_id,coalesce(niche_id,public.swish_specialist_niche(specialist_id),(select public.swish_specialist_niche(i.specialist_id) from public.items i where i.id=item_id and i.tenant_id=sales.tenant_id))));
create policy authenticated_select_module_feedback on public.ai_id_feedback as restrictive for select to authenticated using(public.swish_can_access_niche(tenant_id,public.swish_specialist_niche(specialist_id)));
create policy authenticated_insert_module_feedback on public.ai_id_feedback as restrictive for insert to authenticated with check(public.swish_can_access_niche(tenant_id,public.swish_specialist_niche(specialist_id)));
commit;
-- Known external migration blocker: the old niche_entitlement_known_product CHECK still excludes
-- Collectibles and the old cache RPC still caps snapshots at ten. No existing constraint is dropped
-- by this migration. Apply the separately reviewed billing-cache migration through authorized CI.
