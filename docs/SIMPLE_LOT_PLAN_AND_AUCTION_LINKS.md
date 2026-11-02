# Simple lot plan, auction links and eBay sold comparisons

## Experience
Product soul: resale traders evaluating a pallet or collection can see a starting bid and its SWISH-price profit quickly, feeling clear, focused and in control.
Context hooks: a buy → delivery → resale strip and per-product SWISH price bubbles. The existing dark Stage material, rounded panels, yellow bid amounts and green profit area remain consistent; outline/filled MaterialIcons are retained as the existing app icon set.

The existing shared workspace now has three tasks: choose a manifest, enter the bid and delivery, see the bid/profit. Timing, fees, product checks and purchase preparation are expandable rather than competing headline calculations. Product cards remain visible with a SWISH price and a dedicated sold-comparison panel. Packs, categories, item specifics, inspection and qualified safety confirmations remain available in product details. Purchased items/listings still require the original explicit save and review gates. Watching never purchases or publishes.

## Arithmetic contract
Base maximum is unchanged: eligible quantity × unit retail × 40% ÷ 2.25, less inbound delivery, converted to a hammer bid using entered buyer premium and unrecoverable VAT. Round down at the final bid step. No personal budget is used. Excluded safety-critical stock contributes no resale value.

The simple suggestion uses only the next entered bid increase, never more than the base maximum. With time remaining it is labelled for later, not an instruction to bid immediately. Without a current bid, show the buying ceiling rather than inventing an opening bid. Saved auction details remain stale until edited; ended and over-ceiling auctions have no suggested bid.

Profit is an explicit gross scenario at the exact bid shown: SWISH resale ceiling minus that bid × buying multiplier minus inbound delivery. It assumes all eligible products sell separately at SWISH prices. It is before selling fees, packaging, repairs, losses and valued labour; the UI does not call it take-home profit. Buyer-paid outgoing postage is excluded. If no actionable bid exists, the figure is labelled as profit at the ceiling, not profit on an actual purchase. Optional full economics and draft pack prices do not silently alter this simple gross scenario.

Example: £10,000 eligible retail → £4,000 SWISH resale; £100 delivery → £1,677.77 maximum hammer with zero entered auction fees. Current £500 and £1 increase → £501 suggested bid, £3,399 gross scenario before selling costs. This is arithmetic, not measured sale probability.

## Auction link persistence
`ManifestSession.auctionUrl` is optional to the user and defaults to an empty string. The version-1 watched snapshot accepts older payloads without it. New snapshots canonicalize and allowlist it; decoding validates it; metadata/file disagreement rejects restoration. `watched_lots.auction_url` is nullable and protected by the existing four account/tenant/paid-niche RLS policies plus a bounded HTTPS constraint.

Links are not fetched by the server. Client validation requires public HTTPS host syntax, no credentials, no backslashes/control characters, valid escaping and port bounds, and at most 2,048 characters. `useAuctionLink` validates again before `Linking.openURL`, surfaces opening failures through the existing alert provider, and guards unmount state updates. Both shortlist cards and the shared workspace provide Open auction.

## Genuine sold evidence only
The new explicit `manifest_sold_comparisons` route in existing `swish-market-value` verifies authentication, tenant membership, canonical specialist/niche identity and the existing paid-niche guard. It reads encrypted connector credentials only server-side. It does not create inventory, update valuation rows, run AI, fetch manifest photos, or invoke the general market-value pipeline.

The adapter requests an application token with `buy.marketplace.insights` scope and calls `/buy/marketplace_insights/v1_beta/item_sales/search`. Only `itemSales` entries with `lastSoldPrice`, GBP currency, valid last-sold date and nonduplicate identity become sold cards. It never substitutes Browse asking prices, unproven Terapeak endpoints or AI estimates. Cards show last-sold prices, dates and condition, with comparable/variant caveats; fetched evidence never changes the fixed SWISH ceiling.

Marketplace Insights is access-restricted. SWISH's live approval is not established by this change. Token/scope/API denial, unexpected schemas, empty results and network failures remain explicit unavailable/empty states. A labelled manual eBay completed-and-sold browser search is offered separately; it is not scraped or represented as API evidence. No claim that reconnecting or buying an eBay Store enables restricted API access is made.

Every product lookup is user-triggered. No navigation, scroll, mount, timer or background lookup occurs. Results are session-only and scope/manifest guarded, including in-flight A→B→A changes. Search terms may be refined; the query used is shown with results. Watching/reopening preserves the manifest/base values, not a promise that eBay comparison prices stay current.

## Verification and remaining checks
Installed the nullable auction-link schema with SQL and preserved existing RLS. Read-only SQL cross-check returned £4,000 resale, £1,677.77 ceiling and £3,399 gross scenario at a £501 bid with £100 delivery. No purchase RPC or user data mutation was executed.

Regression coverage was added for safe/unsafe HTTPS URLs, old/new snapshot restoration, bid/profit consistency, ended/stale/over-ceiling auctions, correct API scope/fields, rejection of asking/undated/non-GBP sales, provider denial, niche-scoped requests and no automatic lookups. Existing source-contract tests were updated for intentional removal of competing cautious/break-even headlines. No shell/test runner is available: Jest, TypeScript/builds, native link opening, live eBay approval and authenticated app-restart flows were not executed.

Manual acceptance: import a manifest; enter bid/delivery; confirm the bid/profit example; save an HTTPS auction link; watch; restart and reopen in the same account/niche; open the auction from the card; confirm stale auction details need updating; reject malformed links; check per-product sold search with approved/denied access; verify accurate unavailable feedback and manual sold search; confirm other niches/accounts cannot access the lot; verify no inventory or live listings were created.
