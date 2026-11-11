# Inventory lifetime gallery additions

## User workflow
Open any retained inventory item (Draft, In Stock, Live, Sold or Archived) and use Item photos → Take photo / Add images. The same canonical overview handles every registered niche and legacy /item/[id] route.

Library selection supports up to eight images per batch; repeat for more images. No re-identification, listing creation, status transition, sale write or marketplace revision is requested. Existing photos, canonical identity, main image and exact seller listing selection are retained. To send an added image to an active eBay listing, choose it in the existing listing editor, save, and explicitly confirm Revise on eBay. eBay's twelve selected-photo limit does not cap this inventory gallery.

## Shared implementation
- services/inventoryGalleryService.ts: scoped item validation, native camera / multi-select library and verified gallery readback.
- hooks/useInventoryGallery.ts: authenticated current-user / tenant / niche / epoch / item scope, operation lock, on-screen progress, retained batch retries and existing AppProvider inventory invalidation.
- components/feature/InventoryPhotoActions.tsx: accessible controls in the shared ItemPhotoGallery, present with and without existing photographs.
- services/photoPersistenceService.ts: opt-in appendOnly association mode, reusing immutable, hash-verified storage objects and fresh metadata CAS merging. Optional additions do not insert required capture expectations or change _photo_pipeline. Normal capture/recovery semantics remain unchanged.

If an upload partially succeeds, confirmed images remain linked and visible; retrying the retained batch reuses its original roles and uploaded receipts. Clear pending upload only clears retry state, never deletes a saved photo. Retained pending selection survives rerenders on this screen, not closing the screen or restarting the app. Workspace changes stop later writes; an already submitted HTTP operation can still finish, so return to the original item to inspect it. No automatic item creation occurs.

## Presentation and storage
The gallery prefers the processed version of each view where ready, but shows additional unprocessed views instead of hiding them whenever any cutout exists. Other cover/Quick List default projections are unchanged. No background-removal service is invoked by gallery additions.

Uses the existing item-images bucket and existing RLS without schema or policy changes. This bucket is public: packing/dispatch photos should not expose buyer addresses or other sensitive information. Existing size/format handling applies: small allowed images keep original bytes, oversized eligible captures use explicitly tracked compressed upload copies while retaining their source locally; unsupported formats and originals above the existing source limit show actionable errors.

## Verification
Read-only database inspection confirmed the deployed write predicate is based on authenticated inventory ownership, not lifecycle status; reference-preservation triggers remain unchanged. No user records were changed during implementation.

Added mocked regressions for per-niche gallery presentation, all lifecycle states, multi-select roles, permission/cancel paths, tenant/niche mismatch, failed and partial uploads, existing seller selection/capture pipeline preservation, concurrent metadata and same-batch retry deduplication. The shared seller GitHub workflow now includes the lifetime gallery suite alongside pipeline regressions and TypeScript gates. No terminal/test runner is available in this editor session: execution and installed-device verification remain pending.
