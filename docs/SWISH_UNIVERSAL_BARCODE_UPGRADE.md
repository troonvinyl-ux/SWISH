# Universal barcode identification upgrade

## Delivered code
The existing shared barcode scanners, `swish-ebay-browse` barcode route, SWISH authentication, active-module guard, canonical inventory, listing draft RPC and eBay listing editor are reused. No database, authentication, scanner or marketplace backend has been replaced. No firmware/Vector work is involved.

Both the always-available scanner and Quick List automatically query the shared lookup. EAN/UPC checksums, UPC-E expansion, ISBN-10 to ISBN-13 conversion and GTIN equivalence remain in the existing normalization functions. Wrong identifiers and invalid codes fail closed. Relevant niches including Tech, Collectibles, Tunes and Trading Cards use the same engine; no module permission is relaxed.

## Identification and evidence
`universalBarcode.ts` runs catalogue and AI independently/in parallel. eBay uses the configured application credentials rather than requiring seller OAuth. Existing exact-GTIN eBay detail validation is reused. In Tunes, the existing Discogs function retrieves individual releases and validates their actual barcode identifiers; its commercial-use/owner restrictions and rate-limited catalogue transport are preserved. No Discogs credentials are put in the app or bypassed.

Gemini 3 Flash is the default AI model through OnSpace AI; OpenAI GPT-5 Mini is selectable through the same server-only gateway credentials. One bounded text-only JSON-schema request asks for title, manufacturer/publisher, date/year, format, edition, region, descriptive category, attributes, eBay category hint and confidence. A catalogue miss no longer stops an AI suggestion. AI suggestions have a minimum self-estimated confidence of 0.55 and a displayed ceiling of 0.79; these are not independently measured accuracy probabilities.

Only exact server-retrieved catalogue barcode associations receive `catalogue_verified`. AI knowledge remains `ai_suggested` even when a model writes `verified`, when models agree, or when a source annotation exists. Model-written source URLs/quotes are discarded. Only provider-returned HTTPS extracts independently containing the barcode and relevant title are retained. No images, condition, asking prices, valuations, completeness or authenticity claims are copied. Unknown fields remain empty. Catalogue verification is not a guarantee that a seller's barcode assignment is correct or that the owned physical item is authentic.

Matching titles/variants are merged catalogue-first without confidence inflation. Differing editions, regions, platforms or identifying numbers remain separate candidates. Field-level source provenance is retained; AI supplement fields do not become verified merely by being attached to a catalogue-backed title. Attribute conflicts are shown explicitly.

## Product workflow
The compact confirmation card is shown without photographs. Confirm Product explicitly approves the selected product, Edit Details allows inline corrections, Add Photos uses the existing camera/library and local original-retention services, and Try Another Match selects an alternative or explicitly requests the other AI provider. The global sheet exposes provider selection. Unknown results offer retry/manual details; no invented fallback product is inserted.

Confirmation uses the existing deterministic capture identity for the physical scan session and `createQuickInventory`. Duplicate taps share a confirmation flight; ambiguous saves and retries reopen the same canonical record. The existing row-locked `swish_create_listing_draft` RPC returns the existing draft on retry. No identity is deduplicated solely by GTIN: separate physical copies legitimately require separate scan sessions. The app keeps a recovery receipt on-device before writing; the same open session is reusable after a failed write. Scan another item intentionally starts a new physical-item session. Cross-account/specialist checks remain fail-closed.

All product details and their original verification status are stored in item attributes. User corrections are marked separately and no longer presented as verified catalogue identity. A deterministic buyer-facing draft is prefilled from explicitly confirmed fields, without an extra paid generation request or invented price. It opens the existing listing editor directly. Long attributes stay in inventory rather than being silently truncated into eBay specifics. AI eBay category hints are descriptive only: no generated category ID is trusted. The existing category picker verifies the actual leaf category; publication still requires the existing photo, condition, price, policy and entitlement checks.

Optional captured photos use the existing processed-photo/original persistence path on this same item. Processing/upload failures retain the saved item and report a same-item retry. Additional photos can also be added through the existing listing editor. Intentional barcode drafts without photos skip legacy missing-photo recovery so their populated editor can open immediately. No eBay publication or revision occurs on scan or product confirmation.

## Cost/performance controls
Tenant settings may contain `barcodeIdentification` with:
- `provider`: `gemini` (default) or `openai`.
- `timeoutMs`: default 10000, bounded 3000–16000 for AI.
- `cacheMs`: default 300000, bounded 30000–3600000 for successful lookups.
- `monthlyLimit`: default 300, bounded 1–2000 AI lookup attempts per authenticated user/tenant.
- `webResearch`: false by default. Explicit opt-in enables up to three provider web results and additional provider charges.

Settings are read from existing tenant settings; no new configuration table or secret is required. Provider choice is whitelisted, never an arbitrary model/URL. Existing `ONSPACE_AI_API_KEY` and `ONSPACE_AI_BASE_URL` stay in the Edge environment. eBay has a 6.5-second total catalogue budget; Discogs has a 9-second caller deadline; each source can fail independently. No automatic paid provider retries occur. Unknown results cache for 30 seconds, outages are not cached, successful warm-instance cache and in-flight collapse are bounded and user/tenant/niche/provider scoped. The monthly counter uses the existing atomic `upsert_ai_usage`; warm-instance 8-per-minute throttling is supplemental, not a distributed per-minute guarantee. Cache/rate state can reset on Edge cold starts; monthly counter remains in the existing database. Client concurrent read collapse does not substitute for server authorization.

Expected prompt-response performance is a few seconds when services respond promptly. Actual end-to-end latency includes existing authentication/module checks and the slowest bounded successful source; no measured latency result is claimed.

## Tests and acceptance status
Added executable Deno tests for EAN **5014503238124**, whose injected AI result is **Doctor Who – Series 3, Volume 1**, formatted as an unverified DVD/BBC/2007 suggestion. No Doctor Who result or specifications are hardcoded in production. Actual live accuracy still depends on the chosen provider's response.

Tests cover catalogue success/miss, AI-only results without sources/photos, invalid checksums/returned IDs, unknown outcomes, malformed/truncated JSON, fabricated citations, provider/network errors, quota denial, conflicts, scope/provider cache isolation and duplicate scans. Jest confirmation tests cover all four target niches, optional photos, upload failures, duplicate confirmation/draft reuse and account/specialist guards. Existing barcode tests were updated to assert the new confirmation flow rather than mandatory photo corroboration at the identity-preview step. Existing publication/physical-evidence guards remain in place.

The shared seller workflow executes these suites, Deno Edge type checks, application TypeScript and shared-asset parity, exporting actual outcomes as CI artifacts.

**Not executed in this editor session:** there is no command/test runner tool and no authenticated native scanner session. No pass, live AI accuracy, real camera decoding, latency measurement or live-device acceptance is claimed. The preview returned no network requests. Run Shared seller workflow checks in GitHub, then scan 5014503238124 on the installed app: check suggestion/status, edit/confirm, optionally add photos, and verify the populated existing editor opens on one canonical item. Test unknown/error cases and a repeated scan in the same physical-item session; confirm separate copies use Scan another item. No production user records were changed by editor SQL inspection.
