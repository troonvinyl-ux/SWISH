-- Niche preferences overlay existing tenant business defaults; not another membership system.
create table if not exists public.swish_niche_settings (
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 niche_id text not null, settings jsonb not null default '{}', updated_at timestamptz not null default now(),
 primary key(tenant_id,niche_id)
);
alter table public.swish_niche_settings enable row level security;
create policy authenticated_select_module_settings on public.swish_niche_settings for select to authenticated using(public.swish_can_access_niche(tenant_id,niche_id));
create policy authenticated_insert_module_settings on public.swish_niche_settings for insert to authenticated with check(public.swish_can_access_niche(tenant_id,niche_id));
create policy authenticated_update_module_settings on public.swish_niche_settings for update to authenticated using(public.swish_can_access_niche(tenant_id,niche_id)) with check(public.swish_can_access_niche(tenant_id,niche_id));
grant select,insert,update on public.swish_niche_settings to authenticated;
grant all on public.swish_niche_settings to service_role;
create table if not exists public.swish_release_catalog(id uuid primary key default gen_random_uuid(),channel text not null,platform text not null check(platform in ('android','ios','web')),version text not null,build_number text,runtime_version text,source_sha text not null,artifact_url text,artifact_sha256 text,certificate_sha256 text,affected_niches text[] not null default '{}',release_notes text not null default '',status text not null default 'pending' check(status in ('pending','verified','withdrawn')),created_at timestamptz not null default now());
alter table public.swish_release_catalog enable row level security;
revoke all on public.swish_release_catalog from public,anon,authenticated;
grant select on public.swish_release_catalog to authenticated;
grant all on public.swish_release_catalog to service_role;
create policy authenticated_select_verified_releases on public.swish_release_catalog for select to authenticated using(status='verified');
create policy authenticated_select_owner_releases on public.swish_release_catalog for select to authenticated using(public.swish_is_platform_owner());
