# SWISH Edge Function Security Matrix

**Audit date:** 2026-11-02  
**Repository baseline:** `main` at `99ccbf4893126cad3f27ff7dc573359fb5d91f71`  
**Scope:** Static source review of all 25 deployable directories under `supabase/functions/`. This is an architecture inventory, not a live deployment or penetration-test certification.

## Authentication and tenant-boundary inventory

| Edge Function | Source-observed gate | Static review note |
|---|---|---|
| `swish-check-subscription` | Supabase JWT user verification; derives the caller's tenant memberships | Entitlements are refreshed for the authenticated account; no client-supplied billing claim is treated as authority |
| `swish-coin-image-enhance` | Supabase JWT user verification | Accepts caller-supplied image data and invokes the configured AI service; no tenant database read/write observed in the reviewed handler |
| `swish-create-checkout` | Supabase JWT user verification | Checkout is bound to the authenticated user; live Stripe customer/checkout binding still requires environment verification |
| `swish-customer-portal` | Supabase JWT user verification | Portal session is bound to the authenticated user; live Stripe customer binding still requires environment verification |
| `swish-decompose` | Supabase JWT user verification plus tenant membership | Tenant-scoped processing |
| `swish-ebay-browse` | Supabase JWT user verification plus tenant membership | Tenant-scoped marketplace browse |
| `swish-ebay-category` | Supabase JWT user verification plus tenant membership | Category/aspect access is tenant-gated |
| `swish-ebay-draft-sync-test` | Supabase JWT user verification plus tenant membership | Test workflow is restricted to explicitly unpublished eBay offers and supported actions; retain review because this is a test-oriented production endpoint |
| `swish-ebay-finances` | Supabase JWT user verification plus tenant membership | Credentials are decrypted server-side; live finance API/error and fee reconciliation remain open |
| `swish-ebay-list` | Supabase JWT user verification plus tenant membership; also has a server-to-server secret path | Internal-secret bypass requires separate deployed-secret and caller-scope verification |
| `swish-ebay-listing-status` | Supabase JWT user verification plus tenant membership | Tenant-scoped listing status |
| `swish-ebay-messages` | Supabase JWT user verification plus tenant membership | Tenant-scoped messaging; provider-send success must remain distinct from local persistence |
| `swish-ebay-oauth` | Supabase JWT user verification plus tenant membership | OAuth/token material is encrypted by the shared server-only credential helper |
| `swish-ebay-orders` | Supabase JWT user verification plus tenant membership | Order import path includes idempotency protections; live reconciliation remains open |
| `swish-ebay-post-order` | Supabase JWT user verification plus tenant membership | Dispatch, returns and cases are tenant-scoped |
| `swish-ebay-sync` | Supabase JWT user verification plus tenant membership; also has a server-to-server secret path | Internal-secret bypass requires separate deployed-secret and caller-scope verification |
| `swish-identify` | Supabase JWT user verification, tenant membership and paid-niche authorization | Shared entitlement guard is used |
| `swish-image-download` | Supabase JWT user verification plus tenant membership | Tenant-scoped image handling |
| `swish-islamic-identify` | Supabase JWT user verification, tenant membership and paid-niche authorization | Coins entitlement is checked server-side |
| `swish-list-generate` | Supabase JWT user verification plus tenant membership | Listing generation reads tenant-scoped item data and specialist attributes |
| `swish-market-value` | Supabase JWT user verification, tenant membership and paid-niche authorization | Shared paid-niche guard is used |
| `swish-migrate-credentials` | Supabase JWT user verification plus tenant membership and owner/admin role | Tenant ID is mandatory; service-role credential access occurs after privileged membership check |
| `swish-privacy-policy` | Public GET endpoint | Deliberately unauthenticated read-only policy document |
| `swish-reprice` | Supabase JWT user verification plus tenant membership and niche-scoped authorization | Server-side price application is guarded |
| `swish-verify` | Supabase JWT user verification plus tenant membership | Tenant-scoped verification |

## Shared security controls observed

- `_shared/credentialCrypto.ts` uses AES-256-GCM and the server-only `SWISH_CREDENTIAL_KEY`; normal reads reject plaintext/malformed credential payloads. Decryption is intended to remain inside trusted Edge Functions.
- `_shared/paidNicheAuthorization.ts` checks tenant membership and server-side verified subscription evidence rather than trusting client billing claims.
- The credential migration endpoint requires the caller to be an owner or admin of the specified tenant before using the service-role client.
- The eBay listing and sync functions have internal-secret paths in addition to JWT membership paths; those paths need explicit deployed-secret and call-origin verification.
- The public privacy-policy function is intentionally GET-only and returns static policy HTML.

## Open verification work — do not mark S1-02 VERIFIED yet

1. **Deployed revision parity:** compare each deployed Edge Function revision with the audited main source. The connected Supabase project was previously reported inactive, so this review cannot establish deployed parity.
2. **Database authorization:** verify the effective RLS policies, grants, service-role usage, and tenant ownership constraints against the live project. Static code review cannot prove the deployed database boundary.
3. **Call-path matrix:** trace every client and server caller to its Edge Function, including internal-secret callers, expected JWT mode, tenant/niche inputs, and error handling.
4. **Internal-secret paths:** verify secret rotation/storage and ensure the listing/sync bypass can only be invoked by intended trusted server callers with a valid tenant scope.
5. **Direct-query inventory:** screens and pages still issue direct Supabase queries; map each to the effective RLS policy and avoid assuming service-layer coverage is complete.
6. **Input, idempotency and redaction review:** complete per-function validation, replay/idempotency, rate-limit, response-redaction and log-content checks.
7. **Live acceptance:** run authenticated/unauthenticated, cross-tenant, wrong-niche, expired-entitlement and owner/admin-negative tests against deployed functions and database policies.

## Verdict

**S1-02 remains IMPLEMENTED, not VERIFIED.** This matrix closes the repository-level function inventory gap for the 25 deployable Edge Function directories. It does not close deployed authorization, effective RLS, direct-query, internal-secret caller, or live call-path verification.
