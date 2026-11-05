# Shared eBay description / seller-price revision repair — 5 November 2026

## Observed evidence, not inferred success

Reported listing: eBay `800878483330`, SWISH `ac7d6fcb-1e67-438c-91e3-44f8b6afd7d6`, Collectibles.

Read-only backend queries returned:
- Saved listing price £35.00, saved shipping £0.00; inventory suggested price £35.00.
- Listing description length 3,318 characters; generated Annual Christmas Bear description is stored.
- Saved at `2026-11-05T15:46:34.562824Z`; fixed-price listing, reviewed condition ID `3000`.

Backend invocation logs returned HTTP 200 `{success:true,externalListingId:"800878483330"}` at 15:42:46 and 15:46:34. This proves acknowledgement, **not per-field verification**. The original server accepted Warning Ack responses, discarded revision warnings on success, and wrote requested values back to SWISH without an independent GetItem.

Public page fetched during this session:
https://www.ebay.co.uk/itm/800878483330
- Title: Harrods 2000 Christmas Bear 'Nicholas'.
- Public price: **£36.75**, not £42.
- Registered private seller.
- Updated 15:46:34 GMT.

Public revision history:
https://www.ebay.co.uk/rvh/800878483330?rt=nc&_trksid=p4429486.m148105.l48144
- 15:46:34: **Description**, PictureURL, Gallery revised.
- 15:42:46: pictures/gallery only.

This is important counter-evidence: eBay recorded a description change. The screenshots alone do not prove the latest seller description failed to save. The public fetch did not extract eBay's description iframe, and a direct description URL fetch returned no content. Cached client/iframe presentation remains possible, **not proven**. There is no authenticated post-fix GetItem result in this session.

### Price explanation boundaries

eBay can add buyer-only fees and postage/taxes to public prices. SWISH must compare against **seller GetItem StartPrice**, not a buyer-inclusive Browse/web amount. The fetched £36.75 vs £35 is not evidence of a £42 seller price. The user's £42 observation remains unexplained without the current seller snapshot / buyer breakdown; no automatic adjustment to £42 or guessed fee subtraction was made.

Official fee documentation (not a hard-coded fee algorithm):
https://www.ebay.co.uk/help/selling/selling/pricing-items/buyer-protection-information-sellers?id=5595

## Proven workflow defects repaired

1. Legacy stock overview Push and Settings Push All sent **inventory/AI description**, which could overwrite a separately edited **listing description**. This is a source-confirmed overwrite path, not proof that it caused this exact screenshot.
2. Revision success meant Ack only, not successful description/price persistence on eBay.
3. Warnings were suppressed by the server. Client `warnings?.join('\n')` also returned an empty string, causing a successful action to be presented inconsistently by truthiness.
4. Save confirmation did not explicitly distinguish SWISH persistence from an eBay update.
5. Sync stripped HTML and truncated live seller descriptions to 8,000 characters before writing listing copy.
6. Auction revision omitted StartPrice but could store a changed local price.

## Implemented shared changes

