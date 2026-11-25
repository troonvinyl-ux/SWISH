begin;

create table public.swish_delivery_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid not null,
  binding_id uuid not null references public.swish_ebay_bindings(id) on delete cascade,
  marketplace text not null check (marketplace = 'EBAY_GB'),
  name text not null check (char_length(name) between 1 and 80),
  configuration jsonb not null check (jsonb_typeof(configuration) = 'object'),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id, binding_id, marketplace, name),
  unique (tenant_id, user_id, binding_id, marketplace, id)
);

create table public.swish_delivery_defaults (
  tenant_id uuid not null,
  user_id uuid not null,
  binding_id uuid not null,
  marketplace text not null,
  niche_id text not null,
  profile_id uuid not null,
  primary key (tenant_id, user_id, binding_id, marketplace, niche_id),
  foreign key (tenant_id, user_id, binding_id, marketplace, profile_id)
    references public.swish_delivery_profiles (tenant_id, user_id, binding_id, marketplace, id)
    on delete cascade
);

alter table public.swish_delivery_profiles enable row level security;
alter table public.swish_delivery_defaults enable row level security;
revoke all on public.swish_delivery_profiles, public.swish_delivery_defaults from public, anon, authenticated;
grant select, insert, update on public.swish_delivery_profiles, public.swish_delivery_defaults to service_role;

create function public.swish_save_delivery_profile(
  p_tenant_id uuid, p_user_id uuid, p_binding_id uuid, p_niche_id text,
  p_configuration jsonb, p_make_default boolean, p_expected_version integer
) returns public.swish_delivery_profiles
language plpgsql set search_path = pg_catalog, public as $$
declare
  saved public.swish_delivery_profiles;
  profile_name text := p_configuration->>'profileName';
begin
  perform 1 from public.swish_ebay_bindings
  where id = p_binding_id and tenant_id = p_tenant_id and user_id = p_user_id
    and status = 'connected' and credential_ref is not null
  for share;
  if not found then
    raise exception 'The eBay account binding changed' using errcode = '42501';
  end if;

  if p_expected_version is null then
    insert into public.swish_delivery_profiles (tenant_id, user_id, binding_id, marketplace, name, configuration)
    values (p_tenant_id, p_user_id, p_binding_id, 'EBAY_GB', profile_name, p_configuration)
    on conflict (tenant_id, user_id, binding_id, marketplace, name) do nothing
    returning * into saved;
  else
    update public.swish_delivery_profiles
    set configuration = p_configuration, version = version + 1, updated_at = now()
    where tenant_id = p_tenant_id and user_id = p_user_id and binding_id = p_binding_id
      and marketplace = 'EBAY_GB' and name = profile_name and version = p_expected_version
    returning * into saved;
  end if;
  if saved.id is null then
    raise exception 'Reload delivery preferences before saving' using errcode = '40001';
  end if;

  if p_make_default then
    insert into public.swish_delivery_defaults (tenant_id, user_id, binding_id, marketplace, niche_id, profile_id)
    values (p_tenant_id, p_user_id, p_binding_id, 'EBAY_GB', p_niche_id, saved.id)
    on conflict (tenant_id, user_id, binding_id, marketplace, niche_id)
    do update set profile_id = excluded.profile_id;
  end if;
  return saved;
end;
$$;
revoke all on function public.swish_save_delivery_profile(uuid, uuid, uuid, text, jsonb, boolean, integer) from public, anon, authenticated;
grant execute on function public.swish_save_delivery_profile(uuid, uuid, uuid, text, jsonb, boolean, integer) to service_role;
commit;
