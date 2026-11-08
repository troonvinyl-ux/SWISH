# Capture photo carry-forward repair

## Diagnosis

At 22:54 on 7 November 2026, the BackgroundErase endpoint returned HTTP 200 ready results. The screenshot failure is the separate original-photo upload: the public item-images bucket accepts at most 5,242,880 bytes. Previously Quick List rejected the oversized original before awaiting and linking an already-successful cutout.

## Behaviour

- Quick List starts the existing BackgroundErase engine after each photo is retained, using a serial queue. Next reuses that attempt rather than adding a processing/review step or repeating a paid request.
- Identification uses the untouched retained photograph, not its cutout.
- Before saving, Quick List awaits cleanup and links its result with the stored photograph in the shared photo persistence pipeline. No second standalone studio association write is needed.
- Small originals are still uploaded byte-for-byte. Oversized originals automatically receive a separate JPEG archive/upload copy: at most 2048 pixels on the long edge, 72-DPI JFIF metadata, quality 0.85 initially, verified below 4 MiB. Encoding falls back to 1600/0.78 and 1280/0.70 if necessary; there is no upscaling.
- The full-resolution source remains unchanged in the on-device retained capture. The cloud archive is labelled compressed_capture_copy with the source fingerprint, dimensions and density in photo-asset metadata. It must not be described as a byte-identical full-resolution cloud backup. The retained upload copy is reused for same-item retries.
- Newly exported processed PNGs have 72-DPI pHYs metadata while preserving transparent pixels. Existing verified processed assets remain reusable without a paid replay just to change density.
- Processed images remain the preferred inventory, listing and thumbnail assets. Originals/capture archive copies are fallbacks/reference only. Partial processing still cannot silently publish an incomplete processed-only listing.
- Storage uploads remain immutable and byte-verified; tenant ownership, role association, optimistic concurrency and completeness readback remain enforced.

72 DPI by itself does not reduce the byte count or change screen detail. Pixel dimensions and actual JPEG compression solve the 5-MB error.

## Verification

Added mocked oversized-photo upload, retry, source-preservation, density-header and saved processed-photo carry-forward regressions. The existing CI photo workflow runs the new client tests and an offline Edge PNG-density test. No local command runner or device testing was available in this editor; tests and live capture-to-draft/device-restart acceptance remain unexecuted here. No user rows, buckets, policies, original objects or marketplace listings were removed or rewritten by this change.
