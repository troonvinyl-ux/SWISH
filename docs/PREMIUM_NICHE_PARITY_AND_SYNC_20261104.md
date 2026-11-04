# SWISH premium niche parity and eBay sync repair

## Status
Implemented shared core parity and specific source repairs. NOT production certification. No inventory was published, deleted or edited by the editor tools; the installed SQL changes the existing editor function definition only.

GitHub main reference observed: `5f98d3b767dedfdd29aa0d39ea890a65fb4dcd45`. This is a baseline reference, not the commit of this editor session. CI must record the actual post-change commit before any release claim.

## Executed evidence
- Queried current `swish-ebay-sync` logs: at 2026-11-04 22:54:55 the existing function returned HTTP 503 after 6,940 ms. The execution log identified a selling-page fetch failure before database reconciliation. The provider error code was not retained, so the exact live eBay rejection remains unknown.
- Queried PostgreSQL logs: repeated inventory-tab HEAD requests returned 504; a previous Antique media PATCH returned 403. These observations do not prove the pool has recovered.
- Read-only permission query returned true for authenticated media, attributes and updated_at UPDATE privileges, auth schema USAGE, and auth.role execution. No permission broadening was applied in this session.
- Installed the existing `swish_save_listing_editor` definition with shared condition/options/media handling for all eleven canonical niches.
- Read-only postcondition query returned `invoker: true`, `anon_denied: true`, `all_niches_contract: true`.
- Consulted official eBay GetMyeBaySelling and GetItem request contracts.
- No authenticated eBay, AI or application CRUD round-trip was executed by the editor. Logs still show the pre-change invocation; they do not verify the repaired function.

## Repairs
### eBay sync
- GetMyeBaySelling requests now use the OAuth IAF header, explicitly isolate Active/Sold/Unsold containers, exclude other sections, and omit unsupported IncludeItemSpecifics and section-inappropriate sorting.
- Pagination is read from the requested section, not the first TotalNumberOfPages in the entire XML. Omitted empty containers are handled without ending listings.
- Replaced the unsupported Trading GetItems request with supported per-ID GetItem calls including full specifics and watch count.
- Numeric HTTP/error codes are exposed without raw OAuth-bearing XML.
- Exact linked-item observations are fetched before inventory reconciliation. Missing IDs are checked using GetItem, never treated as proof of sale/end.
- Listing and inventory lifecycle use the existing server-only `swish_apply_ebay_listing_status` command. Independent readback confirms saved linkage/status/photos. Metadata updates remain scoped to tenant, listing and specialist.
- Original inventory photos are retained when importing additional eBay photos; bespoke attributes are merged, not discarded. Coin-only issuer/mint fields are restricted to coin specialists.
- Transient token/network errors preserve the connection. Only explicit invalid_grant signals revoked/expired refresh consent. Compare-and-swap protects credential refresh.
- The hub handles HTTP-200 `success:false` as failure, sends explicit niche scope, prevents overlapping token/sync/image operations, and offers actionable retry instead of dismiss-only retry.
- The hub's canonical niche name/color comes from the registry, including Collectibles. Ordinary Listings navigation uses the shared tab rather than the owner-only admin route.
- Failed metric reads cannot produce an all-clear message. Optional financial balances remain unknown when unavailable.

### Shared premium core
All eleven niches reuse one PremiumScanner and the existing useGenericCapture pipeline. The Antique route remains a guarded wrapper; the Identify tab renders the same scanner directly.

Shared features: native camera viewfinder, framing grid, flash, camera flip, gallery, multi-angle evidence rail, required-view checks, retained capture draft, specialist/mode selection, explicit AI invocation, confidence/uncertainty review, editable specialist fields, condition/quantity/acquisition inputs, market research, canonical item save, original photo upload and persisted media readback, retained item-ID retry, draft/editor navigation.

Non-coin AI viewing references no longer replace original evidence. Existing coin catalogue and optional viewing-reference workflows remain intact; no AI provider/model was changed.

Every niche uses the same stock/draft/live/sold inventory route and editor. Stock List opens draft preparation; Draft Edit opens the saved editor rather than submitting without review. Existing deliberate bulk publish controls remain confirmation-based.

The editor now shares the full category-specific requirements, supported-value metadata, condition-policy selection, photo selection, saved listing format/options, quantity/SKU and exact specifics readback previously limited to Antiques. Publish/revise use the same stored fields and server checks for all registered niches. Public submission requires explicit user approval. Unsupported paid subtitle editing was removed rather than pretending it persists.

