-- Add owner-only diagnostic evidence. No business records or existing signing/authorization configuration changed.
create table if not exists public.swish_verification_results (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
 user_id uuid not null references public.user_profiles(id) on delete cascade, test_id text not null, niche_id text,
 platform text not null, result text not null check (result in ('PASS','FAIL','BLOCKED','NOT TESTED')),
 evidence text not null, failure_reason text, reference_id uuid not null default gen_random_uuid(), created_at timestamptz not null default now()
);
alter table public.swish_verification_results enable row level security;
revoke all on public.swish_verification_results from public, anon, authenticated;
grant select on public.swish_verification_results to authenticated;
grant all on public.swish_verification_results to service_role;
do $$ begin
 if not exists (select 1 from pg_policies where schemaname='public' and tablename='swish_verification_results' and policyname='authenticated_select_owner_verification') then
  create policy authenticated_select_owner_verification on public.swish_verification_results for select to authenticated using (public.swish_is_platform_owner() and tenant_id in (select public.swish_user_tenant_ids()));
 end if;
end $$;
create index if not exists swish_verification_scope_recent on public.swish_verification_results(tenant_id,test_id,created_at desc);
