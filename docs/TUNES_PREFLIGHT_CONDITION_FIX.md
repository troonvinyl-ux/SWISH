# Tunes Flip preflight condition persistence

## Confirmed cause
Read-only inspection of the deployed `swish_save_listing_editor` function showed that its shared premium-editor niche list excluded `tunes_flip`. The music editor sent `ebay_condition_id`, condition notes, listing options and photo selections, but the function skipped the persistence branch. Consequently, preflight could show a supported CD category and still block publication because no eBay condition ID had been retained.

## Changes
- Applied a guarded function-definition migration adding `tunes_flip` to that existing branch. No existing inventory or listing rows were changed. Existing grants, invoker security, photo guards and atomic editor logic were preserved.
- Added a shared eBay condition picker used by the editor and inline preflight card. Missing category-required conditions are exposed in the editor rather than hidden in a collapsed group.
- Preflight exposes actual category-returned condition choices. The seller explicitly chooses a condition and taps **Save condition & recheck**. No grades are mapped automatically and no condition is guessed from Discogs or photographs.
- The inline save loads the scoped draft, fetches current category conditions, checks the chosen ID, saves only its attribute using the item's version and existing RLS, reads it back, then reruns preflight. Grades, defect notes, titles, prices and photo selections are preserved. Live listings cannot be modified by this action.
- Condition failures now appear as failures with an actionable condition picker; unrelated specialist failures no longer masquerade as condition failures. Blocked specialist checks are not presented in green as ready.
- Submission still requires all shared specialist checks and explicit seller approval. Nothing was published during this fix.

## Verification
- Backend read-only assertion passed: `tunes_flip` is in the deployed persistence branch, condition persistence and `swish_listing_photo_allowed` remain present, and the editor still uses invoker security.
- Added `services/__tests__/preflightCondition.test.ts` with mocked regression cases for supported/missing/unsupported conditions, changed categories, stale item versions, readback failure, live listing protection, shared-niche UI wiring, and mirrored policy parity.
- Tests were written, not executed in this session; no command runner was available. Installed-device UI and real eBay acceptance remain unverified.

## Seller retest
1. Reopen the existing March Of The Mods draft. Do not create a second listing.
2. Select the actual eBay CD condition, then save the draft; alternatively select and save it directly in preflight.
3. Confirm preflight reports the saved condition and passes the remaining requirements.
4. Only then approve **Submit to eBay**. Inspect the outcome before any retry.

Migration: `supabase/migrations/20261108_tunes_editor_condition_persistence.sql`.
