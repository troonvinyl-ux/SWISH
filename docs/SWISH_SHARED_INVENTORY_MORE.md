# Focused shared inventory and niche-aware More tools

## Daily workflow

All registered niches use the same existing canonical inventory service and hook. Inventory now presents only In Stock, Draft, Live and Sold; the coin-only All Coins default is removed. Niche name, accent, icon, search terminology, inventory reference and card metadata adapt to the selected module. Coin denomination, ruler, year and grade can come from the original top-level fields as well as saved attributes. No inventory identities or specialist assignments are rewritten.

Search, compact ordering, item detail, draft editing, live engagement metrics, recommended-price application and separate End/Delete actions stay in Inventory. The large account panel, specialist banners, manifest tools, bulk controls and explanatory accounting paragraphs no longer push the actual cards offscreen. Empty Stock explains that Draft/Live/Sold remain available; it is not presented as an empty entire account.

## More

- Inventory tools: stock revalue/reidentify, confirmed sequential publishing, sold-order sync, account scope and canonical unit/listing information.
- All records: original stock, draft, live, sold and archived records remain accessible through More → Inventory tools → All records.
- Coin-specific resources: Islamic & Indian Silver, Silver batch and Deep identification lab. Other niches receive their own existing resources (MX calculator, music catalogue, card grading or supplier manifest).
- Buy a lot / split & sell is accessed from More rather than the stock workspace.
- Account identity and workspace details are also in More. Opening More itself does not start a full inventory read.

The new tool route is registered in shared and isolated builds, including the curated Collectibles build. The app and Edge registry mirrors were updated together. Existing route authorization, owner-only controls, providers, canonical count RPC, photo preference and backend RLS are unchanged. Publishing rejects mismatched tenant/niche records, duplicates and wrong lifecycle projections; it starts one seller operation at a time and stops starting new operations when the authenticated module changes. Failed seller results are not automatically retried.

## Verification

Executed a read-only backend prerequisite confirming authenticated access to the existing canonical count RPC. No inventory, photo, seller or entitlement records were modified through SQL.

Added pure/source/mocked coverage in `sharedInventoryWorkspace.test.ts` and `inventoryMoreNavigation.test.ts`, and updated older coin/navigation expectations for the moved tools. The inventory workflow includes the shared workspace, lossless coin and draft-route checks. This editing environment does not provide a shell or device runner: TypeScript, Jest, packaged navigation and installed iOS/Android validation remain pending. No runtime latency or live marketplace result is claimed for this change.
