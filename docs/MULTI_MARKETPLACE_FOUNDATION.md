# SWISH shared marketplace foundation

## Existing production integration

eBay remains the only marketplace currently classified as production-ready.
Its existing OAuth, listing, order, sync and finance Edge Functions remain in
place and are not replaced by this foundation.

## Readiness classifications

- `production`: a real connector is implemented, deployed and verified.
- `assisted`: SWISH prepares content or hands the user to the provider; no
  claim of automated account integration or publishing is made.
- `planned`: marketplace definitions and commercial recommendations may exist,
  but connection, publishing and sync are not available.

The runtime registry in `services/marketplaceReadiness.ts` is deliberately
separate from commercial marketplace definitions. A high recommendation score
is not evidence of technical availability.

## Adapter boundary

`services/marketplaceAdapter.ts` defines normalized listing, order and
financial-event contracts. It is a type and helper layer only; it does not
implement a provider connector or change existing eBay flows.

Provider API calls, OAuth exchanges, token refresh, request signing, retries,
rate limiting and credential decryption must run inside trusted Supabase Edge
Functions. Client types must never contain access tokens, refresh tokens,
client secrets, session cookies or raw provider credential payloads.

## Financial ledger — future, separately approved work

A normalized marketplace financial-event ledger may be useful when a second
production connector exists. It is deliberately **not created by this change**.
Any future table or migration requires a separate review of tenant isolation,
existing tenant helper functions, RLS, idempotency, grants and reporting
reconciliation. Existing `ebay_financials` remains unchanged and remains the
source of truth.

If approved later, the ledger must keep sales, fees, refunds, shipping labels,
chargebacks and payouts as distinct event types. Payouts must never be counted
as sales, and raw provider payloads or credentials must not be stored.

## Integration order

1. Keep eBay production behavior unchanged and add regression tests before any
   adaptation of its finance writer.
2. Implement Amazon SP-API only after seller developer registration and
   required role approval.
3. Implement Vinted only through documented and approved Vinted Pro access.
4. Keep Facebook Marketplace as assisted sharing unless Meta grants a
   supported Marketplace publishing API for the specific seller use case.
5. Promote any channel from planned/assisted only after auth, publish, order,
   finance and tenant-isolation tests pass.

## Non-goals

This foundation does not claim Amazon, Vinted, Etsy, Depop, Shopify, Whatnot or
Facebook Marketplace is connected or capable of automated publishing. It does
not modify eBay OAuth or listing architecture and does not create a second
inventory, orders, tenants, authentication system or database.
