-- Shared normalized financial-event ledger for future marketplace connectors.
-- Additive only: existing eBay finance tables and import flows remain unchanged.
-- Provider payloads and credentials are intentionally excluded.
begin;

create table if not exists public.marketplace_financial_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  marketplace_id text not null,
  external_transaction_id text not null,
  external_order_id text,
  event_type text not null check (event_type in (
    'sale','marketplace_fee','payment_processing_fee','shipping_label',
    'refund','chargeback','payout','adjustment','tax','other'
  )),
  amount numeric(14,2) not null,
  currency char(3) not null default 'GBP',
  fee_type text,
  payout_id text,
  payout_status text,
  occurred_at timestamptz not null,
  source text not null default 'api' check (source in ('api','csv_import','manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketplace_financial_events_external_unique
    unique (tenant_id, marketplace_id, external_transaction_id)
);

create index if not exists marketplace_financial_events_tenant_date_idx
  on public.marketplace_financial_events (tenant_id, occurred_at desc);
create index if not exists marketplace_financial_events_tenant_payout_idx
  on public.marketplace_financial_events (tenant_id, marketplace_id, payout_id)
  where payout_id is not null;

alter table public.marketplace_financial_events enable row level security;
drop policy if exists marketplace_financial_events_read_member on public.marketplace_financial_events;
create policy marketplace_financial_events_read_member
  on public.marketplace_financial_events
  for select to authenticated
  using (
    exists (
      select 1
      from public.tenant_memberships tm
      where tm.tenant_id = marketplace_financial_events.tenant_id
        and tm.user_id = auth.uid()
    )
  );

-- Authenticated tenant members can read their own ledger. Only trusted server
-- functions can write events; no client insert/update/delete grants.
revoke all on public.marketplace_financial_events from public, anon, authenticated;
grant select on public.marketplace_financial_events to authenticated;
grant all on public.marketplace_financial_events to service_role;

commit;
