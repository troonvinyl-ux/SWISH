# Shared photo carry-forward repair

## Observed failure
The device screenshot shows `data.arrayBuffer is not a function` for every original view. The upload path downloaded each original to verify unchanged bytes, then called Blob.arrayBuffer unconditionally. React Native Blob on some Android/iOS runtimes lacks this method. Uploads could complete while verification failed; no URLs reached canonical items.media, so the listing had no photos.

A read-only backend query found one collectibles item with stored originals and empty canonical media. No live user records were changed during diagnosis or implementation.

## Changes
- Binary Blob reads feature-detect arrayBuffer and otherwise use React Native FileReader.readAsDataURL plus base64-arraybuffer decoding. Byte comparison remains mandatory; no re-encoding, compression or evidence substitution.
- Upload retry uses the same content-addressed path and the existing saved inventory ID.
- Shared item overview and listing editor recover already-uploaded originals for any registered niche, through the ordinary authenticated client/RLS. Only that item's originals directory and legacy numbered captures are eligible. Studio/reference folders never become evidence.
- Hashed originals are downloaded sequentially and checked against the SHA-256 of canonical base64 used in their filenames. Duplicate slot versions require review rather than guessing.
- Recovery uses the existing updated_at compare-and-set and an independent persisted readback, leaving populated media untouched. Concurrent callers share one recovery operation.
- A recovered private draft may seed its previously unavailable photo selection for seller review; saving remains explicit. Intentionally empty selection on populated items and live eBay listings are not automatically revised.
- No schema, permission, provider or marketplace changes. A new scanner visit still starts blank; recovery operates on the saved item, not stale scanner state.

## Verification status
Added mocked regression tests in binaryBlob.test.ts and capturedPhotoRecovery.test.ts; extended originalImageBytes.test.ts. Test execution and installed-device verification are still required; this session has no command execution/device test tool.

Suggested CI command:
`npx jest --config jest.config.ci.js --runInBand services/__tests__/binaryBlob.test.ts services/__tests__/originalImageBytes.test.ts services/__tests__/capturedPhotoRecovery.test.ts services/__tests__/inventoryPhotoPersistence.test.ts services/__tests__/studioPhotoPolicy.test.ts services/__tests__/scannerSession.test.ts`

On the updated Android/iOS build: open the previously saved collectibles item or its draft, confirm the five existing views are recovered, save/review the selected listing photos, and retry one new capture. Check original/studio linkage and cover order, no duplicate inventory, and no eBay publication/revision without confirmation. Also retest another niche and browser Blob handling.
