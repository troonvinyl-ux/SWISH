# Tunes Flip — confirmed catalogue population and CD capture

## Changes

- Confirmed individual Discogs release details now reach the scanner's **displayed** review immediately, instead of being merged only when saving. Artist, release title, format, compilation designation, label, catalogue number, year, country, genre, style, barcode (when unambiguous) and catalogue disc count come from the actual selected release. No title/year/country has been hardcoded from the user's screenshot.
- Catalogue confirmation alone can populate the review if photo AI failed or has not run. This is explicitly **user-confirmed catalogue identity**, not fabricated AI success, physical authentication or a confidence boost.
- The displayed review, valuation input and existing canonical inventory save use the same enriched result. Explicit manual corrections, media/sleeve grades, playback notes, physical counts and title overrides survive further photo checks.
- A timestamped CC0 release snapshot is retained in the existing local capture draft scoped to user, tenant and niche. Freshness is limited to six hours; expired snapshots cannot re-establish confirmation. A new unconfirmed release selection cannot inherit the previous confirmation.
- The shared scanner now offers **Vinyl / cassette** and **CD / box set** modes. CD mode uses front cover, rear cover, all-disc contents view and numbered disc labels. Vinyl's existing sleeve/label/runout/surface workflow remains available.
- Switching modes retains originals, catalogue selection and manual notes. Old extra angles remain visible and individually removable. A matrix photo is not silently declared Disc 3.
- CD capture supports up to five individual label close-ups plus the three packaging/contents views, respecting the existing eight-photo request limit. Larger sets require an all-disc overview. Catalogue quantities and **discs physically present** remain separate; discrepancies are flagged. No catalogue count certifies completeness.
- Both client and deployable server specialist profiles accept `cd_box_set`. The existing identify function receives CD-specific instructions. No AI model, authentication, niche registry, inventory schema, seller connection or credential handling has changed.

## Files

`shared/musicRelease.ts` and its server mirror; `shared/specialistIntelligence.ts` and its server mirror; `services/musicCaptureService.ts`; `services/captureDraftService.ts`; `hooks/useGenericCapture.ts`; `components/feature/MusicCaptureControls.tsx`; `PremiumScanner.tsx`; `SpecialistReview.tsx`; `MusicCataloguePanel.tsx`; `supabase/functions/swish-identify/index.ts`; music fixture/retention tests and the existing Tunes Flip contract test.

## Verification status

- Backend inspection confirmed existing `items.attributes` JSONB, `items.media` array and canonical specialist field. Read-only query; no inventory records changed.
- Added pure fixtures for CD compilations, metadata population without AI, manual overrides, expired/unconfirmed snapshots, inference removal, catalogue-vs-physical disc counts, mode switching, eight-photo bounds and client/server mirror parity.
- Added mocked local-storage tests for retained metadata, per-user/tenant/niche isolation, ordered autosaves and existing item-ID preservation.
- **Tests have not been executed in this editor session:** no shell/test runner is available. These suites are included automatically by the existing Tunes Flip verification workflow. TypeScript, lint, Jest, native build and live device behaviour remain unverified; no pass or build certification is claimed.
- No paid AI calls, Discogs searches, inventory writes or eBay publication were performed for verification. Discogs secrets remain server-side; restricted pricing/artwork handling is unchanged.

## Device retest

1. Open Tunes Flip's shared scanner and choose **CD / box set**.
2. Retrieve and explicitly confirm the exact individual release using the existing barcode/catalogue search. Previously confirmed in-session results should populate immediately; retained draft results should populate while fresh.
3. Check artist/title, CD/Compilation, UK/year and catalogue fields against the returned release. The review labels should say **Discogs · confirmed by you**, not “not established” for populated catalogue values.
4. Enter the discs physically present. Capture front, rear, all-disc overview and numbered labels. For an existing vinyl-mode scan, switch modes and confirm the original photos remain retained.
5. Review separate media/packaging grades and playback. Optional photo cross-checking must not blank confirmed catalogue metadata.
6. Save through the canonical inventory workflow; reopen the item and check metadata, manual notes and original photographs. Do not create another record for an already saved item.
