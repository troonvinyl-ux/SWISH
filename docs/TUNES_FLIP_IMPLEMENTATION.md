# Tunes Flip implementation and verification

## Delivery status
Implemented source integration in the existing SWISH application. NOT VERIFIED end-to-end and NOT production-ready. One existing binary, auth, tenant architecture, canonical items inventory and eBay connector are preserved. Tunes Flip is the twelfth registered module; the original eleven remain unchanged.

GitHub baseline inspected: `218b6db3cef4ee9a1b6ef07d93a6029bb92b7c87` (main). No Git write, pull-request creation/merge, terminal, authenticated POST runner or device runner is available in this editor session. Changes are in the OnSpace working project; main synchronization is not yet certified. The historical register workflow success on that earlier commit does not verify these changes.

## Product and architecture
Canonical niche: `tunes_flip`; existing specialist: `vinyl_records`. Registry aliases: tunes-flip, tunes, music, vinyl_records. No inventory reclassification was executed. Registry package fields retain module compatibility naming; no Tunes APK/build workflow was created or requested.

Entry uses existing ModuleEntry and unified tabs. The shared dashboard gets music copy, identify/barcode/catalogue/collection/listing/value/sales/tasks actions. Existing PremiumScanner is used for front/back sleeves, disc labels, barcode, runout and surface images. AI proposes music identity with the existing OnSpace model; never invents a Discogs match. Catalogue confirmation is integrated before scanner save. Manual pressing review remains possible when the catalogue is unavailable. Separate media/sleeve grades use M, NM, VG+, VG, G+, G, F, P. Playback findings and audio defects must be supplied manually.

Catalogue-only additions create canonical review_required items without claiming images/condition/valuation are complete. Saved IDs are retained for retry and shared inventory is notified. Original photos, valuation, editor, deletion/archive and eBay actions use existing services/pages. Existing item release updates use tenant + specialist filtering, optimistic concurrency and persisted reference readback.

Collection page filters artist, title, genre, format, label, year, country, media/sleeve grade, estimate bounds and status; sorts recent, estimated values, artist, release year and expected profit. Reads are server-paginated 50 at a time. Bulk archive delegates to existing archiveItem; live and sold records are excluded. It is not a second inventory table.

## Discogs integration and security
Client calls only `getSupabaseClient().functions.invoke('swish-discogs', ...)`. All API requests and runtime credential reads are in `supabase/functions/swish-discogs/index.ts`. The values never appear in source code, public env variables, payloads, logs, persisted inventory or returned status.

Required secrets, reported configured by the user:
- DISCOGS_CONSUMER_KEY: registered application Consumer Key.
- DISCOGS_CONSUMER_SECRET: registered application Consumer Secret.
- DISCOGS_USER_AGENT: `TunesFlip/1.0 +https://swishflip.co.uk`.

OnSpace → Cloud → Secrets is the administration location. Setup UI shows names and presence only, after trusted owner verification. The status and read-only connectivity routes independently verify JWT and backend owner permission; subscribers receive 403. Normal catalogue routes use existing strict session, tenant and niche checks. Arbitrary provider URLs are not accepted, redirects are refused, provider errors are sanitized, and request size/time/page limits apply. Credentials are sent in the server-side Authorization header, never query strings.

Database/search/release/master-version data is allowlisted into a shared CC0 metadata contract. Images, community/user data, marketplace inventory, pricing suggestions and sales history are excluded. No Discogs data cache is maintained. Responses are no-store; temporary selected release details expire after six hours and confirmation refuses expired metadata. Persisted inventory contains user-confirmed catalogue identity/reference, not a raw provider response. Display uses attribution `Data provided by Discogs.` linked to the release, plus the non-affiliation statement. Discogs release artwork is not copied into listing photos.

Rate handling: per-worker 1.3 second spacing, bounded queue, upstream remaining budget and 429 cooldown; no alternate key or scraping fallback. The provider's global limit remains authoritative across workers; high-volume deployment may require a shared limiter after load testing.

## Licensing and OAuth boundaries
Official API docs: https://www.discogs.com/developers
Official terms reviewed: https://support.discogs.com/hc/en-us/articles/360009334593-API-Terms-of-Use

The terms restrict paid access to otherwise-free catalogue integration and marketplace/traffic-related use. Credentials are not usage permission. Until written authorization is established, subscribers' catalogue requests are blocked. Owner catalogue lookup is for evaluation. Discogs-derived eBay generation/publish/revise is also blocked by shared server scope validation. Manual, user-origin music records can use existing eBay services. To enable approved usage, the owner must record applicable written permission first, then set server-only `DISCOGS_COMMERCIAL_USE_APPROVED=true` in Cloud Secrets. This flag is not a legal determination and was NOT enabled by this session. Restricted pricing/artwork remain disabled even after catalogue permission.

