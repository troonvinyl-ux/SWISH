# Shared photo pipeline and image persistence — Prompt 3

## Status

Implementation delivered; **end-to-end acceptance remains OPEN**. This editor has file and read-only database/schema tools, but no terminal, installed-device camera or live seller test runner. No Jest, TypeScript, native build, restart test, paid provider test or live eBay publication was executed here. Do not interpret this report or the mocked suites as production acceptance.

## Audit findings: where references were lost

1. Quick List used its own `Promise.all` original-upload path. If one upload rejected, successful uploads never reached the media-link write. Canonical inventory could exist without its photos even though the scanner displayed local previews.
2. Generic uploads returned a compact list of successful URLs. Quick List associated cutouts with `urls[index]`, allowing missing uploads to shift original/processed roles.
3. `updateItemMedia` replaced the media array; subsequent subset saves could remove previously linked originals.
4. Studio links were also held in `pendingStudioLinks`, an in-memory map that did not survive restart.
5. Quick recovery stored images and IDs but not identification/review state. Fresh scan persistence could overwrite the previous recoverable state.
6. Generic scanner entry deliberately reset local state, but offered no explicit resume path. This was correct for fresh-item identity but insufficient for recovery.
7. Browser `blob:` capture URLs did not survive reload. Native captures already had an existing document-directory retention path.
8. Recovery only ran for completely empty media, missing partially linked front/back pairs.
9. Historical data includes two items with temporary media references. Those cannot be declared persistent merely because their `media` arrays are populated.

## Lifecycle after the change

Camera/library/barcode-led capture → untouched local copy (`retainCaptureImage`) → identification using originals → canonical item ID → `persistCapturedItemPhotos` → existing `item-images/{itemId}/originals/{role}_{hash}.{format}` upload → byte readback → merged canonical `items.media` plus `_photo_assets` and `_photo_pipeline` → optional existing BackgroundErase cutout linkage in `_smart_studio_images` → inventory reads persisted media → listing editor reads that same item → explicit seller selection or existing preferred-photo policy → server photo/entitlement/presentation checks → existing eBay PictureURL payload.

Identification does not own the canonical photo list. Its result is retained separately while the capture pipeline attaches original assets to the existing item ID. No second inventory table, storage bucket, image provider, listing engine or client credential was introduced.

## Changes

- `services/photoPersistenceService.ts`: sole role-aware capture persistence writer; original uploads first, partial successes linked, CAS metadata merge with bounded metadata-only retries, independent canonical readback, stable JSONB semantic comparison, concurrent-call sharing, cached originals verified without reupload, optional processed metadata linked to original URLs.
- `shared/photoPersistence.ts` and deployable `_shared` mirror: separate original roles and publication completeness contract.
- `services/aiIdentificationService.ts`: legacy scanner upload/link APIs delegate to the shared writer; transient studio association map removed.
- `services/quickListService.ts` / `hooks/useQuickList.ts`: same writer; no compacted URL-index associations; identification/item/draft recovery retained; explicit resume; no automatic reuse of an old physical item; photo retry on the saved record.
- `services/captureDraftService.ts`: existing native copy path handles content/file URIs; web Blob bytes become an unchanged data URI in the existing local draft; local-storage failures are surfaced, not called durable success.
- `hooks/useGenericCapture.ts` / `PremiumScanner.tsx`: explicit retained-scan resume with ownership checks; fresh scans remain clean; successful partial upload metadata is retained in recovery state.
- `services/capturedPhotoRecoveryService.ts`: existing uploaded originals recovered through the same writer, including partial media; ambiguous same-role versions are not guessed; no paid processing during recovery.
- `hooks/useInventoryPhotoRecovery.ts`, `hooks/useListingEditor.ts`, shared inventory screen: partial persistence is visible/actionable, not treated as a complete item.
- `services/listingEditorService.ts`, `swish-ebay-list`, SQL publish claim: incomplete captured originals block preflight/publish/revise; canonical item locking protects claim-time checks.
- SQL future-write preservation trigger: protects documented originals, role metadata and processed associations against later stale editor/sync writes. Existing seller listing-photo selection remains separate.
- Edge mirror validator and dedicated CI workflow added.

Existing `uploadItemImages` callers in Coins, Islamic capture, MX, Bikes, Threads, batch capture and the stock overview all converge on the same writer without changing their niche screens.

## Verified live database evidence (read-only)

