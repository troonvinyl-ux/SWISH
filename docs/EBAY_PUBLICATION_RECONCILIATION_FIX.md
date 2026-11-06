# eBay acceptance versus SWISH reconciliation

## Confirmed incident
- The `swish-ebay-list` invocation at 2026-11-05 22:07:08 returned HTTP 200 with `success: true` and external item ID `800882306822`.
- A read-only inspection found SWISH listing `149590c8-e81c-4b9b-8ad3-4ab6ef1426e9` already `active`, with that exact external ID and no remaining publish claim. Its `vinyl_records` inventory item was still `review_required`.
- The matching PostgreSQL log showed HTTP 403 for `swish_transition_item` immediately after publication.
- Permission inspection confirmed that `service_role` could execute the transition RPC but lacked USAGE on the `auth` schema. That invoker RPC resolves `auth.uid()` and `auth.role()` before its lifecycle checks.
- The client treated any lagging item status as a failed submission and displayed a generic Retry action, even though eBay had accepted the listing.

## Repair
- Applied grants for service-role auth-schema name resolution and identity-helper execution. No user records were modified by the SQL tools. No RLS, membership, niche, sold-item, marketplace evidence or invoker-security checks were removed.
- Recorded the grants in `20261109_publish_lifecycle_auth_usage.sql`.
- Shared submission results now distinguish provider acceptance, pending local reconciliation and unknown publication outcomes. A successful eBay acknowledgement with an item ID remains publication success even if local readback or the stock transition is pending.
- Added two bounded read attempts to confirm local reconciliation; neither retries marketplace creation.
- Added an initial saved-publication/claim check and in-flight request sharing to prevent another publish for a known existing listing or a pending claim.
- Server publication responses now explicitly include acceptance and reconciliation status. Existing server-only publish claims remain in place.
- Preflight displays the saved eBay ID and a publication-status card. Accepted and uncertain outcomes offer inspection and **Synchronise existing listing**, not another submission.
- Status recovery uses the existing authenticated `swish-ebay-listing-status` endpoint with the saved internal listing ID and its original niche. It performs GetItem status reconciliation only, never an AddItem, revision, deletion or new draft. Success must be read back against the same saved external ID and matching stock status.
- Inventory reload is requested after successful publication or status recovery.

## Verification and remaining work
- Backend permission assertions passed: service-role schema resolution and lifecycle execution are available; the lifecycle function remains invoker-security, anonymous execution remains denied, and marketplace-evidence, niche-access and locking safeguards are retained.
- Added mocked regressions in `services/__tests__/listingPublication.test.ts`: accepted-but-lagging stock, unavailable/mismatched readback, caught-up stock, active/ended listings, pending claims, duplicate taps, explicit rejection, uncertain transport outcomes, status-only recovery and tenant/niche boundaries.
- Tests were written but not executed: this session has no command runner. Updated installed-device UI and successful lifecycle execution after the grants still require retesting. No new eBay listing was published or existing listing altered through the tools.

## Existing item recovery
Reopen the original March Of The Mods listing and choose **Synchronise existing listing**. Inspect the result and saved eBay ID `800882306822`. Do not press Submit again or create another draft. The original inventory row was intentionally not rewritten by the SQL tools; the explicit status-sync action is its recovery path.
