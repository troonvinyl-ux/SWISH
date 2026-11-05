# Coin Flipper inventory investigation and safe client repair

## Acceptance status: BLOCKED on the original authorised account and runtime testing

460 existing coin-niche records were found in the existing `public.items` table. None belongs to the tenant of the latest observed Coins module session. No authenticated app session, installed-device controller or command/test runner is available to this editor. Consequently this report does **not** claim that 460 coins were displayed, that a production coin was edited, or that web/mobile acceptance passed.

## Primary observed cause

The latest backend module session is `coins`, updated `2026-11-04 18:21:39.146607-05`:

- User: `7f540063-5f4a-4318-8ca5-38df7f7be19a`.
- Tenant: `f92aa40c-bbb0-4989-ad4e-aba31f8a7958`.
- Existing coin records in that tenant: **0**.
- Coin records across all of that user's tenant memberships: **0**.
- That user has one tenant membership, and no verified platform-owner role.
- Its email does not match a member of any tenant containing the discovered coin records (comparison performed in SQL; other users' emails are not exposed).

The tenant filter is therefore correctly returning no coins for that observed account. Choosing Coins changes the specialist module, **not** the authenticated user or tenant ownership. The three coin inventories belong to different existing user memberships. Granting this session access, changing ownership, moving rows or importing copies would break the requested security boundary. None was done.

This is evidence about the latest backend session, not proof that the user's installed APK uses that exact session: Live Preview returned no network requests. Check the email and workspace ID now displayed on My Coins and the Coin Flipper/KeenOnCoins home screens, then sign in with the original authorised coin account. Each signed-in account must still pass existing paid/module RLS.

## Existing storage and counts

There is **no separate coin inventory table**. `items` is the canonical physical-item table; `listings`, `valuations`, `sales` and `orders` reference its IDs. `swish_inventory_tab_rows` and `tenant_inventory_summary` are views, not alternate inventories. Photos remain in `items.media` and the existing `item-images` bucket.

| Existing tenant | Canonical coin items | Items with media | Items with a listing | Stored positive mid-valuations |
|---|---:|---:|---:|---:|
| `2a4fa6c5-af0d-4288-9901-823898a91634` | 208 | 208 | 204 | 7 |
| `3f8ec755-911c-46ef-b35a-603e26993c27` | 2 | 2 | 1 | 0 |
| `53d169c0-8d37-4378-b8ef-84fbb3991661` | 250 | 249 | 228 | 25 |
| Total | **460** | **459** | **433** | **32** |

These totals are audit-connection observations across separate tenants; they are **not** one user's authorised collection. The 460 records comprise 450 `coins`, 9 `islamic_silver`, and 1 `ancient_artefacts`. All map to canonical niche `coins`. The registry's additional registered legacy IDs also map correctly. `antiques`, `collectibles`, and `curiosities_collectibles` are not added to the coin allow-list.

There are 436 linked listing rows, 426 with non-empty external listing IDs, and zero mismatched item/listing tenant relationships. More than one listing can reference the same physical item; the new All Coins presentation shows one original item card, not one card per listing.

### Inventory before and after

| Measurement | Before | After client code changes |
|---|---:|---:|
| Backend canonical coin records | 460 | 460 |
| Unique canonical item IDs | 460 | 460 |
| Items with original media links | 459 | 459 |
| Linked listing rows | 436 | 436 |
| Non-empty external listing IDs | 426 | 426 |
| Coins in latest observed session's tenant | 0 | 0 |
| Coins in that session user's member tenants | 0 | 0 |
| Successfully displayed on an authenticated device | Not measured | **Not verified** |

The expected result for the observed account remains zero. Showing another tenant's coins would not be a valid repair.

## Additional client defects repaired

1. The inventory opened on Stock, which excludes items linked to live/draft/sold listings. An account can have a large coin collection but very little Stock. Coins now default to **All Coins**, built from the same canonical records and existing relationships, with no default period/category filter. Stock/Draft/Live/Sold remain available.
2. `listItems` stopped at 500 rows, `getAllListings` used one server-capped response, and non-Antique status counts used a single unchecked response. Reads now page in 200-row requests with deterministic ID tie-breakers and surface page errors.
3. Inventory hooks invalidated an in-flight request when subscription/access effects restarted, but then suppressed its replacement using the same-scope lock. They now share the pending promise, retain valid same-scope reads, check stale/unmounted responses, and retain a verified snapshot with a visible refresh error instead of replacing it with a false empty result.
4. Coin search lacked an explicit registry-derived specialist filter. It now checks the existing `swish_can_access_niche` RPC and applies canonical/registered legacy coin IDs with the tenant constraint.
5. Coin dashboard Insights used a hardcoded list containing `curiosities_collectibles` and converted query errors into zero figures. It now consumes the existing scoped inventory hook.
6. Detail reads previously started without waiting for verified module state and did not retry on focus or preserve read failures visibly. They now wait, reject tenant/niche mismatches, refresh on focus, and surface errors. Inline edits re-read and compare saved fields before updating the UI, then trigger shared inventory reload.
7. KeenOnCoins saves now notify the existing shared inventory reload signal after the canonical insert and successful photo linkage.

## Exact files and functions changed

| File | Functions/components |
|---|---|
| `services/itemService.ts` | `listItems`, `getItemStatusCounts`: complete pagination, deterministic ordering, error propagation |
| `services/listingService.ts` | `getAllListings`: complete related-listing pagination, retained IDs/media/tenant join |
| `services/inventoryViewService.ts` | `loadInventoryView`: canonicalise niche aliases before authorization; `buildAllInventoryRows`: one-card canonical presentation |
| `services/coinInventoryService.ts` | `searchCoins`: paid module check, registry specialist scope, sanitized search, paged explicit limit |
| `hooks/useInventory.ts` | `useInventory`: same-scope in-flight sharing, effect restart protection, error snapshot handling |
| `hooks/useMasterInventory.ts` | `useMasterInventory` / `reload`: authenticated user + tenant + niche + module-epoch scope, focus refresh, in-flight sharing, All Coins rows |
| `components/feature/InventoryAccountScope.tsx` | `InventoryAccountScope`: current email/workspace/verified count, existing safe logout action |
| `app/(tabs)/inventory.tsx` | `MasterInventoryScreen`: All Coins default, unique item keys, scoped filters, verified/error counts, account diagnostics; bulk publication disabled for mixed All Coins view |
| `app/coin-flipper.tsx` | `HomeTab`, `InsightsTab`: account scope and canonical inventory hook; bespoke scanner/Numista workflows retained |
| `app/keen-on-coins.tsx` | `KeenOnCoinsScreen`, `handleSaveToInventory`: scope display and shared reload signals |
| `app/stock-listing/[id].tsx` | `StockListingScreen` / `load` / `saveField`, `isCoinNiche`: guarded detail refresh, visible read errors, persisted field readback, registry identity |
| `services/__tests__/coinInventoryRecovery.test.ts` | Mocked pagination, denied-access, mapping, original media/listing ID, All Coins presentation regressions |
| `.github/workflows/premium-niche-parity.yml` | Added dedicated coin inventory regression step and fail-closed outcome gate |
| `supabase/tests/coin_inventory_readonly.sql` | Repeatable read-only audit queries |

No application provider, tenant provisioning, authentication protocol, database schema, canonical registry identity, Numista API, valuation engine, encrypted marketplace credentials, external eBay listing, or existing record was changed by this session's tools. The repaired client uses the same Expo Router inventory route on web and mobile; separate deployed web/APK bundles still need update and testing.

## Verification executed and results

### Executed against the real backend (read-only)

- Discovered existing tables/views: `items` plus inventory views; no duplicate coin table.
- Retrieved aggregate coin records by tenant/specialist/status: 460 unique existing items, 459 with media.
- Compared registry coin identifiers with installed `swish_specialist_niche`: expected IDs resolve to `coins`; antiques/collectibles resolve separately.
- Retrieved memberships and latest module-session scope: zero coin records in selected/member tenants of observed session.
- Verified authenticated SELECT grants on items/listings/view and `security_invoker=true` on the inventory view; restrictive paid item SELECT policy remains enabled.
- Queried canonical All Coins identifier predicate: 460 records, zero antiques/collectibles in the allow-list result.
- Retrieved individual stored coin details and listing links. Example: item `972d2fe2-656b-43b3-b10b-9859627ee115`, original KC ID `KC-001`, stored mid-value £80, external eBay ID `800826592942`, original obverse URL ending `/item-images/972d2fe2-656b-43b3-b10b-9859627ee115/1_obverse.jpg`. Its storage object exists. Empty ruler/denomination values are existing data and were not fabricated.
- Re-read preservation checks after client changes: item fingerprint `3bce4f84f4c8b880021fb15907e68d10` unchanged; listing fingerprint `5a16fc5da6529b83014e358509742ddd` unchanged; zero tenant mismatches.
- Backend error logs and Live Preview network lookup: no errors/requests returned in the available window. That is not an authenticated UI pass.
- Attempted fetching the sample JPEG with the webpage tool: no usable response metadata returned, so image rendering/HTTP delivery is **not verified** by that attempt.

### Added, not executed here

The new mocked regression suite and existing inventory tests are wired into the existing CI workflow. This editor has no shell, Jest/TypeScript execution tool, or authenticated GitHub Actions dispatch mechanism. No Jest pass count or successful build is claimed.

Run:

```sh
npx jest --config jest.config.ci.js --runInBand services/__tests__/coinInventoryRecovery.test.ts services/__tests__/inventoryNicheProjection.test.ts services/__tests__/inventoryTabStatus.test.ts
npx tsc --noEmit
```

### User acceptance checklist

| Requested check | Evidence/status |
|---|---|
| Retrieve existing records | PASS: read-only backend discovery; not an authenticated client's read |
| Confirm correct tenant/niche | PASS: distinct original tenants; observed current account does not own them |
| Coin Flipper displays all authorised coins | BLOCKED: original coin account login and updated runtime needed |
| Images and coin information load in UI | Stored data/object retrieved; rendering NOT TESTED |
| Inventory counts match backend | Backend totals verified; authenticated visible count NOT TESTED |
| Open coins in application | SQL details retrieved; device navigation NOT TESTED |
| Edit a test coin and persist | NOT TESTED: no authorised coin runtime or specified test record; no production edits made |
| Refresh/reopen persistence | Client reload handling repaired; runtime NOT TESTED |
| Web/mobile same inventory | Shared code path retained; deployed-bundle parity NOT TESTED |
| Other niches cannot see coins | Registry/RLS unchanged and inspected; authenticated negative runtime test NOT TESTED |

## Preservation confirmation and next required step

No coins were inserted, duplicated, migrated, updated, recreated or deleted by this development session. All existing item rows and listing rows have matching before/after fingerprints. No eBay connection was decrypted, replaced, disconnected or recreated, and no external listing action was executed.

Use the displayed email/workspace diagnostics to identify whether the installed app matches the observed tenant. Log out with the existing safe logout control and sign in with the original coin account, then open Coins → My Coins → All Coins. Do not import the same eBay inventory to solve an account mismatch. Run the ten acceptance checks with that account and explicitly choose an owned test coin before any edit test. Until then, the acceptance criterion is **not proven**, rather than a claimed successful restoration.
