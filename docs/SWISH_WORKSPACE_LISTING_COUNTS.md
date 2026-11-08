# Workspace listing-count correction

## Confirmed cause

The Minority Report automatically requested `p_platform=true` for owners. The screenshot's **460 Coins** combines three workspaces, rather than the currently opened workspace: 250 + 208 + 2 records. A read-only aggregate found 204 eBay listing IDs repeated across workspaces. These are not duplicate identities within one tenant, and are not merged, deleted or reassigned.

Authenticated read-only checks on the affected current workspace returned:

| Metric | Coins |
| --- | ---: |
| Canonical item records | 250 |
| In stock | 22 |
| Draft items | 8 |
| Live inventory items | 206 |
| Unique recorded live eBay listings | 206 |
| Sold records | 14 |
| Archived records | 0 |
| All deduplicated stored eBay relationship rows | 230 |

These are **saved SWISH counts**, not an independent live eBay verification. No provider sync or marketplace mutation was executed.

## Fix

- Shared Minority Report defaults to **My workspace**, including for owners. **All workspaces** is an explicit owner-only selection, clearly labelled as per-workspace record aggregation. The selection resets on user changes; results/flights stay bound to user, workspace and reporting mode.
- Niche rows and summary figures use the same selected scope. Tapping an all-workspace row explicitly opens the current workspace, not a combined inventory.
- Schema-only report output extension preserves unclassified history within the selected scope. The affected workspace contains 544 records including 8 unclassified historical records; these remain included in the summary without being assigned to Coins. Workspace totals and module sums are checked before presentation.
- Stored live listings and physical live items are named separately; archived and draft-item semantics are explained.
- eBay Hub now reads the shared canonical count contract rather than counting a capped download of raw listing rows. The new `swish_niche_listing_metrics` RPC retains invoker RLS and calls `swish_inventory_tab_counts` for current-module/paid authorization. Deduplicated eBay observations supply total/ended relationship metrics.
- Report entry/return and confirmed inventory changes refresh stored data without polling or eBay operations.
- No item, listing, photo, historical workspace, entitlement or policy was changed.

## Evidence and limits

Executed: authenticated SQL equality assertion across current-workspace Minority Report, inventory count RPC and new Hub metric RPC; other-workspace denial; inactive-niche denial; missing-JWT denial; invoker/anon ACL audit; workspace total preservation (544, including 8 unclassified records) and unchanged platform-history aggregate assertion.

Added pure/mocked regressions for all twelve niches, scope selection/session reset, 250 versus 460 fixture, live-listing versus live-item separation, malformed-count rejection and SQL boundaries. CI includes these tests. Jest, TypeScript/lint execution and installed-device verification were not run in this editing environment.

On device: open SWISH → My workspace and confirm Coins 250 / 22 stock / 8 draft / 206 live / 14 sold for this recorded snapshot. Open Coins inventory and eBay Hub to compare. Counts can change after real saves/sync. All workspaces intentionally shows separate tenant records and may exceed one seller's unique eBay total.