- `shared/ebayRevisionContract.ts` and byte-identical deployable mirror: complete escaped Description XML, normalized buyer-text comparisons, exact seller-price comparison, explicit verified-result classification. A markup-only description does not pass text equivalence unless its exact markup matches.
- `supabase/functions/_shared/ebayLiveContent.ts`: validated XML parser for GetItem; full HTML preserved, ID/description/currency/price required. Uses seller StartPrice; fixed-price CurrentPrice is only a fallback when StartPrice is absent. No guessed fee reversal.
- `supabase/functions/swish-ebay-list/index.ts`: all revision paths read saved listing title/description/price and reviewed specifics/photos/options. Older caller inventory payloads cannot overwrite edited listing copy. Caller-supplied external identity is still validated; actual identity comes from the owned listing.
- Complete description transported once via XML escaping instead of nested CDATA. No deprecated DescriptionReviseMode introduced: official eBay guidance says to supply the complete Description and omit it.
- After each accepted revision, one independent GetItem read verifies title, complete description text (allowing harmless HTML sanitisation) and seller price. Mismatch or timeout returns `accepted:true, verified:false, success:false`; saved SWISH edits are retained and no write is retried automatically.
- Revision warnings are returned even for Warning Ack. Successful verification requires unchanged local row version, persistence and readback.
- Auction revision now sends saved StartPrice and reserve; eBay restrictions remain authoritative. Existing listing type comes from saved options, not an arbitrary caller override.
- `inspect_live` route: explicit, read-only, exact linked listing inspection, protected by existing module scope, tenant ownership and paid-niche checks.
- `services/ebayRevisionService.ts`: one shared identity-only production revision service; no successful claim from legacy/unverified responses, warnings/mismatches/HTTP errors preserved.
- `hooks/useListingEditor.ts`: same saved-content revision for all registered niches, single synchronous action lock across save + revision, explicit live inspection, scope-checked results and inventory refresh.
- `app/ebay-listing-editor.tsx`: Save explicitly means **saved in SWISH only**; seller price excludes buyer fees; live revision confirmation describes the actual readback.
- `app/stock-listing/[id].tsx`: every niche Revise enters the shared seller listing editor rather than building a payload from inventory. Banner identifies the **saved SWISH seller price**, not an assumed live price.
- Shared `EbayContentComparison` / `EbayListingLiveCheck` / `useEbayLiveContent`: explicit live seller-price/description check, discrepancy indicators, readable saved/live description comparison, timestamp and stale-snapshot warning. No polling or automatic overwrites.
- `app/settings.tsx`: bulk revision uses the same saved-content/readback service sequentially; ambiguous results count as failures and their errors are visible.
- `supabase/functions/swish-ebay-sync/index.ts`: preserves full live HTML and parses seller price through the same GetItem helper. Targeted item sync avoids fetching all selling sections first. Existing explicitly requested Sync still imports provider fields; Check live does not.
- Shared asset generation and deployment parity scripts now include the revision contract.

## Authorization / data safety

No schema, database rows, RLS, membership, entitlement, OAuth or encrypted credential architecture changed through tools. No live eBay write was performed by the assistant. Existing user-triggered saved-listing revisions and Sync remain the only writes. The new inspection is read-only. No access token, credential reference, raw API XML or secret is logged or returned. Module/resource checks still precede provider access.

Production overview, shared editor, Settings bulk, and any legacy caller reaching the same backend route share the repair. Diagnostic clients that send unsaved field overrides must save the listing first; the server deliberately uses persisted listing copy.

## Verification and delivery status

**Executed:** targeted read-only SQL queries; recent edge invocation/execution log retrieval; public listing fetch; public revision-history fetch; official eBay description-revision and fee documentation search; source review.

**Authored, not executed here:**
- `services/__tests__/ebayRevisionReadback.test.ts`: all 11 niche wiring, complete HTML/entities/CDATA terminator transport, old description mismatch, £42/£36.75 vs £35 seller mismatch, warnings, legacy Ack-only failure, timeout without retry, read-only inspection and server version/ownership safeguards.
- `supabase/tests/ebay_revision_readback.test.ts`: actual XML parser fixtures for escaped/CDATA HTML, seller-vs-current-price selection, wrong identity/missing fields/Failure Ack and price/description mismatch.
- `.github/workflows/shared-ebay-revision-checks.yml`: focused + full Jest, TypeScript, Deno parser + edge checks, deployment parity and retained execution artifacts; no credentials or live seller writes.

This environment has no command runner, authenticated seller HTTP invocation, GitHub branch/PR write tool or installed-device test tool. Therefore no Jest, TypeScript, Deno, Android/iOS acceptance or authenticated post-fix live revision is claimed as passed. The code will take effect through the normal OnSpace code/deployment workflow; deployed version acceptance, existing APK update delivery, GitHub merge and workflow execution remain unverified.

## Required acceptance after deployment

For each registered niche, use an authorized saved live listing:
1. Save edited seller description and seller price: SWISH confirms local save only.
2. Check live eBay: no writes; differences remain visible and edits remain intact.
3. Confirm Revise: verify returned `verified:true`, title/description/seller-price flags and timestamp. Open eBay and refresh its description frame.
4. Change a listing in Seller Hub: read-only check must flag drift without overwriting SWISH edits.
5. Simulate eBay timeout/restriction: no false confirmation, no automatic second write, saved edits retained.
6. Confirm tenant/niche mismatch and revoked entitlement fail before provider access.
7. Test fixed-price and auction restrictions separately; seller StartPrice is not a current auction bid or buyer total.
8. For this bear, inspect the seller GetItem and checkout fee/postage breakdown before concluding why any buyer view showed £42.
