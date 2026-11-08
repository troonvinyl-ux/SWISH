# Authenticated inventory speed repair

## Confirmed bottleneck

The Coin Flipper screenshot still showed a timed-out inventory refresh after the earlier count-query rewrite. PostgreSQL logs confirm three more `swish_inventory_tab_counts` 500s at 2026-11-08 01:25:00, 01:25:16 and 01:25:37 UTC. The earlier 68.54 ms measurement was an administrative SQL-body read; it did not exercise authenticated row-level-security planning. An authenticated six-second probe still failed before this repair.

## Database repair

Migration `20261120_inventory_read_policy_performance.sql` was applied to OnSpace Cloud. The existing count RPC remains SECURITY INVOKER, with the same canonical aggregate and revision contract. No inventory, photos, memberships, entitlements or marketplace identities were rewritten.

- A zero/one-row `swish_readable_module()` relation checks the current JWT subject/session, current module, tenant membership and existing paid/owner entitlement. Its SECURITY DEFINER scope is restricted to this authorization lookup, not inventory reads. It has no client-provided parameters and no anonymous execution.
- Five existing restrictive SELECT policies use uncorrelated authorized-parent sets rather than repeatedly expanding per-row authorization functions and nested relationship checks. Tenant ownership policies still apply. All INSERT/UPDATE/DELETE policies remain unchanged.
- Items remain restricted to the freshly verified current tenant/niche; listings require a readable same-tenant parent; explicit order item/listing combinations must agree; listing-only orders require a readable parent; sales preserve historical niche attribution precedence; returns retain the original three listing/order identity paths.
- Added a tenant/niche/item index. No timeout increase, RLS bypass, persisted access cache or automatic retry was introduced.

## App repair

The shared niche home now reads only aggregate counts. It no longer downloads every inventory item, description, photo URL and photo-processing metadata just to show three numbers. The item-selection modal opens immediately and requests stock only for an explicit List Stock, Market Value or Condition action. It uses its own loading/error/retry state. Modal rows have a bounded render window.

Same-scope previously confirmed totals stay visible during a transient refresh with a clear refresh-pending label. Access/scope denials clear those totals. Failed initial reads do not invent a successful empty inventory. Existing item-detail reads and listing/publication safeguards are unchanged.

## Executed verification

Authenticated role/JWT diagnostics used an existing coin module session inside a rolled-back transaction; no diagnostic session, grant or user record was created. No tokens/session identifiers were output.

- Authenticated count RPC: **86.68 ms**, 250 unique items, 250 units, 22 stock, 8 drafts, 206 live, 14 sold, 0 archived, 206 live listings.
- Authenticated canonical collection classification read: **129.83 ms**, 250 unique items, 206 live, 14 sold. These match the earlier administrative canonical metrics.
- Inactive `tech` module and a different tenant count request raised the expected permission error; assertions passed.
- An unbound authenticated diagnostic subject/session saw no readable module, items, listings, orders, sales or returns; assertion passed.
- RLS remains enabled on all five inventory/ledger tables.

These measurements are database execution timings, not end-to-end native navigation, photo loading, network or eBay latency. Other niche accounts and installed iOS/Android builds still need retesting. Pure hook orchestration/predicate/source regressions were added to CI but could not be executed here because this editing environment has no shell/test runner. No TypeScript/Jest/device pass is claimed.
