# SWISH multi-marketplace foundation

## Existing production integration
eBay remains the only marketplace currently classified as production-ready.
Its existing OAuth, listing, order, sync and finance Edge Functions remain in
place and are not replaced by this foundation.

## Readiness classifications
- `production`: a real connector is implemented and deployed.
- `assisted`: SWISH prepares content or hands the user to the provider; no
  claim of automated account integration or publishing is made.
- `planned`: marketplace definitions and commercial recommendations may exist,
  but connection, publishing and sync are not available.

The registry in `services/marketplaceReadiness.ts` is deliberately separate
from commercial marketplace definitions. A high recommendation score is not
evidence of technical availability.

## Adapter boundary
`services/marketplaceAdapter.ts` defines normalized listing, order and
financial-event contracts. Provider API calls, OAuth exchanges, token refresh,
request signing, retries and credential decryption must run inside Supabase
Edge Functions. Client types must never contain access tokens, refresh tokens,
client secrets, session cookies or raw provider credential payloads.

## Financial ledger
`marketplace_financial_events` is an additive normalized ledger. Its unique
(tenant, marketplace, external transaction) key makes imports idempotent.
Payouts are separate event types and must never be counted as sales. Refunds,
fees and shipping labels remain separate signed events. No raw provider payload
is stored in this table.

Existing `ebay_financials` remains intact during the first rollout. A later
backfill/dual-write change must be separately tested against eBay's existing
finance dashboard before any consumer switches to the normalized ledger.

## Integration order
1. Keep eBay production behavior unchanged; add regression tests before adapting
   its finance writer to the normalized ledger.
2. Implement Amazon SP-API using the official Amazon SDK/models, after seller
   developer registration and required role approval.
3. Implement Vinted only through documented/approved Vinted Pro partner access.
4. Keep Facebook Marketplace as assisted sharing unless Meta grants a supported
   Marketplace publishing API for the specific seller use case.
5. Promote any channel from planned/assisted only after auth, publish, order,
   finance and tenant-isolation tests pass.

## Non-goals
This foundation does not claim that Amazon, Vinted, Etsy, Depop, Shopify,
Whatnot or Facebook Marketplace is connected or capable of automated publishing.
It does not modify the eBay OAuth or listing architecture and does not create a
second inventory, orders, tenants or authentication system.


## Migration safety
The normalized financial ledger is an additive table with tenant-scoped read RLS. Client roles receive SELECT only; writes are reserved for trusted server functions. Existing eBay finance tables and flows remain the source of truth until a separately reviewed dual-write, backfill and reconciliation release. The migration intentionally does not add an order foreign key, so it does not couple this foundation to any specific order-table schema.
