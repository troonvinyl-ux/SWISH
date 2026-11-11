# Live eBay item re-identification

Extends the existing draft evidence workflow to active linked eBay listings, across SWISH niches. It does not delete, end, recreate or automatically revise a listing.

## User flow
1. Open Inventory → Live → item → Re-identify · photos & clues, or use the same action in Edit listing.
2. Select up to eight original views, add close-ups/camera/library photos and private clues. Clues are unverified hypotheses, not buyer-facing provenance.
3. Analyse through the existing specialist identification endpoint (including the existing coin/Numista path). Review confidence, supporting evidence, contradictions and missing information.
4. Save reviewed ID in SWISH. This updates the same inventory item's intelligence, preserves original photos, adds new views, and keeps seller copy, price, category, stock identity, status and external listing ID.
5. Optionally prepare a corrected title during review. In the listing editor, explicitly choose Use reviewed title, review description/category/specifics, select any new buyer photos and save.
6. Separately confirm Revise on eBay. The existing verified revision/readback workflow is reused. Marketplace revision restrictions remain applicable; do not end or recreate the item just to bypass them.

## Boundaries
- Draft locks and the draft command are unchanged. Live mode is explicit and uses a separate invoker RPC.
- The live command requires authenticated active tenant/niche access, linked active/live eBay status, no pending publish or ending, and an unsold/non-archived item.
- Listing and item locks plus optimistic versions reject stale review. No background retry can apply an ID twice after a conflict.
- Partial photo persistence cannot apply an identification. Successfully attached photos remain on the same item for recovery.
- Previous risk warnings and inventory condition/cost/quantity are retained. AI attribute proposals are stored privately, not merged indiscriminately into seller specifics.
- Prepared titles are scoped to both SWISH listing ID and external eBay ID. They never become seller copy automatically.
- No eBay revision or other seller action occurs inside the identification command.

## Verification status
- Live RPC installed successfully; authenticated-without-session denial and ACL checks performed without modifying user records.
- Mocked service/source regression suite added to shared revision CI; execution of Jest/TypeScript is not available in this editing session.
- Real AI/photo flow, native iOS/Android interaction and live seller revision still require installed-device acceptance.
- These changes do not automatically publish an OTA update. APK delivery still requires a compatible published update or a new installed build.
