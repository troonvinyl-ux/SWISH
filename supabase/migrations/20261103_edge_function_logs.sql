-- Realtime, owner-only Edge Function execution telemetry.
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

drop policy if exists edge_function_logs_owner_read on public.edge_function_logs;
create policy edge_function_logs_owner_read on public.edge_function_logs
  for select to authenticated
  using (lower(coalesce(auth.jwt() ->> 'email','')) = 'troonvinyl@gmail.com');

-- Enable INSERT events for Supabase Realtime without disturbing other publication members.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'edge_function_logs'
     ) then
    alter publication supabase_realtime add table public.edge_function_logs;
  end if;
end $$;

comment on table public.edge_function_logs is
  'Metadata-only execution telemetry for SWISH Edge Functions. Owner-readable; service-role writable.';
commit;
