# Shared eBay engine audit and implementation plan

**Date:** 2026-10-30  
**Repository:** `troonvinyl-ux/SWISH`  
**Scope:** Reuse the existing OnSpace/Supabase-compatible backend and eBay integration. No new database, authentication system, or duplicate niche-specific marketplace engine.

## Audit result

SWISH already has shared eBay backend entry points rather than one implementation per niche:

- `swish-ebay-list`: listing creation/revision/end operations and category/aspect helpers.
- `swish-ebay-sync`: listing reconciliation and token refresh.
- `swish-ebay-orders`: order import and sale reconciliation.
- `swish-ebay-finances`: account-level marketplace transactions and payout/funds routes.
- `niche-modules.json`: canonical niche/specialist registry used by sync and order scope validation.
- `app/ebay-hub.tsx`: dashboard queries for listings, sales and orders, with a niche specialist filter for item-linked counts.

The existing functions use the current encrypted connector credential payload and existing tables. This work must continue to use that architecture.

## Findings

1. **The shared service foundation exists.** The work should consolidate contracts and correct gaps, not duplicate functions for every niche.
2. **Listing sync is deliberately mapping-based.** eBay listings are reconciled to SWISH using external listing IDs and existing listing/item links. Unknown eBay listings cannot safely be assigned a SWISH specialist merely because a niche import screen is open.
3. **Order imports already accept niche/specialist scope.** They build a listing map from the requested scope and skip unmatched or unrelated orders. Multi-line orders are not safely allocatable yet and remain a release blocker.
4. **Historical sales are stored in the existing `sales` ledger.** Before this change, the sales insert recorded the item/listing/order references and monetary fields, but did not snapshot canonical niche, specialist and eBay category. Dashboard filtering by the item's *current* specialist is not a durable historical classification if an item's mapping later changes.
5. **Marketplace finance transactions are account-level data.** They must not be presented as a niche's sales or profit. Niche reporting should be calculated from SWISH's item-linked sales history, with actual fee adjustments joined where available.
6. **Buyer/fulfilment data and analytics should remain separate.** Order records may require limited personal data for fulfilment operations. The durable sales analytics record must not copy buyer names, email addresses or delivery addresses.
7. **Production verification is still required.** Source inspection is not proof of deployed Edge Function versions, successful live OAuth refresh, correct eBay API permissions, or end-to-end behaviour.

## Changes in this branch

- Adds nullable `niche_id`, `specialist_id`, and `category_id` fields to the existing `sales` table through an additive migration.
- Backfills those fields only from existing item/listing relationships and known specialist mappings. Unknown mappings remain NULL; no speculative classification is performed.
- Captures the resolved niche, specialist and category on new eBay order-derived sales records.
- Keeps the existing order/listing/credential architecture and does not add buyer PII to the sales analytics record.

## Target shared contract

Every niche should call the same backend operations. Niche context is a validated parameter, not a separate copy of the eBay implementation.

- **Create/revise/publish/end:** use `swish-ebay-list`; validate ownership, confirmed category, required item aspects, and the existing eBay identifiers.
- **Import/sync listings:** use `swish-ebay-sync`; reconcile by external listing ID, preserve canonical item IDs, and never broaden an empty niche filter.
- **Import orders/sold events:** use `swish-ebay-orders`; scope to matched SWISH listings, deduplicate order/order-line records, and preserve permanent sales history.
- **Category requirements:** use the existing category/aspect routes and live UK eBay taxonomy; niche AI supplies values, not hardcoded shared-engine category rules.
- **Niche reporting:** query the existing `sales` ledger by tenant and canonical `niche_id`; show gross sales, known fees/costs and estimated profit separately. Do not label eBay account funds or payouts as niche earnings.
- **Account-level finances:** keep the eBay funds/payout view clearly separate and link users to eBay Seller Hub when they need the actual account balance.

## Release blockers / next steps

1. Apply and verify the additive sales migration in the intended backend environment before deploying the updated order function.
2. Add a stable uniqueness constraint or idempotent upsert for sale records using the actual supported order-line identity. Current order-level deduplication does not fully solve multi-quantity or multi-line allocation.
3. Review the niche finance dashboard so all sales-derived totals use the canonical niche snapshot, while account-level transactions/funds remain explicitly account-wide.
4. Correct and test the recurring `swish-ebay-finances` 400/499 errors separately; their root cause is not proven by source inspection.
5. Validate required category aspects against live eBay category metadata, including multi-valued aspects and accepted values.
6. Run TypeScript/Jest checks and controlled-account integration tests; verify deployed Edge Function versions and live listing/order reconciliation before production use.

## Safety constraints

- Do not create a second database or authentication system.
- Do not create separate eBay integrations per niche.
- Do not weaken credential encryption or expose eBay tokens to clients.
- Do not treat an eBay account-wide finance response as niche-specific revenue.
- Do not store buyer identity/address data in the historical sales analytics record.
- Do not guess a niche when specialist/category mapping is missing or ambiguous.
