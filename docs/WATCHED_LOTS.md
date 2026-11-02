# Persistent watched-lot shortlist

## Implemented
- Each production niche's shared lot workspace links to **Watched lots**, including before a manifest is imported. **Watch this lot** saves the current manifest, assumptions, warnings, chosen selling plan and exact base valuation. Rewatching the same manifest updates one row, rather than creating another copy.
- The shortlist is private to the authenticated account, tenant and canonical niche. It reloads from OnSpace Cloud across app restarts and devices, on foreground and on page focus; it is not dependent on the in-memory manifest session. No new tab or niche identity was introduced.
- An optional public HTTPS auction-page link is saved in both the private manifest snapshot and small shortlist metadata. **Open auction** is available on linked shortlist cards and in the workspace. Saving rejects malformed/non-HTTPS/credential-bearing links; opening validates again before `Linking.openURL`. Older snapshots without a link remain compatible. Edit the link in **Auction link & timing** or the result details, then explicitly watch again to preserve changes.
- Cards show the saved base maximum, resale ceiling, product quantities and date. Opening a card restores the editable manifest workspace. Stored auction details are explicitly stale: bidding suggestions are blocked until the current bid or remaining time is edited. This flag and the restored date live in the shared session, so opening a newly mounted workspace or navigating away does not bypass the check. No live auction monitoring is implied.
- A confirmation protects the currently open list from being replaced. Removing a card changes only the watched shortlist and requires confirmation.
- Purchased lot saving remains a separate, explicit operation with the actual paid price and existing inspection/publish safeguards. Watching does not create acquisitions, items, listings, capital movements or eBay operations. Purchase identifiers and actual paid price are excluded from the saved manifest. Reopening starts with empty purchase identifiers.

## Data and security
`public.watched_lots` stores small metadata and a bounded base-valuation JSON object. Large manifest text is stored as UTF-8 JSON in private `watched-lot-manifests` Storage (4 MiB application limit, 5 MiB bucket limit), not in PostgreSQL. Immutable revisions are uploaded before the metadata pointer is committed, so a failed upload cannot replace a valid saved plan.

The unique key is `(user_id, tenant_id, niche_id, manifest_key)`; Storage paths are `{user}/{tenant}/{niche}/{manifest-key}/{revision}.json`. Separate table RLS policies check ownership and existing verified paid-niche/tenant access for each operation. Restrictive Storage policies prevent unrelated permissive policies from exposing this bucket, deny anonymous access and deny snapshot overwrites. Opening uses a short-lived signed URL after a scoped row lookup, and validates the payload scope, version, manifest identity and saved valuation. Logout/niche changes hide previous rows immediately; asynchronous results cannot enter a different scope, including an A→B→A switch.

The migration creates only a new table, policies and a private bucket. It does not mutate historical user data or alter existing inventory policies. Niche entitlement expiry can make the saved plan inaccessible until access is restored; the plan is not deleted.

## Behavior and limits
- Saving is explicit, not autosave. Unsaved edits must be watched again before closing the app. The current unsaved manifest still uses its original in-memory session.
- Saving/opening requires a network connection. There is no offline cache or background bidding.
- Metadata pages are loaded in groups of 30 with a **Show more** action. There are no Realtime subscriptions or AI calls; ordinary restoration reads stored data only. Base valuations remain deterministic. Separate, explicit per-product **Check eBay sold prices** buttons now call an authenticated sold-only eBay route; they do not alter the saved valuation or create purchased inventory. API access failures are labelled honestly with a manual sold-search link.
- Saved base valuations are preserved as snapshots on the shortlist, not claimed as verified sold-price evidence. Editing/re-saving uses the current base calculation. A future engine release may recalculate the workspace while leaving older saved cards unchanged until explicitly re-saved.
- Supplier images remain reference URLs. Their availability is not guaranteed by preserving the manifest.
- Removing a watched card does not erase purchased stock, the open in-memory workspace, or historical private Storage revisions. Failed/abandoned uploads and previous revisions remain private; a retention/cleanup process is not part of this change.
- Concurrent saves from multiple devices are last successful pointer write wins; the shortlist contains one row per identity. No claim of collaborative live editing is made.

## Verification
The schema and private Storage policies were installed using SQL without executing user purchase/import operations. Read-only verification returned RLS enabled=true, four account-scoped operation policies, private bucket=true, snapshot helper security-invoker=true, anonymous table SELECT=false, anonymous helper execution=false, immutable update boundary present=true, and the existing purchase command still installed=true. Added `services/__tests__/watchedLots.test.ts` for UTF-8 round trips, snapshot preservation, scoping, schema/size rejection, upload-before-commit, idempotent keys, pagination, removal and purchase boundaries.

No shell/test runner or interactive native device tool is available in this session. Jest, TypeScript, builds, authenticated device saves and app-restart tests have not been executed; source assertions are not integration tests.

Manual acceptance: sign in to a paid niche; import a £10,000 RRP manifest, set delivery £100 and watch it; confirm £4,000 resale and £1,677.77 saved ceiling; close/reopen the app and reopen from Watched lots; update the bid/time before using suggestions; edit and watch again, ensuring one card; switch niche/account and confirm no leakage; remove the card and confirm inventory is unchanged; try offline/save failure and confirm the old saved plan survives.
