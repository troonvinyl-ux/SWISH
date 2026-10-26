# Surplus Flip: Manifest-to-Profit workflow

## Product promise

Upload a supplier manifest and receive an explainable **BUY**, **BUY IF NEGOTIATED**, **DON'T BUY**, or **INSUFFICIENT EVIDENCE** recommendation. After purchase, track actual stock, listings, sales, returns, fees, holding time and liquidation until the lot is closed.

## Decision model

The pure calculation module is `services/surplusDecisionEngine.ts`. It deliberately does not scrape or invent prices. A production caller must provide evidence-backed inputs.

Per manifest line, collect:
- SKU/barcode, description, quantity, condition and product photo.
- Expected resale price from sold comparables where available; label asking-price-only evidence separately.
- Sell-through estimate and its source/date.
- Marketplace fees, fixed transaction fees, shipping subsidy, packaging, preparation/repair, returns/defects reserve.
- Restricted/unlistable flags and expected recovery value if unsold.

Deal-level costs:
- Supplier purchase price, inbound freight, collection, testing/preparation, disposal and other known costs.
- A configurable contingency reserve.
- Target profit margin and minimum return on cash.

The engine returns line-level net contribution, expected unsold units/recovery, expected profit and ROI at the asking price, a downside stress case, break-even price, maximum recommended bid, confidence, warnings and reasons. The default fee, unsold recovery and stress-case values are assumptions—not current eBay fee claims—and should be configurable from the user's business settings before a buying recommendation is shown as production-ready.

## Required decision safeguards

1. Missing or weak market evidence must result in **INSUFFICIENT EVIDENCE**, not a confident BUY.
2. Retail RRP is not resale value. Asking prices are not confirmed realised sale prices.
3. Display all material assumptions and data freshness beside the verdict.
4. Flag restricted, unsafe, counterfeit or unlistable products for manual exclusion/review.
5. Show a downside case, not just a best-case total.
6. The app must never purchase a lot or publish listings automatically.
7. Draft listings remain in the existing SWISH listing flow; user reviews price, condition, category, images, quantity and Simple Delivery before publishing.
8. Use existing tenant, database, auth, inventory and listing infrastructure. Do not create a second database.

## After the lot is purchased

Every imported line needs a stable link to its manifest name/row, supplier SKU/barcode, lot ID, quantity received, unit landed cost, available quantity and quantity sold/returned/damaged/cleared. Lot-level freight and fees must be allocated consistently (by unit cost or unit count; make the method explicit).

For every sale, reconcile:
- Gross item revenue and buyer-paid shipping where applicable.
- Marketplace/payment fees, postage label, packaging, refunds, return postage, damaged/lost stock and any unrecovered costs.
- Units sold and remaining units.
- Realised profit versus the original forecast.

Do not infer a sale solely from a listing status. Reconcile against actual order/finance/refund records available from existing eBay integrations. Where data is unavailable, mark it unreconciled.

## Dead-stock policy

The pure rule helper in the decision module proposes a next action based on age, views, watchers, recent sales and minimum acceptable net:
- Under 21 days: improve listing; do not label dead stock prematurely.
- 45+ days: controlled 10% markdown if margin floor allows.
- 60+ days without watchers: consider bundling.
- 75+ days: consider a 20% markdown if the floor allows.
- 90+ days with very low views: compare wholesale/liquidation value against continued holding cost.

These are initial defaults, not universal truths. The production workflow should let the seller configure category-specific thresholds and include relisting fees, storage/space costs, seasonality, sales velocity, return risk and cash tied up. It should recommend, not silently execute, markdowns or delistings.

## Implementation status

This branch adds the first pure decision-calculation module. It is not yet connected to the Surplus Flip screen, market-comparable retrieval, eBay order/finance reconciliation, or a lot-profit dashboard. Those are required follow-up implementation steps before calling the end-to-end feature live.
