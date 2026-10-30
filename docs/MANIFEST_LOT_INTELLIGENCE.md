# Shared manifest & lot intelligence — implementation status

## Product principle
Decomposing collections, pallets and job lots is a core capability in every SWISH niche, not a Surplus-only feature. One engine compares unit, identical-product pack and whole-lot exits before any purchase. A dedicated build keeps its existing niche and specialist IDs.

## Implemented
- Shared `/lot-opportunity` workspace, linked from every niche's inventory and specialist capture; generic niche homes expose it too. Surplus Flip now uses this same workspace.
- CSV, XLS/XLSX first worksheet, tab-separated and pasted Markdown worksheet normalisation. Up to 500 product rows, 5 MB file / 2 MB pasted text limits.
- Supplier SKU/lot SKU, ASIN, original EAN, brand, categories, six image links, quantity, condition, grade, weight and RRP preservation. NaN summary rows excluded. Invalid quantities are not changed to one.
- Scientific/rounded or invalid-checksum EANs are omitted from listings; collisions between different manifest rows are flagged. No missing digits invented.
- Editable expected/conservative product prices; explicit RRP-derived assumptions; ungraded-return and conflicting-specification warnings.
- Current hammer bid, bid count, remaining minutes and actual next-bid increment inputs. Competition never inflates intrinsic value. No auction bids are placed and no auction feed is implied.
- Expected/conservative profit, all-in ROI, selling costs, break-even and maximum hammer ceilings, with Research / Potential opportunity / Swerve / Ended states.
- Units per identical-SKU pack, explicit pack prices or a labelled discount, residual individual units, and an optional user-entered whole-lot sale price. Different SKU variants are never silently merged. Arbitrary cross-SKU curated bundles are not yet supported.
- Deterministic title/description and eBay draft proposals, on-demand existing eBay category suggestions, required item-specific inputs, preserved brand/attributes and missing-field checks. No AI is needed for this analysis and no new paid API was introduced.
- Purchased-lot save is an atomic `swish_import_manifest_lot` RPC on the existing acquisitions/items/listings tables. It retains membership and paid-niche RLS, uses a tenant+niche+SHA-256 manifest lock, and reopens existing records on retry rather than creating duplicates.
- The acquisition keeps entered costs and a clearly labelled prediction snapshot in notes. The actual paid hammer is distinct from a current bid. Cash acquisition + inbound cost is allocated across physical units exactly to the penny. Labour/repair/storage risk remains in the opportunity snapshot, not fabricated realised earnings.
- Prepared inventory uses the registry's existing default specialist. Historical items are not reassigned. All new marketplace records are SWISH drafts with no external listing ID.
- Uninspected/missing-field manifest drafts carry `_manifest_review_required`; the actual eBay publish Edge Function rejects them. Stock and listing editors provide explicit seller inspection confirmation after fields are saved. This is an acknowledgement, not independent authenticity/safety certification.
- Shared category-response normalization retains both native `localizedAspectName` and existing taxonomy `name/required` fields, avoiding lost mandatory specifics.
- Navigation retains an in-memory, account/tenant/niche-scoped analysis. It does not make AI/market calls on ordinary navigation. Analysis is not durable across closing/reloading the app until a purchased lot is saved. Large lists use FlatList; file/XLSX loading is deferred until requested.

## Calculation contract
Let N be scenario resale proceeds after marketplace fees, seller postage and packaging. Let F be inbound delivery + holding + repairs + contingency + labour on every manifest unit, including excluded/damaged goods. Let M=(1+buyer premium)*(1+non-recoverable auction VAT).

- All-in deployment = hammer*M + F.
- Profit after valued labour = N - all-in deployment.
- ROI = profit / all-in deployment, where non-zero.
- Maximum hammer = floor-to-pennies(max(0, (min(N-minimum profit, N/(1+minimum ROI), all-in budget)-F)/M)).
- The recommended ceiling uses the best conservative exit. Asking/RRP scenarios are not sold transactions. Recovery and sell-through are user assumptions, not learned probabilities. Unsold residual stock is assigned no revenue in the selected scenario; no future sale is promised.
- VAT is an effective user-entered non-recoverable auction charge, not a complete tax calculation. Sales VAT, insurance and unusual marketplace fees must be included in entered costs/rates. Default 15% + £0.40 is an illustrative fee assumption, not a current category-specific eBay quote.

## Supplied manifest
The reproducible condensed example has **9 product rows, 25 manifest units and £570.69 supplier RRP**. It is based on the supplied worksheet, not a mock sales dataset. The original full descriptions and up to six images are supported through file/paste import.

All products are customer returns with no usable grade. Rounded barcodes repeat across unrelated products; these cannot be used as reliable product identities. The action-camera resolution and drill-bit count conflict between title and description. The returned helmet is excluded from unit/pack resale estimates until competent safety/provenance verification. Heated/electrical products require actual safety/function checks; no therapeutic or CE claim is verified by the manifest.

No current bid, bid count or remaining time was supplied. A live-auction verdict therefore cannot honestly be claimed. With the illustrative default prices/yields/postage/labour, the unit/pack scenario has **no positive recommended hammer ceiling**. Adjusting assumptions is not market verification: investigate actual prices, fees, item condition and seller checkout terms before bidding.

## Research used
- Jobalots terms: https://jobalots.com/en/policies/terms-of-service?currency=gbp — B2B/as-is RAW returns; supplier descriptions/images and quantities have limitations; bids bind buyers; actual proxy increments/checkout charges must be checked.
- UK product safety: https://www.gov.uk/guidance/consumer-products-buying-second-hand-goods
- Distributor duties: https://www.bromley.gov.uk/leaflet/314261/6/402/ch — businesses must not supply recalled/unsafe goods and must retain traceability. Photos and supplier marketing are not safety tests.

## Actual verification and outstanding work
Executed database checks returned: manifest RPC installed=true, security_invoker=true, anonymous_execute=false, authenticated_execute=true, items_rls=true, listings_rls=true. Follow-up definition checks returned snapshot_supported=true and record_limit_supported=true. Installation did not invoke purchase/import operations on user inventory.

Added Jest suites: `manifestOpportunity.test.ts`, `manifestBoundary.test.ts`, `manifestTaxonomy.test.ts`, and `manifestDecomposition.test.ts`. They cover parsing, sample totals, EANs, arithmetic, price/cost limits, bid urgency, pack conservation, mandatory fields, registry IDs and source-boundary contracts. Existing CI already includes these directories.

**Jest/lint/TypeScript/Android build results: not executed in this editor session; no shell/CI execution tool is available. No passed/failed counts are claimed.** Camera/device preview, authenticated purchase-save/rollback/concurrent retries, category lookup and live eBay submission also remain unverified. Source assertions are not integration tests. Edge Function deployment/permissions and real seller policies must be checked before live use.

Supplier image URLs are retained as reference media, not guaranteed permanent SWISH storage copies. Replace with actual matching item photos or confirm permitted accurate use; expiry/CORS and image rights remain external dependencies. The engine does not automatically fetch proprietary sold-price data or predict auction competition. Whole-lot categories and actual item condition still require seller review. It is draft preparation, not automatic publication or a profitability guarantee.
