# SWISH Edge Function Security Matrix

**Audit date:** 2026-11-02  
**Repository baseline:** `main` at `463d6706e85e77bcf185f05004fbbe1ea4dc3252`  
**Scope:** Static source review of all 25 deployable directories under `supabase/functions/`. This is an architecture inventory, not a live deployment or penetration-test certification.

## Authentication and tenant-boundary inventory

| Edge Function | Source-observed gate | Static review note |
|---|---|---|
| `swish-check-subscription` | OnSpace Cloud Supabase-compatible JWT user verification; derives the caller's tenant memberships | Entitlements are refreshed for the authenticated account; no client-supplied billing claim is treated as authority |
| `swish-coin-image-enhance` | OnSpace Cloud Supabase-compatible JWT user verification | Accepts caller-supplied image data and invokes the configured AI service; no tenant database read/write observed in the reviewed handler |
| `swish-create-checkout` | OnSpace Cloud Supabase-compatible JWT user verification | Checkout is bound to the authenticated user; live Stripe customer/checkout binding still requires environment verification |
| `swish-customer-portal` | OnSpace Cloud Supabase-compatible JWT user verification | Portal session is bound to the authenticated user; live Stripe customer binding still requires environment verification |
| `swish-decompose` | OnSpace Cloud Supabase-compatible JWT user verification plus tenant membership | Tenant-scoped processing |
| `swish-ebay-browse` | OnSpace Cloud Supabase-compatible JWT user verification plus tenant membership | Tenant-scoped marketplace browse |
| `swish-ebay-category` | OnSpace Cloud Supabase-compatible JWT user verification plus tenant membership | Category/aspect access is tenant-gated |
| `swish-ebay-draft-sync-test` | OnSpace Cloud Supabase-compatible JWT user verification plus tenant membership | Test workflow is restricted to explicitly unpublished eBay offers and supported actions; retain review because this is a test-oriented production endpoint |
| `swish-ebay-finances` | OnSpace Cloud Supabase-compatible JWT user verification plus tenant membership | Credentials are decrypted server-side; live finance API/error and fee reconciliation remain open |
| `swish-ebay-list` | JWT + tenant membership; optional `x-swish-internal-secret` is an additional check only | PR #135 removed the secret-only bypass: a supplied internal header is validated but a valid user JWT and tenant-membership row are still mandatory. The authenticated publish path retains its paid-niche guard. No in-repository caller was found; external callers and deployed secret configuration remain unknown. |
| `swish-ebay-listing-status` | OnSpace Cloud Supabase-compatible JWT user verification plus tenant membership | Tenant-scoped listing status |
| `swish-ebay-messages` | OnSpace Cloud Supabase-compatible JWT user verification plus tenant membership | Tenant-scoped messaging; provider-send success must remain distinct from local persistence |
| `swish-ebay-oauth` | OnSpace Cloud Supabase-compatible JWT user verification plus tenant membership | OAuth/token material is encrypted by the shared server-only credential helper |
| `swish-ebay-orders` | OnSpace Cloud Supabase-compatible JWT user verification plus tenant membership | Order import path includes idempotency protections; live reconciliation remains open |
| `swish-ebay-post-order` | OnSpace Cloud Supabase-compatible JWT user verification plus tenant membership | Dispatch, returns and cases are tenant-scoped |
| `swish-ebay-sync` | OnSpace Cloud Supabase-compatible JWT user verification plus tenant membership | The handler requires a Bearer JWT and checks membership. It contains an unused `SWISH_INTERNAL_SECRET` read/comment, but does not read an internal-secret request header or implement a bypass. |
| `swish-identify` | OnSpace Cloud Supabase-compatible JWT user verification, tenant membership and paid-niche authorization | Shared entitlement guard is used |
| `swish-image-download` | OnSpace Cloud Supabase-compatible JWT user verification plus tenant membership | Tenant-scoped image handling |
| `swish-islamic-identify` | OnSpace Cloud Supabase-compatible JWT user verification, tenant membership and paid-niche authorization | Coins entitlement is checked server-side |
| `swish-list-generate` | OnSpace Cloud Supabase-compatible JWT user verification plus tenant membership | Listing generation reads tenant-scoped item data and specialist attributes |
| `swish-market-value` | OnSpace Cloud Supabase-compatible JWT user verification, tenant membership and paid-niche authorization | Shared paid-niche guard is used |
| `swish-migrate-credentials` | OnSpace Cloud Supabase-compatible JWT user verification plus tenant membership and owner/admin role | Tenant ID is mandatory; service-role credential access occurs after privileged membership check |
| `swish-privacy-policy` | Public GET endpoint | Deliberately unauthenticated read-only policy document |
| `swish-reprice` | OnSpace Cloud Supabase-compatible JWT user verification plus tenant membership and niche-scoped authorization | Server-side price application is guarded |
| `swish-verify` | OnSpace Cloud Supabase-compatible JWT user verification plus tenant membership | Tenant-scoped verification |