No private Discogs collection/wantlist access is implemented or implied. My Collection means canonical SWISH inventory. Public catalogue uses server consumer key/secret auth and does not require OAuth. No Discogs OAuth callback exists or is needed for that flow; callback URL is null. Private Discogs-account synchronization remains a separate per-user OAuth 1.0a integration requiring its own permission review and encrypted token custody.

## Backend changes and known billing blocker
Applied migration: `supabase/migrations/20261106_tunes_registration.sql`. Existing specialist function and command snapshot definitions were extended in place; existing mappings, RLS, grants, rows and credentials are preserved. No tables, users, subscriptions or second auth/inventory system created. Command report includes music and readiness denominators use the canonical registry.

Observed database `niche_entitlement_known_product` CHECK still allows only the original ten IDs (not Collectibles or Tunes Flip). New ordinary subscriber entitlement caching is therefore BLOCKED. No security constraint was dropped or bypassed. The existing reviewed billing migration must be extended/reviewed for all current registry IDs through authorized migration tooling; cache RPC snapshot limit must follow that same registry. Trusted owner and previously trusted tenant-wide tier behavior is preserved. No new grants were fabricated.

## Verification results
Executed here:
- Public GitHub main metadata inspected (baseline above).
- Cross-file credential discovery before implementation: no Discogs credential runtime usage was present.
- Read-only SQL checked authenticated niche access privilege: true.
- Read-only SQL inspected entitlement CHECK: original ten-niche restriction confirmed.
- Applied additive music mapping/report definition extension successfully.
- Read-only mapping/report/privilege postconditions returned: `vinyl_records → tunes_flip`, `tunes_flip → tunes_flip`, `coins_uk → coins`, unclassified catch-all `null`, command includes music `true`, anon command EXECUTE `false`, authenticated command EXECUTE `true`, existing music inventory count `0`. No music item was created by verification.

Prepared but NOT EXECUTED here:
- `services/__tests__/tunesFlip.test.ts`: registry/navigation/isolation, CC0 allowlist, pressing confirmation, freshness, all grades, listing specifics/safety and client/server credential boundaries.
- `scripts/check-discogs-secret-boundary.mjs`: fail CI on client credential env reads, direct provider endpoint or server import.
- `.github/workflows/tunes-flip-verification.yml`: TypeScript, lint, full existing regression suite, registry/mirror checks, Deno check and source-bound evidence artifacts. It does not build another APK or touch seller data.

Blocked/unverified:
- Actual secrets presence/validity and authenticated Discogs connectivity: owner must enter Tunes Flip → Search Discogs → Owner-only setup → Check configuration → Test connection. Only a real PASS with checkedAt is proof; user key submission is not a connectivity test.
- Search/barcode/catalogue/alternative-pressing runtime and camera device acceptance.
- Inventory create/edit/delete/persisted reference and native/web synchronization acceptance using safe fixtures (no production test writes executed).
- Ordinary subscriber JWT 403s and tenant/niche isolation: approved fixtures remain unconfigured per prior session.
- eBay draft generation/category/aspect persistence, sandbox publish, orders/sales/profit acceptance.
- TypeScript/lint/unit/integration/static gates and original-niche regression reruns.
- Unified Android signing/build/device startup/navigation acceptance (no build requested).
- Current main/OnSpace synchronization and PR link: unavailable, not fabricated.
- Generated music hero service failed; music-specific remote photographic fallback is used. Original eleven local headers remain unchanged.

## Files changed
Registry/config: niche-modules.json; backend registry mirror; constants/niches.ts; specialists.ts; nicheHeaderArtwork.ts; brandArtwork.ts; new niches/tunes_flip/module.json.
Shared domains: shared/musicRelease.ts and backend mirror; shared/specialistIntelligence.ts and backend mirror; shared/ebayImportScope.ts and backend mirror.
Backend: swish-discogs/index.ts; shared/moduleScope.ts commercial gate; swish-identify/index.ts music rules; swish-market-value/index.ts music search/relevance; new registration migration.
Client services/hooks: discogsService.ts; tunesService.ts; new TunesContext/useTunesCatalogue/useMusicBarcode/useMusicCollection; GenericCapture and aiIdentificationService extension; nicheDashboardService/specialistWorkspaceService/nicheCategoryService/readinessAssessmentService.
UI/routes: MusicCataloguePanel; PremiumScanner extension; app/music-search.tsx; music-collection.tsx; entry/tunes-flip.tsx; root TunesProvider/routes.
Tests/CI: tunesFlip.test.ts; existing registeredNicheAudit/completionProgramme/nicheIsolation expectations updated for original eleven + music; canonical validator count and deployment mirror tooling updated; credential-boundary script and dedicated workflow.

Release verdict: BLOCKED. Implementation is not the same as verified external permission, live execution, persisted fixture acceptance or native binary acceptance.
