# Paid Numista image search: shared coin identification

## Delivered scope
- The shared coin scanner, saved-item Re-ID, refinement and other callers of `identifyItemWithAI` use the same integration, including the Islamic/Indian specialist when selected in that shared scanner.
- The separate legacy Islamic batch endpoint remains on its existing Zeno/Numista text pipeline; it was not switched to a new identification engine in this change.
- The existing `NUMISTA_API_KEY` secret is reused on the server. There is no client-side key, new login flow or extra credential requirement. If Numista issued a different key for your Paid Plan, replace that secret securely in Cloud → Secrets.

## Request flow
1. Original captured or stored photographs pass the existing local advisory-quality review.
2. Select at most two faces, preferring explicitly labelled obverse/front and reverse/back over edge/detail views. Stored unlabelled images use the first two originals; there is no claim that their face order is known.
3. Expo ImageManipulator creates temporary JPEG analysis copies bounded to 1024 × 1024 pixels and 800,000 base64 characters per copy. Originals and studio presentation files are not replaced. Remote originals are converted locally; Numista is not sent their URLs.
4. Existing JWT, membership, paid-niche/module and usage checks run before external search. The first AI pass classifies the object; only a coin in the coin workspace triggers Numista image search. Non-coin niches, banknotes and objects classified as medals/tokens do not incur this new call.
5. One `POST https://api.numista.com/api/v3/search_by_image?lang=en` sends JSON `images: [{ mime_type, image_data }]`, `category: coin`, `max_results: 8`. Headers contain the secret `Numista-API-Key`. Client-only labels/dimensions are not sent to the provider.
6. Up to eight deduplicated finalists receive catalogue-detail lookups. The second, existing-model AI review compares both owned faces with all retrieved candidates, inscriptions and measured specifications. It can select only a retrieved type ID. Deterministic comparison then scores the reviewed attribution against that selected record, rather than reusing an obsolete first-pass winner.
7. Visual rank is not used as identity confidence or authenticity. Major weight/diameter contradictions cannot be outweighed by image relevance. No candidate is automatically accepted or published.

## Failure and cost behaviour
- No automatic replay of a Numista image-search request after timeout, rejection or a network failure.
- Missing/denied key, billing restrictions, provider errors or unsupported image preparation are shown as unavailable, not as successful searches. Existing guarded AI/text identification can still return a useful proposal.
- With image candidates, broad text-search discovery is skipped. Without image candidates, existing text/legend discovery remains, bounded to four query variants plus the existing measurement search.
- The new image path fetches at most eight type details per successful image search (below the published 15-detail allowance). Existing exact-reference lookups remain independently supported.
- Every explicit Identify/recheck/refine may incur another successful image-search charge. The shared scanner and Re-ID show this notice. Bulk/general service callers also inherit paid image search if they call the shared coin identification service.
- Published Numista pricing checked during implementation: first 20,000 successful image searches €0.030 each excluding VAT, with discounted higher tiers and Paid Plan minimum charges. Actual billing remains controlled by Numista.

## Display and data handling
- A shared result card identifies **Source: Numista**, displays an unambiguous N# beside every shown candidate and opens its catalogue page for comparison.
- The new full image-search shortlist is transient, not a database or AsyncStorage catalogue cache. Draft persistence strips `numistaImageSearch`.
- New `_numista_image_search` evidence contains only status, selected-photo count, candidate type IDs, method and timestamp. No base64 photographs, catalogue titles/specifications or provider secrets are added to that trail.
- The pre-existing winning-catalogue metadata persistence is unchanged. Numista's current Paid Plan restrictions on retaining other catalogue data require a separate review of those legacy paths or written permission from Numista; this integration does not certify the entire existing app's licence compliance and does not delete historical data.
- Existing originals, inventory identity, valuation and live eBay photos remain separate. A search never edits marketplace listings.

## Verification status
- Database checks were read-only; no schema migration or inventory data rewrite was required.
- Added Node/Jest face-selection, real JPEG-header dimensions, preparation, physical-contradiction, credential-boundary and retention tests.
- Added mock-only Deno tests for provider request shape, deduplication, API denials and no-replay handling. They do not use real project keys or make paid requests.
- Added a targeted CI workflow. Tests/builds were not executed in this editor session because no command runner is available. No live paid-plan authorization or native/device acceptance is claimed.

## Retest
1. Install an updated app build; the old app will not send the new two-face copies. Ensure `swish-identify` and both shared Numista files are deployed together.
2. Capture one familiar coin's obverse/reverse and choose Identify. Expect the Numista card with N# candidates and an evidence-led proposal for review.
3. Open a saved coin, Re-ID with existing photos, acknowledge any advisory-quality warning, then continue. Confirm there is a new visual-search result and the original URLs are unchanged.
4. Add measured weight/diameter incompatible with a candidate; it must not become a verified match solely from visual rank. Test swapped face order and worn/unreadable legends.
5. Test single-face input, failed preparation, Numista 403/402/429 and a network timeout. Do not automatically retry paid calls; show the fallback's actual availability.
6. Test another niche and a medal: no Numista image-search call. Confirm no eBay publication or image replacement occurs just from Identify.

## Reference sources
- Official API entry/documentation: https://en.numista.com/api/index.php and https://en.numista.com/api/doc/index.php
- Official current pricing/limits: https://en.numista.com/api/pricing.php
- Official API licence: https://en.numista.com/api/license.php
- Supplementary endpoint payload reference (documentation page is dynamically rendered): https://leopiccionia.github.io/numista-sdk/interfaces/SearchByImageRequest.html
- Supplementary image limits/service reference: https://numistalib.readthedocs.io/en/stable/_modules/numistalib/services/image_search/service.html
