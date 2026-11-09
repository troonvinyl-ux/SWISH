# SWISH: eBay sync, shared camera and S1–S7 verification

## Scope and status
One existing SWISH application, auth client, canonical inventory, backend and twelve niche modules. No automatic publishing, release approval, entitlement grant, data cleanup or historical task promotion was performed. Current-source CI and installed-device execution remain outstanding.

## Confirmed evidence from this session
- Actual `swish-ebay-sync` logs returned HTTP 503 after 44,794 ms, with eBay Trading HTTP 200 / error 21920397.
- eBay's official Trading documentation identifies 21920397 as “This listing has been removed for a policy violation”: https://developer.ebay.com/devzone/xml/docs/ReleaseNotesArchive.html#1331 . This cannot be bypassed in SWISH or treated as a revoked OAuth token.
- Read-only live SQL confirmed inventory/listings/orders/sales RLS enabled, `item-images` limit 5,242,880 bytes, 140 retained verification results, and a legacy niche CHECK excluding Collectibles and Tunes Flip.
- Read-only live function inspection found `swish_cache_verified_niches(uuid,timestamptz,jsonb)` still limited to **10** grants. The previously authored migration expected 11; its reviewed source now supports the original 10 and intermediate 11 bounds, preserving other function safeguards.
- The new owner-only `swish_readiness_schema_probe()` was installed. Anonymous execute is denied; authenticated execute exists but a missing-JWT call was rejected. These are schema/role checks, not a real owner/subscriber JWT end-to-end pass.
- Public GitHub query returned zero main-branch runs for `production-acceptance-gate.yml`. No Actions workflow was dispatched by the editor.

## Implemented repairs
### Sync
The Hub continues disjoint six-link batches, with at most three independent provider reads per batch, visible checked/reconciled counts and one pending shared flight. Existing per-request server sync leases remain. Whole-account Active/Sold/Unsold discovery downloads are removed from existing-link sync; import remains separate.

Only the exact item-specific 21920397 response is isolated. Restricted rows receive no metadata/status/photo writes and are reported by listing ID. Other authentication, HTTP, malformed observation and persistence errors still stop that batch. Confirmed unaffected batches update the displayed inventory even when the overall outcome is partial. A partial result never becomes an all-clear/full-success result. Unknown failures are not automatically replayed.

### Shared camera
Quick List and specialist capture use the same single-stream full-screen camera. Both offer pinch zoom, +/−, normalized zoom reset, full-screen exit, shutter, library and Review. The modal respects top/bottom safe areas and tab focus. A barcode result closes the modal so sourced suggestions/manual fallback remain accessible. Original/photo processing contracts are unchanged.

Expo zoom is normalized 0–1, not a guaranteed optical 2×/5×. Browser zoom is explicitly unavailable rather than faking a preview-only zoom; browser capture/library fallback remains. Test native lens behavior on actual iOS/Android hardware.

### Production Control
Open More → owner Master Admin → Production Control → S1–S7 acceptance & repair. Each original stage now has an actionable next-step guide, evidence requirements and its execution workflow. The panel separately displays actually executed source-bound safe probes, and can explicitly run the existing read-only seller-policy verification. The production acceptance workflow is included in discovered live workflow evidence.

The safe programme runner now probes schema/RLS/upload boundary and legacy entitlement constraints, and retains specific results in the existing evidence table. Whole-stage tasks remain blocked until all criteria are exercised; no checkbox or safe SQL query grants full acceptance.

## Ordered verification plan
| Stage | Run and observe | Evidence to retain |
|---|---|---|
| S1 | Save/review canonical source; run source/route/Edge dependency checks; compare deployed revision | Full commit SHA, source review and real logs |
| S2 | Registry/module/secret-boundary/type/lint/unit checks | Nonempty executed test reports for twelve niches |
| S3 | Safe owner probes, then separate ordinary subscriber JWTs; upload/reopen; eBay sync | Caller denials, photo readback, provider and canonical sync outcomes |
| S4 | Explicit test item capture → identification → value → inventory → draft → approved marketplace readback | Each transition and item/listing reference; no automatic seller actions |
| S5 | Repeat appropriate photos/condition/fields/categories for twelve niches | Per-niche representative journeys and cross-tenant/module denials |
| S6 | Exercise only enabled optional tools, keep licensing/unsupported scope explicit | Optional-engine and contamination tests |
| S7 | After automated gates, signed existing-identity candidate; installed Android/iOS and hosted parity; protected review | Artifact/certificate/runtime hashes, device results, hosted revision and owner verdict |

## How genuine blockers close
1. Repair the owning defect, not the status label. Retain historical audit evidence.
2. Commit/synchronize this edited source into the canonical repository. The editor has no Git or terminal executor.
3. In GitHub Actions → **SWISH production acceptance (no release)** → Run workflow, select the reviewed branch and enter its full reviewed `base_sha`. Initially leave `build_android` and `approved_review` false. Download actual command artifacts; skipped/failed/install-error checks do not count.
4. Review any intentionally modified existing tests: the existing test-integrity gate deliberately stops altered assertions until reviewed. Do not choose a false base SHA just to hide changes.
5. Use actual designated test records/accounts and installed devices for integration. Approve paid AI/seller actions separately. Do not put JWTs or secrets in repository evidence.
6. Supply the current-source operational evidence manifest and protected owner review only after required evidence has been resolved and hashed. Nothing here uploads/releases automatically.

## Entitlement schema action still required
The existing migration `supabase/migrations/20261106_120000_unify_twelve_niche_entitlements.sql` needs review/application by an authorized schema deployment operator. It installs/validates a twelve-niche CHECK before replacing the old constraint and preserves cache logic; its source now handles the observed ten-grant bound. **It was not executed in this session**: the SQL editing tool does not permit `alter table … drop`, even for constraint replacement. No entitlements or user data were modified. Recheck the deployed constraint, cache limit, owner/subscriber isolation and Stripe-derived grants afterward; until then this remains a real S3/S7 blocker.

## Tests authored, not run here
- `sharedFullscreenCamera.test.ts`: normalized/pinch bounds, safe areas, single shared camera, focus and session reset contracts.
- `ebayHubBatchSync.test.ts`: disjoint batch totals, restricted item continuation, no unconfirmed retry, workspace stop and repeated cursor protection.
- `programmeVerificationGuide.test.ts`: all seven actionable stages and unchanged current-source acceptance gates.
- Existing CI workflows include these tests. Current-source TypeScript/Jest/Deno/lint/build runs and physical camera/provider testing are still pending.

## Device retest first
1. Open Quick List in Coins and Collectibles. Confirm full-screen camera, pinch/+/-/reset, Review, barcode result/manual fallback and required view order.
2. Capture a large original; confirm the existing bounded upload/background removal carries forward on save/reopen.
3. Run Hub sync with the connected account. Verify unaffected listings continue, 21920397 IDs remain unchanged with explicit warnings, and partial outcomes do not claim full success.
4. In Production Control, load the actual current-main register and run S1 safe audit. Confirm schema results are retained; then dispatch the real source checks. No go-live verdict until remaining mandatory acceptance completes.
