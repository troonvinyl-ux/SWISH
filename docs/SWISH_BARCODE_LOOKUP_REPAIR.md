# Barcode lookup data repair

## Observed evidence

Read-only backend logs from 2026-11-07 confirm that Quick List is connected to `swish-ebay-browse`, using eBay UK Browse barcode discovery. Six recent invocations returned HTTP 200. Five returned `no_match`; the 22:28:24 invocation returned a LEGO Harry Potter Xbox product for EAN `5051892055116`, with empty brand/model fields. No Live Preview network requests were available.

The client discarded that legitimate result because `specificBarcodeLead` incorrectly required a model, MPN or ISBN in addition to the barcode and title. This explains why a provider match could appear as no data. The read-only log evidence does not establish why each earlier provider lookup returned no match.

## Changes

- Show valid exact-GTIN product leads even when eBay omits brand, model and MPN. Games, toys and books do not always have those fields.
- Verify response GTIN/check digits before showing a lead; keep physical-photo corroboration, contradictory-evidence rejection and publication checks unchanged.
- Preserve decoded barcode and eBay UK lookup status on screen. No match, invalid code and failed authorization/connection are separate outcomes.
- Pause decoding after a lookup until the seller chooses Scan another barcode, manual lookup or photos; do not repeatedly request the same barcode automatically.
- Use existing server-side eBay application credentials for barcode discovery after tenant/module/entitlement authorization, without requiring a connected seller account. Publication still requires the seller connection and existing policies.
- Use the same barcode-enabled niche policy in the route and module wrapper.
- On empty GTIN search, make one bounded numeric keyword discovery request; only return candidates with matching item-level GTIN/EAN/UPC/ISBN. Keyword title matches alone never become verified barcode leads.
- Handle provider timeouts/detail failures as unavailable, not an empty successful lookup. No seller photographs, condition claims or prices are copied into barcode leads.

## Verification status

Added mocked client regressions and Deno provider-contract tests for the observed model-free game response, ISBN conversion, wrong GTIN, identifier conflicts, numeric fallback, no match and provider failure. These tests and TypeScript/device checks have not been executed in this editing environment. The existing Quick List CI workflow now includes the barcode suites.

Retest on device with the observed game barcode and the bear's actual barcode. Confirm displayed decoded digits match the packaging; confirm eBay result leads appear, no-match text names eBay UK, Scan another barcode retries only on demand and Photo still completes the existing Next → List now / Save for later flow. Native camera decoding and live-provider results after deployment remain unverified.

Coverage is eBay UK seller-listing barcode data, not an exhaustive manufacturer product database. A genuine no match can still occur when no indexed listing publishes that identifier. No new provider, paid catalogue or AI integration has been added.
