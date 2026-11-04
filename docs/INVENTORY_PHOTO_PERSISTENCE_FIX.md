# Antique captured-photo persistence repair

## Observed live evidence — 2026-11-04

Baseline inspected: GitHub main `08fa0180a4b7f76fb94356d105be381ec420b58d`.

The reported item, `284d112e-e509-4d7b-a11a-93fbaba540ac` (Apulian Style Red-Figure Stemmed Lekanis Lid), has zero `items.media` entries but four actual original objects in the existing `item-images` bucket:

- `284d112e-e509-4d7b-a11a-93fbaba540ac/1_front.jpg`
- `284d112e-e509-4d7b-a11a-93fbaba540ac/2_back.jpg`
- `284d112e-e509-4d7b-a11a-93fbaba540ac/3_underside.jpg`
- `284d112e-e509-4d7b-a11a-93fbaba540ac/4_marks.jpg`

Backend gateway logs show the item's media PATCH failed with HTTP 403 at 21:59:11 UTC. Column-level checks confirmed authenticated UPDATE privileges for media, attributes and updated_at. The existing invoker identity trigger calls `auth.role()`, but authenticated users lacked USAGE on schema `auth`. This blocks resolution of the trigger's auth helper even though EXECUTE on the helper is present. Storage uploads succeeded independently, leaving the originals unlinked.

## Repair applied

- Applied only `grant usage on schema auth to authenticated` to the existing backend. This installs missing schema name resolution, not access to auth tables. No inventory records were modified by SQL.
- Added the idempotent grant migration for future deployments; the older auth schema grant file existed in source but was not reflected in live privileges.
- Existing `updateItemMedia` now requires an acknowledged row and independent canonical media readback; it exposes the actual write failure instead of a successful-looking save.
- Scanner links successful original uploads before optional valuation/reference persistence. A failed optional valuation can no longer stop photo uploads. Partial upload errors retain successful photographs and the saved item ID for retry.
- Added authorized, item-scoped recovery to the existing image service, invoked from the stock item screen when an Antique item has no media. It enumerates existing numbered original capture files only and excludes generated reference images and nested folders. It uses the ordinary authenticated client, tenant filters, existing RLS, optimistic concurrency and persisted readback.
- Added missing media mapping to canonical `updateItem` so explicit media edits are not discarded.
- Existing design and navigation remain intact. Recovery failures are visible and retryable.

## Checks actually executed

Read-only live SQL and backend log inspection were executed. After the grant, live checks returned:

| Check | Result |
| --- | --- |
| Authenticated schema auth USAGE | true |
| Authenticated auth.role EXECUTE | true |
| Authenticated SELECT on auth.users | false |
| Items RLS enabled | true |
| Restrictive tenant/module UPDATE boundary still present | true |
| Affected item original storage files | 4 |
| Affected item persisted media at SQL verification | 0 — client recovery not yet executed |

This is permission/schema verification, not a simulated authenticated inventory mutation. No user JWT was fabricated, no service-role relink was performed, and no AI or eBay request was made.

## Tests added, not executed in this editor

`services/__tests__/inventoryPhotoPersistence.test.ts` covers scoped writes, actual permission errors, zero-row writes, persisted readback loss, local URL refusal, recovery of the four originals, generated-reference exclusion, cross-tenant/niche refusal, already-linked media preservation, concurrency conflicts, missing files and storage errors. Tests explicitly use mocked clients/source contracts, not live acceptance evidence.

The existing manual `antique-functional-verification.yml` workflow now includes this suite and still runs full service regressions, TypeScript and shared-asset parity. No terminal/Jest execution is available in this editor, so these suites are not marked passed.

## User verification required

Load the updated app and reopen the affected stock item. It should restore and persist the four existing originals without rescanning or creating another record. Then reopen inventory and check its thumbnail, close/reopen the app, and load the same item on another device. Inspect `items.media` after that authenticated recovery to confirm four permanent URLs.

If no stored originals exist for another item, return to its retained scanner draft and retry photo upload. Never fetch unrelated eBay or AI-generated images as replacements for seller originals.
