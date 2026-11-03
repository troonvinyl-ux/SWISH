# SWISH Edge Function Monitor — deployment and verification

The monitor records metadata-only invocation events for all 25 deployed SWISH Edge Functions.

## Included telemetry

- Function name and generated invocation UUID
- HTTP status and derived outcome (success, client error, failure)
- Execution duration in milliseconds
- Tenant and niche identifiers when present in a small JSON request
- A safe HTTP/error class only

The logger deliberately does not store request or response bodies, authorization headers, access tokens, refresh tokens, eBay credentials, Stripe payloads, or provider error bodies. Large, multipart, image, and video requests are not buffered to discover tenant metadata.

## Deployment sequence

1. Merge the pull request.
2. Apply `supabase/migrations/20261103_edge_function_logs.sql` to the existing OnSpace/Supabase-compatible production database. This creates the telemetry table, owner-only read policy, service-role write grant, indexes, and Realtime publication entry.
3. Deploy the updated contents of every directory under `supabase/functions/` to the existing OnSpace project. The 25 instrumented functions are:
   `swish-check-subscription`, `swish-verify`, `swish-decompose`, `swish-reprice`,
   `swish-coin-image-enhance`, `swish-ebay-listing-status`, `swish-ebay-oauth`,
   `swish-ebay-sync`, `swish-identify`, `swish-migrate-credentials`,
   `swish-ebay-messages`, `swish-ebay-list`, `swish-ebay-browse`,
   `swish-ebay-orders`, `swish-ebay-finances`, `swish-image-download`,
   `swish-list-generate`, `swish-market-value`, `swish-ebay-category`,
   `swish-privacy-policy`, `swish-ebay-post-order`, `swish-islamic-identify`,
   `swish-ebay-draft-sync-test`, `swish-create-checkout`, and `swish-customer-portal`.
4. Confirm the existing Edge Function environment includes `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. The logger reads these server-side and never returns them.
5. Sign in to Master Admin as `troonvinyl@gmail.com`, open **Live Edge Function Logs**, invoke a normal SWISH function, and confirm a new record arrives without manually refreshing.

## Troubleshooting

- No rows: check that the SQL migration is applied and that the updated function revisions are deployed.
- Rows appear after manual refresh but not live: confirm `edge_function_logs` is included in the `supabase_realtime` publication and that the owner session has SELECT access.
- A function returns its normal response but no row is written: check that the Edge Function runtime has the existing Supabase URL and service-role secret configured. Logger persistence failures emit only a fixed, redacted marker.
- The monitor shows only the latest 250 records in the app. The database retains the historical records; no automatic retention deletion is configured.

The source and CI checks do not prove production deployment. Complete the live verification after the migration and function deployments.
