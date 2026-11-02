# S2 / S3 implementation and acceptance report

Date: 2026-11-02. No production or full-stage verification claim.

## What was built

- S2 typed extension/scope/evidence contracts and dependency validator over the existing canonical registry.
- Explicit scanner routes in all ten registry entries, derived product types/list and generated backend identity parity gate.
- Antiques adaptive capture adapter; nonexistent specialist routes removed from active declarations/shortcuts in favour of the existing stock/item editor.
- Atomic inventory lifecycle RPC: row lock, tenant/RLS/paid-niche authorization, confirmed-listing requirement, sold-state protection, audit event and lifecycle event in one transaction. Client archive/transition/sale helpers use it and require a positive server acknowledgement. Sale records remain explicitly user-reported, not marketplace verification.
- Idempotent, service-only eBay message ingestion over the existing message schema, with scoped provider IDs and preservation of operator read/reply/archive/full-body state. No unique index was added because existing duplicate rows were not audited or deleted.
- Message data moved out of the UI into a service/hook, scope-aware async snapshots, error-aware read/archive, reply confirmation and local-sync warning. Local acknowledgement templates no longer pretend to be AI or assert an unverified dispatch.
- Core acceptance workflow: source contract gate, full regression, independent type/lint steps, server tests and an explicitly opt-in protected read-only deployed verification job. Production Control discovers its results by workflow filename.

## What changed

Fixed confirmed source/schema defects:
1. Backend registry mirror was stale (Coins route path and Antiques ownership differed from canonical).
2. Antiques scanner and multiple home shortcuts referenced files absent from the current route tree.
3. Secret regression suite tried to read nonexistent `_shared/nicheAuthorization.ts` instead of the canonical `shared/nicheAuthorization.ts`.
4. Message ingestion used nonexistent `ebay_item_id` and `onConflict: ebay_message_id` without an actual unique key. It also reset operator reply state during sync.
5. The inbox silently ignored read/archive errors and could show a sent state without an eBay acknowledgement; full message body absence was hidden behind a placeholder.
6. Lifecycle state/event writes were independent and could report success after missing rows or failed audit writes. Omitted tenant arguments still allowed unscoped updates.
7. Fee aggregation discarded `booking_entry` even though eBay debit amounts may be positive. The existing aggregator now receives the booking sign.
8. Rate-derived profit fees could be labelled actual and negative currency was formatted as a positive amount.
9. Finance sync reported blanket success even with persisted-row failures or a partial provider fetch; it now reports partial/incomplete.
10. Existing readiness workflows requested a pnpm-specific cache before the lockfile-selecting installer. This session removed that unnecessary cache assumption in the two edited workflows, not the lockfile requirement.
11. A documentation-only live integration job could appear green. It is now explicitly skipped; opt-in live verification fails closed when fixture configuration is missing.

## What was not changed

One existing OnSpace Cloud backend, existing auth/session provider/client, tenant provisioning, item UUIDs, existing buckets, eBay OAuth/publish/orders architecture, Stripe product/prices, installed app identities, OTA/APK signing and release targets remain in place. No second database, inventory, authentication, marketplace service or AI engine was created. No user records were deleted or cleaned up.

## Database changes

Applied only function/grant DDL from `20261102_core_atomic_commands.sql` to the connected OnSpace Cloud:
- `swish_transition_item`: security invoker; authenticated/service execution; anon denied.
- `swish_ingest_ebay_message`: fixed search-path security definer; service-only execution; authenticated/anon denied.

No tables/columns/buckets were added and applying the DDL did not execute either mutation command on user data. The tracked migration and deployed definitions implement the same behavior. No order/sales ledger migration or automatic duplicate cleanup.

## API/service / AI / marketplace changes

Existing client lifecycle helpers now call the atomic transition command. The new message service/hook call the existing Edge Function plus existing message table; GetMyMessages pagination is bounded to ten pages and partial sync is surfaced rather than marked successful. The eBay message server uses the service-only ingestion RPC and persisted tenant-owned recipient/item metadata. CORS in the two edited functions reuses `_shared/cors.ts`.

No new model/provider/AI request. Unknown AI source metadata now stays `unknown`, not automatically `researched`. Capture/evidence/valuation engines remain the existing ones.

Marketplace send/publish success is not fabricated. Message send timeouts require checking eBay before retry. Message summary pagination is now implemented and covered by CI; full provider response/seller permission acceptance, body retrieval, reply concurrency/idempotency, remote acknowledgements and production 400/499 diagnosis still require live provider acceptance. A source repair is not proof that eBay permissions/keyset/remote service are working.

## eBay message pagination follow-up

