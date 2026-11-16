# Shared app/web eBay member scope

The deployed backend export supplied by the owner introduced an AsyncLocalStorage-based member client, but module middleware did not enter that context. This caused category fallback calls to throw "eBay request-local member scope required."

The module middleware now invokes the existing member scope after verified JWT, active module, tenant, niche entitlement and resource checks for swish-ebay-list and swish-ebay-listing-status. Required account-scope helpers from the supplied export are tracked alongside the repair. Public taxonomy receives no inherited seller binding. Seller operations retain member identity, live session and binding lease checks. Unscoped client access remains denied.

The website repository is troonvinyl-ux/SwishWeb-v2. It uses the same OnSpace backend and server-established module scope. Neither client can create authorization context by supplying a niche or tenant identifier.

The original exported middleware reproduced the exact reported missing-scope exception. The repaired export passed 24 selected Deno tests. The new GitHub workflow checks the committed middleware dependency graph and its request-scope regression; workflow results, not the earlier ZIP results, are authoritative for this repository revision.

This commit does not deploy Edge Functions or migrate the database. Existing deployed member-binding tables/RPCs are prerequisites for seller operations; missing or invalid bindings remain denied. Rebundle/redeploy the affected functions in the existing OnSpace project with these shared dependencies, then verify authenticated category lookup and status recovery. Existing listing and OAuth handler implementations are retained; other differences between the supplied export and GitHub are not silently imported.

The legacy sync-web-builds-to-swishweb workflow targets SwishWeb and ten old per-niche exports. SwishWeb-v2 has its own React/Vite build. A web build does not deploy this backend repair.
