# Antique category guidance and connection-pool timeout handling

## Observed evidence — 2026-11-04

The reported screen shows `Timed out acquiring connection from connection pool.` Backend log retrieval was executed, not inferred from screenshots alone:

- 22:11:25 UTC: `business_config` GET returned 504.
- 22:10:54 UTC: scoped `swish_niche_settings` GET returned 504.
- 22:10:23 UTC: Antique `items` GET returned 504.
- 22:10:18 UTC: owner RPC returned 503.
- Several inventory count requests returned 499/504; earlier owner RPCs also returned 404, requiring follow-up if they recur.

This establishes a backend availability failure across several resources, not an invalid account or expired eBay token. It does **not** establish the underlying provider pool-sizing cause. This editor cannot restart or reconfigure OnSpace's managed connection pool.

Read-only SQL diagnostics completed during this investigation: 17 database connections, 10 active, zero lock waiters and zero idle-in-transaction sessions at that instant. This does not prove that the gateway pool recovered permanently. The final aggregate inventory read returned two Antique items, one with linked photos and one with a saved category; it does not verify every capture workflow.

## Code changes

- Distinguish connection/network/pool timeouts from account-verification failures in the existing root route; preserve fail-closed authorization.
- Initialize trusted tenant/membership access before optional business configuration. A settings timeout cannot invalidate an otherwise authorized account. No default or offline grants were added.
- Deduplicate same-user account and membership loading; stop repeated retry taps from queuing initialization requests.
- Attempt module activation once per workspace; a failed activation requires explicit retry rather than an effect-driven retry loop. Preserve backend error detail.
- Deduplicate in-flight badge counts by tenant and specialist set. Badge polling stops when access is unavailable or a module is opening, and skips background requests.
- Add material/object-led category search guidance in the existing listing workflow. The reported Apulian-style Lekanis lid produces the search `pottery ceramic lekanis lid` and visible **Pottery / ceramics** guidance, without treating style as authenticated ancient provenance.
- Request suggestions through the existing eBay Taxonomy services. Return actual provider IDs and full category paths, excluding unrelated coin or ceramic-militaria results for this search. No new AI engine, database, inventory or eBay account was created.
- Present candidate categories for user selection instead of silently assigning a visual-search category to Antique items. Selection uses the existing authenticated, tenant-scoped, optimistic-concurrency save and persisted readback.
- Treat an ambiguous failed forced-live aspects lookup as unverified, not as success with empty requirements. Cached/curated category labels are leads, not live validation.

## Category recommendation

Use the current eBay UK pottery/ceramic leaf category appropriate to the object. The local database contains legacy cached ID `870` labelled `Ceramics & Pottery`, but this investigation did not authenticate to eBay to establish its current name, validity or leaf status. **No hard-coded category ID was assigned to this user's item.** Live taxonomy must validate the seller-selected category and retrieve its item specifics. Ancient origin, provenance and authenticity remain separate, unconfirmed matters.

## Verification status

- **Executed:** backend log inspection and read-only SQL connection/category/inventory checks.
- **Implemented:** retry-loop prevention, request deduplication, correct availability presentation and pottery/ceramic search/review UI.
- **Added, not executed here:** `services/__tests__/antiqueCategoryAvailability.test.ts` — pure, mocked-client and source-contract regressions. Included in the existing Antique verification workflow, alongside its full service suite and TypeScript gates.
- **Not executed:** Jest, native app launch, authenticated category lookup/save/reload, provider pool recovery, eBay publication. No production-readiness claim.
- **No user inventory/category/media data was modified by SQL.** No connections were terminated, credentials accessed, permissions weakened or inventory published.

## Device follow-up

1. Load the updated build; if the backend remains unavailable, retry the connection once rather than repeatedly tapping or rescanning.
2. Reopen the saved Antique item, choose Create Listing, and use Find pottery / ceramic categories. Review the returned path, select a suitable leaf, and confirm its required specifics load and save/reload correctly.
3. If connection-pool 503/504 errors persist, contact `contact@onspace.ai` with the backend/project reference and UTC timestamps above. Provider-level pool remediation is outside this editor's controls.