The existing `swish-ebay-messages` sync previously requested only page 1 of `GetMyMessages` and could silently omit older messages when the mailbox returned multiple pages. The source now reads the reported page count, fetches pages sequentially (maximum 10 × 50 summaries per invocation), and exposes `pagesFetched`, `pagesTotal`, `truncated` and explicit partial-sync errors. If a later page fails, already received messages are retained and the response reports incomplete rather than success. The inbox now surfaces partial results and reloads saved messages when some were imported. XML request construction, namespace-tolerant page parsing, page caps and invalid page rejection have five focused Jest tests.

This is source implementation only. It does not verify the eBay Trading API response shape, seller permissions, message body retrieval (still unavailable in this summary route), remote send acknowledgements or the deployed OnSpace Cloud function revision. A mailbox exceeding ten pages needs a narrower date-range retrieval path; the function reports this condition rather than claiming complete sync.

## eBay UK fee and postage model follow-up

The canonical profit engine is now version `v1.3`. Its prior generic 2025-era 12.8% + £0.30 estimate did not represent the current UK business-seller schedule. The revised model uses the official eBay UK business fee table (last updated 30 September 2026): category-specific rates for supported specialist families, the 0.35% regulatory operating fee, £0.30 per order up to £10 / £0.40 above £10, and published high-value tiers for coins, jewellery, watches, retro consoles and trainers. UK private sellers can be modelled separately (no domestic final-value/regulatory fee; 3% for international delivery). Business international fee rates accept destination-specific overrides; when a UK business sale is marked international but no destination rate is supplied, the estimate uses the conservative 2% 'all other countries' rate. Exact fees from eBay Finances bypass estimates.

Buyer-paid postage is now separate from seller postage and included in both the fee base and revenue. Estimated fees correctly make the overall profit result `isEstimate=true`. Ten focused tests cover the UK business default, low-order fixed fee, coin tier, niche rates, trainer threshold, private domestic/international, explicit fee-rate override, exact fee override and versioning.

Source: https://www.ebay.co.uk/help/selling/fees-credits-invoices/store-selling-fees?id=4809. This remains an estimate: seller shop terms, account performance surcharges, fee VAT treatment, promoted listings, listing upgrades, taxes, destination-specific international rates and actual category leaf selection can change fees. No live seller account fee schedule was queried; the eBay Finances API remains the actual-fee source of truth.

## Security changes

All item mutations through updateItem now reject missing tenant scope. Atomic transitions are invoker/RLS scoped, and actor metadata is determined from the session, not a client supplied automation label. Marketplace-only status requires retained external-ID evidence. Message flags are tenant scoped and update only on confirmed persistence. Provider message ingestion cannot be invoked by client roles. Credentials remain server-only; no keys were requested or exposed.

## Latest CI evidence — PR #132

On commit `812c3b191f8e9e1ec7fbd6b007395f8091223737`, GitHub Actions completed successfully:
- Master readiness run `41465023973`: 14/14 jobs passed. The regression job passed lint, register validation, TypeScript and **554 tests across 13 suites**; Edge Function syntax/secret-boundary guard and **4 Deno paid-niche authorization tests** passed; all ten branded Android JavaScript bundles and the private Master Admin bundle passed.
- Branded web run `41465024074`: 10/10 niche exports passed.
- Niche routing/config run `41465023802`: passed.
- Production register validation run `41465023780`: passed.

The `Live integration checks (explicitly gated)` job reports success because the live-check gate was not enabled; it did not execute live OnSpace Cloud/eBay checks. Android JavaScript bundling is not a native APK/AAB build, and web export is not proof of hosted deployment.

## Tests performed and results (actually executed)

Read-only catalog queries on the connected backend returned:
- All public tables have RLS (`tables_without_rls = 0`).
- Authenticated role cannot read connector `credential_ref`.
- Authenticated role cannot insert tenants or insert/update memberships.
- Authenticated role cannot insert entitlement records or execute the verified cache command.
- Four restrictive item paid-niche policies are present.
- Message schema contains `item_id`/`order_id`, not `ebay_item_id`; no unique message key exists.
- After function DDL: transition is invoker; anon denied; authenticated transition allowed; authenticated provider ingestion denied; service provider ingestion allowed.
- An explicit transaction under `anon` exercised both new command calls and observed insufficient-privilege denial. Transaction rolled back; no user data modified.
- Backend/network log tools returned no recent errors/requests. This is absence of observations, not proof of healthy provider workflows.
- GitHub reported the pre-change production register workflow `41374815746` success at commit `14bb1abf6a97780c0cbe3169164c8a94b00093c3`. This does not verify this session's code. Complete CI failure logs were not available through the fetched responses, so identified source defects are not represented as all CI failures resolved.

## Live acceptance not executed

`verify-s3-live.mjs` was not run because the live integration gate was not enabled. It requires explicit opt-in and the protected `swish-s3-verification` environment. The targeted 13-suite Jest run and four Deno authorization tests are now executed in CI; this is not the complete repository-wide test suite. No real login/media upload, authenticated cross-tenant mutation, AI accuracy, live eBay transaction/finance reconciliation, notification delivery or installed-device result is claimed.

