# Budget-independent pallet assessment

## What changed
- Removed the personal spending limit and mandatory-looking profit goal from the shared three-step lot journey.
- The economic engine no longer uses a budget in validation, profit, ROI, break-even, suggested bid limits or verdicts. Old session budget values remain compatible but have no effect, even if blank, zero or invalid.
- New sessions have no budget and default to no minimum cash profit goal. An optional profit cushion is available under costs, including the existing 50% return cushion. It is a bid recommendation preference, not a statement about the user's wealth or the pallet's actual profit.
- Profit still subtracts purchase price, buyer premium, effective non-recoverable auction tax, marketplace fees, seller postage, packaging, delivery, repairs, storage, contingencies and valued labour. Recovery and sale-rate assumptions remain in use.
- Suggested maximum bid and break-even bids are now labelled separately. A zero suggested bid is explained: either cautious recovery cannot cover costs, or there is insufficient room for the configured cushion.
- The verdict distinguishes a likely scenario profit with downside loss from a pallet losing money even in the usual estimate. Positive usual profit plus cautious loss now says “Profit possible. Check the risk.” It does not inflate the suggested maximum to conceal the risk.
- Expandable cost breakdowns show the proceeds, deductions and bid cost that produce each profit. Both profit figures use the same recommended selling plan.

## Preserved
One shared engine for all niches; manifest parsing and identity; safety exclusions; specialist IDs; user/tenant boundaries; purchased-stock saving; eBay draft/review/publish safeguards. No database schema, existing records, marketplace endpoints or AI model changes. No additional requests during navigation.

## Reproduction and coverage
`services/__tests__/manifestProfitability.test.ts` covers no budget, all legacy budget edge cases, exact cost arithmetic, break-even versus cushion, optional targets, invalid fees, missing bids, bid urgency, safety exclusions and source-level form contracts.
A regression fixture reproduces £568.08 usual profit, -£79.09 cautious profit and a £0 suggested maximum: the zero recommendation and cautious loss remain visible, but are correctly explained as downside/cushion risk rather than no possible profit.
Existing manifest test suites remain unchanged. The optional target was moved into the existing cost configuration so every non-legacy economic input remains accessible.

## Actual verification status
Source and call paths inspected. Live Preview network inspection returned no recorded requests. No shell, test runner, CI execution, native device or interactive preview tool is available in this session; automated tests, TypeScript, lint and device interaction have not been executed. No passing count or production-readiness claim is made.
Run the existing CI regression suite (including the new test file), TypeScript/lint and Android export. Then import a real manifest, enter its bid/delivery, open costs and confirm the cost breakdown, downside risk and break-even values; save only a genuinely purchased lot and confirm listings remain drafts.

## Limits
Manifest RRP is not resale evidence. Low recovery assumptions, low sale rates, shipping and processing labour can genuinely make a pallet unattractive at any bid. Removing a budget does not justify increasing estimates or hiding that outcome. Prices, yield, condition, auction charges and sale rates still need verification.
