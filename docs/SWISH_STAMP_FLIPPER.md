# Stamp Flipper — shared SWISH philately module

## What was added

Stamp Flipper uses the existing `stamps` specialist, canonical `items`/`listings`, authentication, tenant permissions, photo gallery, Quick List, eBay category requirements, publication/readback, seller orders and financial engines. No new database, scanner, authentication or marketplace client was introduced. The shared registry now has 13 niches; stamps remain isolated from Coins and Collectibles.

Routes: `/entry/stamps` (authorised module entry), the existing Identify/Inventory/Listings/More tabs, `/stamp-guide` (More and Specialist Tools). The standalone build contract accepts `SWISH_NICHE=stamps`, with independent `com.swish.stampflipper` identity. Existing unified OTA compatibility policy is unchanged; no APK or OTA release was built or published in this session.

Product intent: inexperienced collectors and resellers cataloguing desktop finds and preparing honest stamp listings, feeling informed, focused and confident. Visual language inherits SWISH's matte dark stage surfaces, yellow actions, a stockbook/philatelic artwork hook and evidence-first headlines.

## Recognition and fields

Capture modes: single/set, sheet/block/booklet, cover/postal history, album/collection lot. The full front is the required baseline; reverse and details are optional because collectors must never detach stamps, split covers or open sealed booklets for a photograph. Use the shared gallery for later evidence and the shared re-identification flow on the same canonical item.

Fields include country, face value, issue/design, issue year, observed colour, topic, format, usage, gum, physical gum check, SG/Scott/Michel claims and catalogue edition, perforation, watermark, paper/phosphor, literal overprint/postmark, centring, faults, completeness, stamp count and album/page/row location. These persist in the existing item attributes. Usage shortcuts do not save automatically or certify gum.

AI-only hidden measurements/catalogue claims remain suggestions. The identifier does not certify MNH, original gum, authenticity, watermarks, valuable varieties or professional grades. Untouched inferred stamp fields start empty in correction inputs so clicking Save does not accidentally endorse them. Explicit seller corrections remain seller evidence, not independent certification. AI prices in stamp identification are zero. No licensed stamp catalogue API is integrated or claimed.

Original photographs are the default for new stamp intelligence records and Quick List drafts. Existing original/BG-removed/both seller choices remain supported; explicit selections are not replaced. Processing remains available and originals remain stored. Colour adjustments or background removal are not new philatelic evidence.

## Industry recommendations built into the guide

1. Begin with GB/Commonwealth or one country; learn ordinary issues before expensive variety hunting. Use SG for GB/Commonwealth, Scott or Michel where appropriate; always record catalogue edition.
2. Use smooth stamp tongs, magnification, a physical perforation gauge and archival stockbooks. Avoid damp, sunlight, tape and PVC. Do not soak or detach material merely to identify it.
3. Record usage, gum and faults separately. Unused is not automatically MNH; CTO is not necessarily postal use. Inspect the safely accessible reverse before claims.
4. Preserve covers, blocks, booklets, sets and sheet margins until researched. Common duplicates can be sold as honest country/theme lots to reduce handling time.
5. One physical lot is one inventory record with listing quantity 1; `stamp_count` records its contents. Different condition examples are not automatically merged.
6. Catalogue value is not expected resale revenue. Compare the same issue, variety, gum, usage, faults and sale unit; never value an album by adding minimum catalogue prices.
7. Record stockbook/page/row and SKU during the first review. Include protective packaging, postage, fees and handling time in the shared profit estimate.
8. Refer high-value or suspect shades, overprints, repairs and varieties to a qualified philatelic expert. AI is a research aid, not a certificate.

The perforation helper uses seller-counted intervals and a physical millimetre span: intervals × 20 / measured span. Thirteen hole centres span twelve intervals. It does not use screen DPI or assign verified varieties. The selling calculator uses the existing profit engine and seller inputs, labelled GBP UK business estimates; fee VAT, international fees and listing upgrades are excluded.

References: Stanley Gibbons beginner terminology https://legacy.stanleygibbons.com/collecting-stamps/dispatches/beginners-guide-to-philatelic-terms and Linn's separation/perforation guide https://www.linns.com/news/postal-updates-page/stamp-collecting-basics/2005/april/separation--perforations--roulettes--die-cuts.html . These are educational destinations, not evidence that any owned stamp was verified.

## eBay and valuation

Existing taxonomy discovers leaf categories and aspects; no stamp category IDs are invented. Conservative import classification recognises postage stamps and covers, avoids Penny/Scott false signals, preserves stamp lots in Stamps and leaves explicit coin/craft/other-product conflicts for review. Existing IDs and historical records are not rewritten.

Shared valuation filters incompatible issue, country, usage, gum, sale unit and catalogue claims. Stamp AI numeric estimates are suppressed rather than substituting catalogue values. Active asking prices remain context, not sold evidence. Marketplace Insights sold-data access is application-dependent and may be unavailable; manual Seller Hub research may be needed. No new API approval was obtained.

## Deployment status and remaining verification

Read-only DB probes confirmed the existing specialist map and 10-grant cache. Schema-only changes applied and read back successfully:
- `swish_specialist_niche('stamps') = 'stamps'`; existing Coins ownership unchanged.
- Verified-grant cache accepts up to 13 entries; locking, role restrictions and expiry rules retained.
- Read-only command snapshot recognises Stamps.

The live database still has the original 10-product `niche_entitlement_known_product` CHECK. It prevents caching Stripe-only Stamps (also existing Collectibles/Tunes) grants. No billing state, user data or permissions were rewritten and no entitlement was fabricated. The existing owner/premium-tier path is preserved. Apply the reviewed schema-only migration `20261126_stamps_registration.sql` through the authorised migration deployment process before offering Stamps to Stripe-only subscribers; it validates a 13-product CHECK before replacing old CHECK constraints. This CHECK replacement was NOT executed by the editor SQL tool.

Regression suites and CI/type/parity gates were added, NOT executed here: there is no shell/test runner tool in this editor session. Deno/Jest provider tests are pure/injected/source tests, not live acceptance. Required device verification: owner and subscriber entry, cross-niche denial, front-only draft, intact cover/album capture, original gallery carry-forward, deliberate catalogue corrections, eBay leaf category and condition fields, explicit publish/readback, live revise, duplicate scan retry and seller order sync. No live eBay listing or inventory record was created for testing.

Next incremental extensions: album/page filters, duplicate-comparison warnings without auto-merge, and a reviewed catalogue/condition export. These are not claimed as implemented.