## Shared security controls observed

- `_shared/credentialCrypto.ts` uses AES-256-GCM and the server-only `SWISH_CREDENTIAL_KEY`; normal reads reject plaintext/malformed credential payloads. Decryption is intended to remain inside trusted Edge Functions.
- `_shared/paidNicheAuthorization.ts` checks tenant membership and server-side verified subscription evidence rather than trusting client billing claims.
- The credential migration endpoint requires the caller to be an owner or admin of the specified tenant before using the service-role client.
- `swish-ebay-list` accepts an optional internal-secret header only as an additional server-to-server check; it cannot replace JWT identity or tenant membership after PR #135. `swish-ebay-sync` remains JWT+membership-only in current source. External caller compatibility and the actual configured state of `SWISH_INTERNAL_SECRET` remain unknown.
- The public privacy-policy function is intentionally GET-only and returns static policy HTML.

## Open verification work — do not mark S1-02 VERIFIED yet

1. **Deployed revision parity:** compare each deployed OnSpace Cloud Edge Function revision with the audited main source. No authenticated OnSpace Cloud deployment session or deployed revision inventory was available for this repository review, so this review cannot establish deployed parity. Do not infer backend availability or deployment status from an unrelated Supabase project.
2. **Database authorization:** verify the effective RLS policies, grants, service-role usage, and tenant ownership constraints against the live project. Static code review cannot prove the deployed database boundary.
3. **Call-path matrix:** trace every client and server caller to its Edge Function, including internal-secret callers, expected JWT mode, tenant/niche inputs, and error handling.
4. **Internal-secret configuration and callers — `swish-ebay-list`:** PR #135 closed the source-level secret-only bypass. A supplied header is now an additional check and the handler still requires a valid user JWT plus tenant membership before reaching the paid-niche gate. No in-repository caller was found. Confirm external/OnSpace callers, configured secret presence/rotation and compatibility against the acknowledged deployment; never print the secret. `swish-ebay-sync` remains JWT-only in current source despite an unused secret variable/comment.
5. **Direct-query inventory:** screens and pages still issue direct Supabase queries; map each to the effective RLS policy and avoid assuming service-layer coverage is complete.
6. **Input, idempotency and redaction review:** complete per-function validation, replay/idempotency, rate-limit, response-redaction and log-content checks.
7. **Live acceptance:** run authenticated/unauthenticated, cross-tenant, wrong-niche, expired-entitlement and owner/admin-negative tests against deployed functions and database policies.

## Verdict

**S1-02 remains IMPLEMENTED, not VERIFIED.** This matrix closes the repository-level function inventory gap for the 25 deployable Edge Function directories. PR #135 closes the source-level `swish-ebay-list` secret-only bypass, but deployed revision parity, effective RLS, direct-query mapping, external caller/configuration checks and live call-path verification remain open.


## Direct-query and caller review boundary

The architecture audit records 47 unique files with direct database-query matches (43 `supabase.from(...)` files plus five additional `getSupabaseClient().from(...)` matches, one overlap) and 29 source files with Edge Function invocation matches. These are search-derived inventories, not a complete dynamic call graph. Client-side tenant predicates are not a substitute for OnSpace Cloud RLS. Function rows above record source-observed guards only; they do not prove effective deployed policy. In particular, verify the deployed `swish-ebay-list` revision and any external caller/configuration for its optional additional secret header; it no longer bypasses JWT or tenant membership in current source. `swish-ebay-sync` is JWT-only in current source. Do not expose or print secret values during verification.
