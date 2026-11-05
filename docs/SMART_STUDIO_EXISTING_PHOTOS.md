# Smart Studio for existing inventory photos

## Implemented in source

Open Inventory → an existing item → Item photos → Smart Studio.

- Select a gallery thumbnail and choose **Process selected photo**, or choose **Process all photos** for this item.
- Processing uses the existing shared Smart Studio engine and `swish-coin-image-enhance` endpoint for every registered niche. There is no new image-processing engine, database, auth system or route.
- Saved ready/review results for the same original and engine version are reused without another AI call. Failed/fallback photos can be retried.
- Processing is serial, cancellable, and bounded to 55 seconds per complete photo operation. The existing engine separately bounds preparation/model calls; metadata persistence is bounded to 15 seconds.
- Completed results are saved after each photo. Cancellation stops subsequent work; saved results remain available. An in-flight database write can complete before cancellation reaches it, so reload to confirm an uncertain save.
- The existing gallery still shows original evidence. A separate labelled comparison switches between the selected original and its Studio presentation, with confidence and warnings.
- Only ready, source-protected presentations are eligible for the existing preferred inventory thumbnail helper. Review results remain labelled and are not promoted automatically.

## Original protection and isolation

The original URL must already belong to the item's saved `media` array. Studio/mask and legacy reference images are excluded as inputs. Each photo is processed separately; the side is not inferred from media order, which sellers can change.

Only `items.attributes._smart_studio_images` is updated. Original files, `media`, original ordering, `ebay_listing_media`, identification, item IDs, statuses, and marketplace listings are not changed. Original uploads, new inventory records, identification requests, and eBay publication/revision are not invoked by this workflow.

Associations use a stable source-URL hash, or reuse an existing capture slot associated with that original. Writes merge fresh attributes, constrain item/tenant/registered specialist/version, and verify readback. JSON comparison ignores object key ordering, as PostgreSQL jsonb can reorder keys.

The hook uses the existing AppProvider inventory-reload mechanism. It rejects late UI updates, aborts processing when account/item/module/access scope changes or the component unmounts, and checks the signed-in account before processing and saving. Existing backend authorization and RLS are unchanged.

## Files

- `services/existingImageStudioService.ts`: existing-original eligibility, valid result lookup, shared engine orchestration, reuse, bounded cancellation.
- `services/smartStudioStorageService.ts`: scoped existing-photo association persistence and order-independent JSON readback; existing capture-link API retained.
- `hooks/useItemSmartStudio.ts`: serial selected/all operations, progress, partial failure handling, cancellation and inventory refresh.
- `components/feature/ExistingPhotoStudioControls.tsx`: actions, comparison, confidence, warnings and progress.
- `components/feature/ItemPhotoGallery.tsx`: controls tied to the selected original.
- `app/stock-listing/[id].tsx`: shared overview integration.
- `services/__tests__/existingImageStudio.test.ts`: mocked orchestration and source contracts, including all 12 registered niches.
- `services/__tests__/existingStudioStorage.test.ts`: mocked CAS persistence and preservation cases.
- `.github/workflows/smart-studio-verification.yml`: focused regression step alongside existing full-suite, TypeScript, lint and raster checks.

## Verification status

- Read-only database check succeeded: the existing `items` fields `id`, `tenant_id`, `specialist_id`, `media`, `attributes`, `updated_at` are available. No schema, policy or bucket changes were made.
- Added 31 test cases: 23 existing-photo workflow/source cases (including 12 niche cases), plus 8 persistence cases. They use mocks; they are not live AI or RLS acceptance tests.
- **Tests executed in this editor session: 0. Pass/fail counts: unavailable.** This session has no command execution tool. TypeScript, lint, focused/full suites and CI runs have not been verified here.
- No Edge Function source was changed for this request; deployment of the previously implemented Smart Studio engine and live source-pixel quality are not confirmed by this change.
- No live images were processed or existing user records modified during implementation.

Run:

```sh
npx tsc --noEmit
npx expo lint
npx jest --config jest.config.ci.js --runInBand services/__tests__/existingImageStudio.test.ts services/__tests__/existingStudioStorage.test.ts
npx jest --config jest.config.ci.js --runInBand
```

## Device acceptance still required

1. Open an existing March of the Mods item with saved original front/rear/disc photos. Process one photo and verify the result visibly exists and matches the selected side.
2. Compare original/Studio, inspect lettering, barcode, borders, cracks and condition evidence. Verify the original file is unchanged independently.
3. Process all photos, cancel mid-batch, reload, and verify completed links remain and unfinished photos can be retried.
4. Reprocess completed photos and verify reuse. Test failed model calls, clipped/occluded products, unavailable source URLs and review results.
5. Switch account/niche or leave the item during processing; verify no late result enters another item/workspace.
6. Confirm ready main-photo presentation is used internally and listing editor/eBay evidence still uses the original `media` URLs.

This implements the existing-photo entry point in source. It does not certify the earlier engine deployment or visual production acceptance.