| Metric | Before | After schema/code edits |
|---|---:|---:|
| Canonical item records | 763 | 763 |
| Records with at least one media reference | 758 | 758 |
| Records without media | 5 | 5 |
| Stored content-addressed original objects | 15 | 15 |
| Original objects referenced by their same canonical item | 13 | 13 |
| Unlinked original objects | 2 | 2 |
| Items containing historical temporary media references | 2 | 2 |
| Items exercised through the new `_photo_pipeline` | — | 0 |

The 13 existing original associations were checked against `storage.objects` and the same canonical item's `media`. This verifies **reference linkage**, not a new camera run, downloaded pixel fidelity, front/back coverage or eBay publication. No historical record was changed, attached automatically, merged or deleted.

Installed schema checks: preservation trigger present; publish claim includes `_photo_pipeline` guard; only service_role can execute the publish claim (anon/authenticated execute remain false). A pure read-only SQL front-only/back-missing fixture returned `partial_capture_is_blocked = true`.

### Existing niche baseline

| Niche | Canonical records | With any media | Temporary-reference items |
|---|---:|---:|---:|
| Coins | 460 | 459 | 0 |
| Collectibles | 8 | 5 | 0 |
| MX | 2 | 2 | 0 |
| Bikes | 2 | 2 | 0 |
| Threads / clothing | 3 | 3 | 1 |
| Antiques | 2 | 1 | 0 |
| Tech | 3 | 3 | 0 |
| Tunes Flip | 1 | 1 | 0 |
| Surplus Flip | 270 | 270 | 0 |
| Unclassified history | 12 | 12 | 1 |

Beauty, Fossils and Trading Cards have no records in this baseline; no live acceptance can be inferred for them.

## Tests supplied, not executed

- `photoCarryForwardIntegration.test.ts`: all registered niches; role-preserving original upload/readback, partial back failure and same-ID retry, restart-style reconstruction, concurrent deduplication, old-media merge, optional processed-image association, tenant denial. Native/storage I/O is mocked.
- Updated wrapper and recovery regressions.
- `photoPipelineBoundary.test.ts`: client/Edge parity, incomplete-media gating, no transient studio-map dependency.
- `supabase/tests/photo_persistence_readonly.sql`: non-mutating production evidence/fixture checks.
- `.github/workflows/photo-persistence-verification.yml`: TypeScript, targeted Jest, Edge dependency checks, saved artifacts. CI execution is pending.

## Required actual acceptance — every niche remains NOT RUN

For Coins, Collectibles, MX, Bikes, Threads, Antiques, Beauty, Fossils, Trading Cards, Tech, Surplus Flip and Tunes Flip:

1. Sign in to the correct tenant/niche on an installed Android and iOS app; repeat web capture/reload where supported.
2. Capture front/back (or specialist-equivalent faces/profiles), all required specialist views, plus detail/label/barcode where applicable. Record the roles.
3. Identify and save. Record the canonical item ID, the persisted `media`, `_photo_assets`, completeness marker and any processed associations from the database. Do not rely on scanner previews.
4. Navigate away, reopen inventory, force-stop/relaunch, and reopen the same item. Verify every required original/role still exists and can be fetched.
5. Open its listing draft/editor. Verify original and permitted processed assets are available from that same item; seller selections remain explicit.
6. Simulate a failed back upload. Confirm front remains linked, identification/item ID retained, publication blocked, and retry reuses the existing front object.
7. With explicit seller approval only, publish through the existing eBay flow and inspect the resulting live pictures; capture evidence. No automatic live testing was performed in this session.
8. Run sync, then recheck original roles and selected listing photos. Repeat across a second tenant and confirm no leakage.

Record device/platform/build SHA, tenant/niche, item ID, before/after URLs, roles, restart outcome, listing ID, live photo evidence and failures. No acceptance check may be marked passed without that evidence.

## Remaining blockers / limitations

- Actual installed-device and authenticated web/restart tests have not run; zero production items have exercised the new pipeline during this session.
- Two stored originals remain unlinked and two historical items contain temporary media. Recovery must be reviewed on their existing items; no ambiguous data is auto-edited.
- Five canonical items have no media. A stored item count is not proof of photo completeness.
- Existing bucket maximum is 5 MB per original and accepts JPEG/PNG/WebP/GIF. Oversized/HEIC evidence is retained and rejected with feedback; it is not silently re-encoded. Explicit exported copies require user action.
- Web local-draft persistence is subject to browser storage quotas. If exact-byte retention fails, keep the screen open and save/retry before leaving; cross-device access starts only after canonical upload.
- CI/build results, Edge deployment revision and live eBay/BackgroundErase behavior require verification.

**Prompt 3 is not marked end-to-end complete.**
