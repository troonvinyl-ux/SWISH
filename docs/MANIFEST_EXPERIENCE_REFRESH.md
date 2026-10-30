# Manifest experience refresh

Historical UI-refresh record. Current primary pricing and bidding guidance are documented in `MANIFEST_BASE_MAXIMUM.md`: fixed base maximum, optional current bid, lower manual next-bid suggestion, and a separate extra-cost cautious guide. No budget is requested.

## Completed implementation
- The shared lot workspace is now a three-step flow: Add your list → Tell us the bid → See your plan.
- Product rows, grouping controls, selling costs, recovery assumptions and listing requirements are progressively disclosed rather than shown all at once.
- The verdict puts the bid limit and possible/cautious profit first. All monetary outputs are still taken from the existing lot engine; no economic formula, supplier parser, specialist ID, entitlement, database schema or marketplace publish boundary was replaced.
- Step 2 asks for the bid and makes delivery, total spending limit and profit target easy to adjust. Remaining fees, tax, labour, loss and sale-rate assumptions remain editable under plain-language sections.
- RRP-only scenarios remain labelled as guides, not verified sale data. Safety exclusions remain visible. The purchase action still needs explicit purchase confirmation and the actual price paid. Everything prepared remains a draft until reviewed and published through the established flow.
- Progress labels reflect actual activity: choosing/reading the file, checking rows, preparing the plan, looking up eBay categories or saving. There is no timer that pretends market research/scraping completed; no fabricated bestseller or sold-price claims. Fast operations may show only briefly.
- New user-supplied artwork is stored locally and used in the chooser, shared capture screen, generic product homes and Coin Flipper home. Text-heavy image buttons are cropped out; real navigation/actions are rendered natively and labelled for accessibility.
- Tool Flipper artwork is a clearly labelled, non-interactive design preview. No Tool specialist, membership, route or incompatible inventory was invented.
- The niche chooser uses the existing production registry and respects fixed-build restrictions. Choosing a product changes the existing context, not access permissions.
- The unintended extra account tab is explicitly hidden; the existing four tabs remain.

## Not changed
Authentication, account access, historical stock, manifest purchase/import identity, eBay OAuth, backend calculations, publishing safeguards, image-quality logic and build identities.
No new AI calls, paid API services or database changes.

## Verification status
Added `services/__tests__/manifestExperience.test.ts` for verdict fidelity, unknown/negative money, safety/duplicate/barcode copy, all configurable cost fields, non-mutating product ranking and source-level workflow/artwork contracts.
Existing manifest regression tests were preserved. File edits and artwork downloads completed. Test runner, TypeScript/lint, live preview interaction and Android/iOS device tests could not be executed with the tools available in this session; no pass counts or production readiness claimed.

## Manual checks still needed
1. Import a spreadsheet, paste a list and try the example; cancellation/failure must keep the previous lot.
2. Enter a bid and change fees; compare the new headline figures with existing engine tests.
3. Expand products, change pack sizes and prices, inspect safety restrictions, select eBay categories and check mandatory details.
4. Save a purchased lot, retry, open existing stock/drafts, confirm nothing is published automatically.
5. Check 320px phone, tablet, desktop and landscape layouts; keyboard focus, reduce-motion and screen-reader announcements.
6. Confirm branded APKs still do not expose unrelated product selection; verify the extra account tab is gone.

The current manifest analysis remains an in-memory session until a purchased lot is saved. Closing/reloading the app can clear an unsaved lot. Auction time and bid count remain user-entered snapshots, not a live auction feed.
