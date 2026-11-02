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

Existing client lifecycle helpers now call the atomic transition command. The new message service/hook call the existing Edge Function plus existing message table. The eBay message server uses the service-only ingestion RPC and persisted tenant-owned recipient/item metadata. CORS in the two edited functions reuses `_shared/cors.ts`.

No new model/provider/AI request. Unknown AI source metadata now stays `unknown`, not automatically `researched`. Capture/evidence/valuation engines remain the existing ones.

Marketplace send/publish success is not fabricated. Message send timeouts require checking eBay before retry. Full provider message parsing/pagination/body retrieval and production 400/499 diagnosis still require provider acceptance. A source repair is not proof that eBay permissions/keyset/remote service are working.

## Security changes

All item mutations through updateItem now reject missing tenant scope. Atomic transitions are invoker/RLS scoped, and actor metadata is determined from the session, not a client supplied automation label. Marketplace-only status requires retained external-ID evidence. Message flags are tenant scoped and update only on confirmed persistence. Provider message ingestion cannot be invoked by client roles. Credentials remain server-only; no keys were requested or exposed.

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

## Tests authored, NOT executed here

`foundationContracts.test.ts`, `coreAtomicCommands.test.ts`, `ebayMessageService.test.ts`, updated isolation/readiness tests, foundation validator, full regression/type/lint/server CI and `verify-s3-live.mjs`.

This editor has no shell/test runner. No new Jest/type/lint pass, real login/media upload, authenticated row mutation, eBay transaction or installed device result is claimed.

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

## Known limitations / architectural risks

- S2 implementation is ready for automated acceptance; tests have not run in this editor, so S2 stays IMPLEMENTED rather than VERIFIED.
- S3 remains IN PROGRESS. Auth/entitlement/catalog evidence is partial, not a full authenticated role-by-role/end-to-end test.
- The new commands cover the three existing lifecycle helpers; other direct screen/table status writes and large legacy detail screens still need incremental migration and authorization review. S2 gate does not claim to remove every direct-query path.
- Message sync retains the existing provider parser/window; full eBay response shape, pagination, empty-result semantics, body retrieval, reply concurrency/idempotency and remote acknowledgements require live acceptance. Header-only body absence is explicitly shown.
- Existing multiple-message duplicates are preserved. Future ingestion selects the earliest existing scoped row and serializes future repeats; external writers must use the command.
- Sale-time full fee allocation across multiple lines/quantities is not solved here; existing aggregate-to-sales logic remains a release risk. Currency, fee credits and race-safe note merges need separate ledger acceptance.
- eBay finance HTTP 400/499 cannot be declared fixed without a reproduced production request/keyset/signature check.
- Fees remain versioned estimates except when supplied explicitly; current rate schedules/seller-specific rates still need validation. No real notification delivery service was added.
- Historical verification on a different Supabase deployment does not certify this connected OnSpace Cloud. Record deployment origins and revision evidence separately.
- Signed release, Google Play API/AAB compliance and installed-device acceptance remain S7 blockers; no APK build was triggered.

## Remaining work / recommended next step

Run the new foundation workflow and resolve actual diagnostics without suppressing gates. Then opt into approved read-only deployed checks, test atomic mutations using designated test inventory, and run controlled OAuth/token refresh/listing lifecycle/messages/finance/media acceptance with recorded backend revision, exact commit and provider IDs. Complete S3-04 only after genuine marketplace/financial results and notification/settings acceptance. Keep failed tests and missing evidence open; do not relabel stages as VERIFIED to satisfy a progress target.
