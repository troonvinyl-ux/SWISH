# SWISH base maximum and manual bidding guide

## Current rule
The shared lot workspace now distinguishes three different figures:
1. **Base maximum purchase price** — a fixed retail-based buying ceiling, not an opening offer or verified profitable valuation.
2. **Suggested next bid** — the smallest next amount permitted by the user-entered bid increase. It can never exceed the base maximum.
3. **Separate cautious buying guide** — the existing scenario engine including optional selling fees, labour, losses and recovery assumptions. Its zero result no longer replaces the base maximum.

The new base rule is implemented in `services/lotBasePriceService.ts` with constants in `constants/lotPricing.ts`:
- Eligible retail reference = unit RRP × physical quantity for included GBP products that are not blocked for safety.
- SWISH resale ceiling = eligible retail reference × 0.40 (60% off retail).
- Landed purchase allowance = SWISH resale ceiling ÷ 2.25.
- Base purchase allowance before auction charges = landed purchase allowance − inbound pallet/package delivery.
- Hammer ceiling = (landed purchase allowance − inbound delivery) ÷ ((1 + buyer premium) × (1 + non-recoverable auction tax)).
- Final ceilings are floored to pennies and cannot be negative. Delivery is deducted once, not multiplied or divided by the margin factor.
- Buyer-paid outgoing postage does not enter the base rule. The extra-cost model still permits actual postage expenses/income and selling fees to be entered separately. Defaults no longer assume an unrecovered seller postage cost.

£10,000 eligible RRP gives £4,000 SWISH resale ceiling and about £1,777.78 landed buying room. With safe penny-flooring, the maximum purchase is £1,777.77 before delivery. With £100 delivery it becomes £1,677.77. With a 20% buyer premium and 20% effective non-recoverable auction tax, the hammer ceiling becomes £1,165.12.

Retail value is not realised income. The visible “room at your current bid” subtracts the bid, entered buyer charges and inbound delivery only; it is explicitly not take-home profit. Full cost estimates remain reachable under the cautious guide. Optional costs, profit targets, personal budgets, auction activity and time remaining cannot change the fixed base rule.

## UX and data boundaries
- No current bid or budget is required to reveal the base maximum.
- New product/draft starting prices use 40% of unit RRP. Manual product estimates remain available in the separate scenario/listing workflow; they never raise the base ceiling.
- Total-only manifests derive a unit reference from line total ÷ quantity without counting quantities twice. Contradictory line totals still produce a warning; base calculation uses unit value × actual entered quantity.
- Excluded/safety-blocked products do not support the base maximum. The expanded breakdown shows manifest versus eligible retail value.
- Existing entitlement, tenant isolation, niche identity, inspection, category-specific listing requirements, paid-lot confirmation, atomic saving and draft-only publication boundaries are preserved.
- Snapshot version is `manifest-lot-v3`, recording both the fixed base result and existing scenario results.

## Bidding policy
`services/lotBiddingService.ts` supplies manual, deterministic guidance, not auction-win predictions:
- No current bid: no made-up opening price.
- More than 15 minutes remaining: watch/check first; the possible next amount is shown for reference, not an instruction to bid now.
- 15 minutes or less, or time not entered: if the seller chooses to bid after completing checks, suggest only current bid + actual entered minimum increment, rounded upward to a valid penny amount.
- A next bid above the base maximum: pass; activity/urgency never justify increasing the ceiling.
- Zero minutes: ended; no bid suggested.
- Invalid economics or auction details: check first; no bid suggested.
- Entered bid count informs activity wording, not a fictional number of distinct bidders. There is no claim to forecast the winner, final price, savings or win probability.

Users must recheck the live auction price, bid increments, reserves, proxy-bidding requirements, closing extensions and fees. SWISH does not monitor or bid on an auction, and waiting does not guarantee a lower purchase price.

## Verification
Added `services/__tests__/lotBasePricing.test.ts` covering the £10,000 example, delivery/auction charges, penny-flooring, independent optional settings, zero cautious ceiling versus positive base value, safety exclusion, total-only manifests, missing bid, timing policy, bid counts versus bidders, ceiling boundaries and UI labels.
Updated the existing default-price/postage arithmetic assertion for the 40%-of-RRP starting price.
Read-only SQL confirms the existing manifest RPC is installed. A separate read-only arithmetic query cross-checks the fixed example, not JavaScript execution or device behavior.
No shell, test runner or interactive device tool is available here. Jest, TypeScript, builds, device interaction and authenticated purchase/eBay operations have not been executed; no passing count is claimed.

Device checks: import a £10,000 eligible manifest; leave bid blank and enter £100 delivery; confirm £4,000 resale / £1,677.77 base maximum. Add a £100 bid with a £1 minimum increase; verify watching guidance at 120 minutes and a £101 suggestion near closing. Increase the next bid above the ceiling and confirm no suggested offer. Check that an extra-cost zero remains separately labelled and that saved lots still produce review-only drafts.
