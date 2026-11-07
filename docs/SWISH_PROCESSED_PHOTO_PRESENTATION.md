# Processed-only item photographs

## Policy
- After a successful, validated BackgroundErase result exists for an item, galleries, covers, thumbnails, capture previews and listing selections display only processed photographs. A partially processed item does not show its remaining originals beside processed views.
- When no accepted processed result exists, original photographs are the fallback. Failed, review-only, legacy generative and unrelated derivative results do not bypass existing validation.
- Original bytes, canonical `items.media`, `_photo_assets`, `_photo_pipeline` and processed-to-original associations remain stored for future reference, retries and identification. This change does not remove photographs or rewrite existing records.
- Main-image selection maps the processed URL to its retained original and saves the source order under the existing tenant/niche/version checks.
- Old non-empty listing selections containing originals are projected to processed URLs. Deliberately empty selections stay empty. Foreign selections still fail validation.
- Captured evidence completeness, provenance checks and listing quality gates remain enforced. A partially processed required evidence set blocks publication instead of silently including originals or reducing the requirements.
- No automatic eBay revision or publication is performed. Existing live eBay images change only on a user-approved revision.

## Verification
Added `services/__tests__/processedPhotoPresentation.test.ts` for all twelve niches, partial processing, original fallback, source immutability, duplicate/mask suppression, old selections, empty selections, provenance/UI parity and mocked cover persistence. Existing studio tests were updated only where the explicitly requested display behavior changed; archival and safety assertions remain.

This editor has no shell or device runner. Jest, TypeScript, builds and on-device/gallery/eBay acceptance have not been executed in this session and are not claimed as passed. Read-only backend metadata coverage was inspected; no item data was changed through SQL.