Run:
```
node scripts/validate-foundation.mjs
node scripts/validate-production-register.mjs
bash scripts/install-dependencies.sh
pnpm dlx jest@29.7.0 --config jest.config.ci.js --runInBand
npx tsc --noEmit
pnpm lint
deno test --allow-read --allow-env supabase/tests/paidNicheAuthorization.test.ts
```

## Live verification setup

The S2-S3 workflow's `run_live_checks` defaults false; skipped is not passed. Configure the protected GitHub environment `swish-s3-verification` with the secret names declared in the workflow. Use approved, distinct test users/tenants with pre-existing owned items and paid access, pointing at the intended existing backend. No new auth system or fixtures are automatically created.

The runner logs only check names/statuses, authenticates with the existing password API, refreshes sessions, checks positive owned-item reads, negative cross-tenant item/membership reads, trusted niche access and credential-column denial, then signs out its sessions. It creates a commit-bound JSON artifact. Its explicit `notCovered` list excludes OTP, media, AI accuracy, live eBay, fee/order reconciliation and device/notifications. It does not automatically promote register tasks.

## eBay Finances 400/499 source-path diagnosis (not a production root-cause finding)

A source review of `swish-ebay-finances` narrows what the historical 99 HTTP 400 responses can mean:
- The function itself returns HTTP 400 for malformed request JSON/object, invalid `tenantId`, unsupported `route`, invalid `daysBack`, or when `getToken` reports `requiresReauth`.
- `getToken` sets `requiresReauth` when the connector is missing/disconnected, stored credentials cannot be decrypted, the access token is missing/expired without usable refresh credentials, or eBay's OAuth refresh endpoint returns 400/401/403.
- A non-authentication HTTP 400 from the upstream eBay `/transaction` endpoint is not returned as an Edge Function 400 in the current handler: it is recorded as a fetch error and mapped to a 403 when no transaction rows were retrieved (or returned as a partial result if rows were already received).
- The current finance screen and Seller Hub call the valid `get_funds_summary` route with the tenant ID; those call sites do not send an invalid `daysBack` value. This makes the `requiresReauth` branch a plausible explanation for the historical 400s, but it is not proven without the sanitized invocation response and matching timestamp.
- The function does not explicitly emit HTTP 499. A 499 in platform logs therefore needs gateway/request-cancellation evidence; do not attribute it to eBay without the ingress trace.

No token, credential payload or raw provider body should be logged to diagnose this. A controlled reauthorisation and one finance-summary request, correlated with safe status/error-code telemetry, is still required. The historical 400/499 issue remains OPEN and is not represented as fixed.

## Known limitations / architectural risks

- S2 implementation is ready for automated acceptance; tests have not run in this editor, so S2 stays IMPLEMENTED rather than VERIFIED.
- S3 remains IN PROGRESS. Auth/entitlement/catalog evidence is partial, not a full authenticated role-by-role/end-to-end test.
- The new commands cover the three existing lifecycle helpers; other direct screen/table status writes and large legacy detail screens still need incremental migration and authorization review. S2 gate does not claim to remove every direct-query path.
- Message sync retains the existing provider parser/window; full eBay response shape, pagination, empty-result semantics, body retrieval, reply concurrency/idempotency and remote acknowledgements require live acceptance. Header-only body absence is explicitly shown.
- Existing multiple-message duplicates are preserved. Future ingestion selects the earliest existing scoped row and serializes future repeats; external writers must use the command.
- Sale-time full fee allocation across multiple lines/quantities is not solved here; existing aggregate-to-sales logic remains a release risk. Currency, fee credits and race-safe note merges need separate ledger acceptance.
- eBay finance HTTP 400/499 cannot be declared fixed without a reproduced production request/keyset/signature check.
- Fees remain versioned estimates except when supplied explicitly; the UK fee model is now refreshed to the official September 2026 schedule, but seller-specific terms, actual account fees and multi-line allocation still need validation. No real notification delivery service was added.
- Historical verification on a different Supabase deployment does not certify this connected OnSpace Cloud. Record deployment origins and revision evidence separately.
- Signed release, Google Play API/AAB compliance and installed-device acceptance remain S7 blockers; no APK build was triggered.

## Remaining work / recommended next step

Run the new foundation workflow and resolve actual diagnostics without suppressing gates. Then opt into approved read-only deployed checks, test atomic mutations using designated test inventory, and run controlled OAuth/token refresh/listing lifecycle/messages/finance/media acceptance with recorded backend revision, exact commit and provider IDs. Complete S3-04 only after genuine marketplace/financial results and notification/settings acceptance. Keep failed tests and missing evidence open; do not relabel stages as VERIFIED to satisfy a progress target.