Inventory/background badge polling was reduced from 30 seconds to 90 seconds and gated on active access/module state. This reduces app pressure; it does not restart or repair the managed database pool.

## Bespoke features retained or made usable
`More → Specialist Checks & Tools` is available for every niche. Selected-item edits persist using the existing specialistItemService, optimistic concurrency and independent readback.

| Niche | Bespoke tools / persisted specialist review |
|---|---|
| Coins | Existing coin dashboard, Islamic silver attribution, deep identification, legends and measured dimensions |
| Motocross | Existing dashboard, acquisition calculator, part number, fitment evidence, OEM status, running/test status |
| Bicycles | Existing dashboard, sizing, component standards, groupset/compatibility and mechanical-test review |
| Clothing | Existing Threads dashboard, care-label composition, measurements, era and flaw review |
| Trading cards | Existing raw-versus-graded calculator; set/number/parallel/language, slab-label and condition evidence |
| Antiques | Existing dashboard, guides, care, condition/value routes; maker marks, period, restoration and provenance review |
| Fossils | Saved anatomy, specimen size, locality/formation, matrix, restoration and collecting-provenance review |
| Beauty | Saved seal/opened status, batch, expiry, ingredients, responsible-person and recall review; existing safety rules retained |
| Tech | Saved exact model/specification, functional tests, battery health, accessories and activation/account-lock review |
| Surplus | Existing manifest, yield, bid/lot and decomposition tools; declared vs observed vs sellable quantity review |
| Collectibles | Existing dashboard; maker/model, character/franchise, edition, packaging and completeness review |

These review records are user-supplied evidence, not automatic authentication, fitment certification, professional grading, recall clearance or mechanical testing.

## Verification register
| Area | Implementation | Runtime verification |
|---|---|---|
| Shared premium scanner / all entry routes | Implemented | NOT TESTED on device |
| Original image upload and item readback | Shared existing architecture retained | NOT TESTED with current user session |
| Inventory list/search/filter/details | Existing canonical routes retained; draft actions repaired | NOT TESTED end-to-end |
| Editor category, condition, specifics/options persistence | Extended shared RPC/client/server contract | Definition postconditions confirmed; authenticated round-trip NOT TESTED |
| Bespoke specialist field persistence | Existing service extended with readback | NOT TESTED against real item |
| eBay sync / token refresh | Repaired source and diagnostics | NOT TESTED after deployment |
| Tenant/niche enforcement | Existing module-session/RLS and server authorization retained | Negative-session tests NOT TESTED |
| Live publication / revision | Shared validated path, explicit approval | NOT TESTED; no item authorized/published |
| Mobile/web/device parity | Same shared components, native/web photo handling | NOT TESTED on devices |
| Jest / TypeScript / full CI | Regression files and evidence workflow added | NOT EXECUTED in editor |

## Automated tests supplied (not run here)
- premiumNicheParity.test.ts: all eleven route/profile contracts, mocked full editor saves/readback, bespoke route retention, registry parity, failed sync outcomes and scope rejection.
- ebaySellingRequest.test.ts: section isolation, unsupported-input removal, correct pagination, redacted numeric diagnostics, backend mirror and canonical sync source guards.
- Updated scanner routing expectations and the lifecycle source assertion to the existing eBay status RPC.
- Existing Antique workflow/photo tests retained.

Run **GitHub Actions → Premium niche parity and eBay sync regressions → Run workflow** on the post-change commit. It records source SHA, Jest JSON and TypeScript output and fails closed if any gate fails. Existing baseline tests may expose independent/stale contracts; do not bypass failing gates.

## Outstanding external blockers / limits
- This editor has no terminal/Jest runner, device automation, signed build delivery or authenticated eBay request execution. CI/device checks cannot be claimed passed.
- Provider application limits, consent scopes, seller restrictions and managed connection-pool health require live checks. If the pool remains unavailable, contact OnSpace support at contact@onspace.ai.
- High-volume sync is bounded by a pre-reconciliation deadline; select smaller batches when the marketplace cannot return complete evidence promptly. No automatic publish retry is added.
- The inherited editor contract supports 25 populated specifics, 65 characters per name/value and 12 selected photographs; unsupported input is rejected, not silently truncated.
- Bespoke legacy tools remain preserved, but this session does not independently certify every advertised feature in every legacy screen. No signed APK/IPA or production-ready claim is made.
