# SWISH text-first Minority Report

## Delivered

The existing `CommandPortfolio` now renders one compact terminal-style report, used by SWISH master home and Master Admin. Dark flat surfaces, thin dividers, aligned tabular figures and restrained yellow/green accents replace niche tiles, decorative icon panels and large metric cards. All registered niches retain one tappable row; workspace entry still uses the existing `app.openModule()` path. Administrative inspection remains separate under Evidence & scope.

Top summary: unique canonical items, stock, drafts, live eBay listings, sold, realised ledger sales, recorded readiness and detected issues. The niche table exposes Unique / Stock / Draft / Live / Sold / Ready / Issues. On narrow screens one shared horizontal table rail keeps all columns aligned; on desktop the ledger sits beside performance and action priorities. Interactive rows remain 48 points high. Details and historical evidence are collapsed initially.

Commercial rows separately show realised sales today/week/month, current recorded asking value, outstanding orders, ready unpublished items, publication success and average capture-to-live duration. Asking values are never used as revenue.

## Data and access

The existing `swish_command_snapshot(uuid,boolean,text,text)` is extended in place. Its owner, authentication, tenant, paid-niche and inspection guards remain intact. No replacement dashboard, inventory table, client, auth system or backend was created. Initial reporting still uses one consolidated snapshot RPC. The report no longer starts release/GitHub audits; Master Admin verification reads are now lazy when viewing the report.

Temporary refresh failures retain only the current hook's same-user/tenant/mode snapshot and display CACHED plus its original timestamp. Authorization/session/invalid-contract failures clear it. Cached reports do not grant workspace entry or bypass server permissions. In-progress refresh is explicitly labelled CACHED / refreshing, not refresh failed.

## Honest readiness and issue coverage

Old SWISH AI verification is not proof that category-specific specifics, condition or photo checks passed. Those historical `overall_passed` records are therefore NOT converted into ready counts.

The existing shared `checkAntiqueListing()` (used across registered specialists) now sends a best-effort, nonblocking preflight observation to existing `commercial_events`. It records the actual result and exact item/draft versions without adding provider/read requests. Failure to log does not fail a preflight or publication. A reporting observation is not an authorization decision.

Readiness is counted only for unchanged unpublished canonical items with a current shared preflight checkpoint (15-minute validity), successful specialist safety checks and a connected publication-capable seller with saved policies. Missing/expired evidence shows —, not a fabricated zero. Counts are recorded checked items, not assertions that every unchecked item is unready. The report shows checked/unpublished coverage beside them. All existing live publication checks and explicit seller approval remain required.

Priorities, in order:
1. Recorded ready items awaiting publication.
2. Canonical photo pipeline marked `retry_required`.
3. Existing eBay drafts marked failed without an external ID.
4. Current recorded item-specific validation failures (missing, unsupported or inconsistent specifics).
5. Recorded identification confidence below 50%, excluding unknown-source stock.
6. Persisted inventory/listing status discrepancies.
7. Tenant-scoped repeated inventory/capture/eBay identities or duplicate eBay listing rows.

Issues count distinct affected canonical items within each niche, not a sum of overlapping issue categories. Zero recorded photo retry checkpoints does not prove every historical image was uploaded successfully. Unclassified historical inventory remains included in the canonical top total and is disclosed outside the registered-niche table; it is not silently assigned to a niche. Unknown/expired preflight coverage is not classified as a successful check.

## Measurements

Publication rate uses latest finalized Quick List session observations in the past 30 days. A successful session must also match a server-side `quick_list_live_confirmation`, tenant, niche, external ID and Active status. Failed/unconfirmed/abandoned post-attempt sessions remain in the denominator; running sessions are not finalized attempts. No draft or acknowledgement-only event is a live success.

Average capture-to-live uses recorded T2 → T7 for confirmed successful sessions only. The report displays both attempt and duration sample sizes. Other publication workflows and native application startup are not measured by this statistic. Missing samples produce —. The 60-second target is not newly certified.

## Executed verification

- Compiled and ran the exact installed consolidated SELECT as a read-only administrative SQL audit; validated the 12-niche operational payload and null rates for an empty measurement sample. No JWT impersonation or protected-RPC invocation was used for this read.
- Unauthenticated platform snapshot call rejected.
- Anonymous execute remains false; authenticated execute remains true.
- Canonical item count remains **763**; no user inventory records were changed.
- Registered inventory: **751**; unpublished stock/draft records: **322**. These 322 are NOT assumed listing-ready.
- Recorded photo retry checkpoints: **0**; recorded sync discrepancies: **3**; recorded low-confidence identifications under the reporting threshold: **242**.
- Preflight observations: **0**; Quick List timing observations: **0** at this session's baseline. Readiness/required-specifics coverage and publication rate/duration therefore remain unassessed, not fabricated.

## Authored, not executed in this session

`commandMinorityReport.test.ts` adds phone/tablet/desktop dimension contracts, SSR fallbacks, all registered rows, priority ordering, null measurements, scope validation and no-decorative/eager-audit regressions. Existing canonical-count and optimisation source contracts were updated for the compact labels. The existing command-centre CI workflow now includes focused report tests and Expo web bundling.

No shell, test runner, browser automation or installed-device facility was available here. TypeScript, Jest, Expo export, visual browser layouts and installed iOS/Android interaction tests remain pending. Geometry/source contracts are not visual acceptance. Run the existing workflow, then test widths 320/375/414/768/1024, landscape, row navigation, horizontal table scrolling, disclosure expansion, a failed refresh and permission revocation on mobile and Expo web.

## Main files

- `components/feature/CommandPortfolio.tsx`
- `components/feature/SwishMasterHome.tsx`, `app/master-admin.tsx`
- `hooks/useCommandCentre.ts`, `hooks/useCommandReportLayout.ts`, `hooks/useVerificationCentre.ts`
- `services/commandCentreService.ts`, `services/commandReportService.ts`, `services/commandPreflightEvidenceService.ts`, `services/listingEditorService.ts`
- `constants/theme.ts`
- `supabase/migrations/20261114_text_first_command_report.sql`
- `services/__tests__/commandMinorityReport.test.ts`
- `.github/workflows/command-centre-verification.yml`
