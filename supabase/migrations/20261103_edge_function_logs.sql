-- Polling-compatible, owner-only Edge Function execution telemetry.
-- Stores metadata only: never request/response bodies, headers, tokens or secrets.
begin;

create table if not exists public.edge_function_logs (
  id uuid primary key default gen_random_uuid(),
  invocation_id uuid not null unique default gen_random_uuid(),
  function_name text not null check (length(function_name) between 1 and 100),
  tenant_id uuid null,
  niche_id text null check (niche_id is null or length(niche_id) <= 80),
  outcome text not null check (outcome in ('success','client_error','failure')),
  status_code integer not null check (status_code between 100 and 599),
  duration_ms integer not null check (duration_ms >= 0),
  error_code text null check (error_code is null or length(error_code) <= 80),
  created_at timestamptz not null default now()
);

create index if not exists edge_function_logs_created_at_idx
  on public.edge_function_logs (created_at desc);
create index if not exists edge_function_logs_function_created_idx
  on public.edge_function_logs (function_name, created_at desc);
create index if not exists edge_function_logs_outcome_created_idx
  on public.edge_function_logs (outcome, created_at desc);

alter table public.edge_function_logs enable row level security;
revoke all on public.edge_function_logs from public, anon, authenticated;
grant select on public.edge_function_logs to authenticated;
grant insert on public.edge_function_logs to service_role;

do $$ begin
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='edge_function_logs' and policyname='authenticated_select_owner_edge_logs') then
    create policy authenticated_select_owner_edge_logs on public.edge_function_logs for select to authenticated using(lower(coalesce(auth.jwt()->>'email',''))='troonvinyl@gmail.com');
  end if;
end $$;

-- OnSpace Cloud does not support Realtime subscriptions. Read telemetry by polling; do not alter publications.

comment on table public.edge_function_logs is
  'Metadata-only execution telemetry for SWISH Edge Functions. Owner-readable; service-role writable.';
commit;
