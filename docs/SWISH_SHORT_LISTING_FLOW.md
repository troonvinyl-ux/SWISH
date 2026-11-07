# Short listing flow

## Delivered
- Standard capture, Antique capture, the shared scan tab and Coin Flipper capture use the same Photos -> Next -> List now / Save for later workspace.
- Next identifies the original evidence and processes photos concurrently, researches the selling price, resolves the top returned eBay leaf category and populates supported evidence-backed specifics. All completed fields are persisted on the canonical draft before the final screen.
- List now is the seller approval action and sends the saved listing through the existing publication pipeline. No separate Generate, Create, Approve or Preflight screens are required.
- Save for later persists the private draft even if price or category requirements are incomplete. It never sends an eBay publication request and opens Inventory -> Draft.
- Existing stock uses automatic preparation. Existing drafts are reopened, not regenerated. The shared editor uses the same compact listing summary; detailed controls and regeneration are optional advanced controls.
- Processed photos are the displayed/selected images once accepted. Original evidence remains stored and is used for identification. Originals are the fallback only when no accepted processed photo exists.
- Market value is a single stored/researched midpoint in GBP. Selling price remains a distinct editable amount. Evidence ranges, confidence, rationale and completed-sale/asking-price counts are additional details.

## Safeguards retained
Required specialist evidence, missing genuinely unknown fields, category-supported condition values, paid niche/tenant scope, original-photo persistence, eBay business policies, publication claims and accepted-but-unconfirmed recovery still apply. Unknown facts or a price without research are not fabricated. A blocked item can remain in Draft for later completion.

A photo-processing attempt completes before the final preview. Existing accepted cutouts and identification/copy/value reuse prevent repeated work. Processing/provider timings are not represented as an under-60-second guarantee.

## Verification status
The existing authenticated editor RPC was checked read-only and is available. Pure autofill tests and mocked draft-versus-publish regressions were added to universal-quick-list CI. No shell, TypeScript runner, test runner, native camera, visual preview or live seller publication was executed in this editing session. Device and connected-account acceptance remain pending.
