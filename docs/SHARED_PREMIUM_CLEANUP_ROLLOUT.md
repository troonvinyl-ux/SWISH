# Shared premium cleanup and workspace rollout

## Product and shared architecture
SWISH sellers use one evidence-led workspace to prepare and sell niche inventory with clarity, control and confidence. Smooth, layered Stage cards, restrained niche accents and strong item/price hierarchy are shared signatures. All module boundaries, specialist routes, auth and tenant/RLS behavior remain in place.

## Image changes
- Replaced the automatic guessed-contour/compositor/background-generation pipeline with a direct OnSpace AI photo-edit request at the existing shared endpoint.
- Default editing model remains `google/gemini-2.5-flash-image`; existing configured models are retained. Comparison uses the configured multimodal model, default `google/gemini-3-flash-preview`.
- Request: remove surrounding background, centre the complete photographed product on a plain white square canvas with margin, preserve perspective, artwork, unreadable marks and every defect. No repairs, invented content, OCR-based redrawing, copied catalogue art or merged views.
- A separate source/edit model comparison must explicitly pass identity, defects, text, no invention, completeness, centring and background removal, at confidence >=0.95. Uncertain/failed requests retain the original; no automatic retry or speculative replacement.
- Generation cannot guarantee pixel-for-pixel preservation. Passing the comparison is **not** a pixel-exact certification or proof of condition/authenticity. Inspect original and clean photos before submission. White canvas is the default; transparent alpha is not promised.
- Cleanup now runs with Identify, not as a separate AI job on each photo capture. Serial work has a hard batch budget and per-photo deadlines; unprocessed photos retain their originals and can be retried.
- Identification and valuation evidence continue to use originals. Accepted clean outputs carry forward as preferred inventory covers, gallery views and new listing selections. Originals remain untouched in `items.media`; presentation associations stay in existing `items.attributes`.
- Existing explicit listing photo selections are respected. For an existing draft, choose the clean photo in Photos & main image, then save. No live eBay photos change without confirmed revision/publication.
- The existing atomic editor guard was extended to accept comparison-passed, linked clean photos. Marketplace writes additionally check stored PNG provenance, source/cache hashes, tenant path and specialist niche. No data rows were modified by the migration.

## Premium shared UI
- Shared `PremiumCard`, `PremiumField`, `PremiumStyles` and semantic theme tokens provide the reusable baseline.
- Shared listing editor: item/price cover card; title and description with small inline AI buttons; segmented sale format; grouped pricing/delivery; collapsed photo/category/condition/specifics/stock/research cards; fixed review/revise action.
- Shared inventory: larger item photos/titles/prices, compact actual watchers/views, stock summary cards, tools in a collapsible panel, sorting modal.
- Shared sorting: newest, oldest, price high/low, watchers, views. Stable non-mutating ordering; missing values last; scope-specific state. Engagement sorting is offered only where listing metadata is applicable. Research uses price/date sorting on actual returned comparables.
- Shared research screen now uses active niche/specialist instead of hardcoded coin scope, bounded photo transport, source-separated sold/asking/AI cards, niche reference destinations and scoped cancellation.
- Selling tools tab, specialist workspace, photo gallery, review/valuation panels, metric cards and section headers use the same visual direction. Theme contrast/surfaces update other shared consumers without changing their business rules. This is a shared component/baseline rollout, not a claim that every bespoke niche screen was individually redesigned.

## Verification status
- Executed read-only database checks: original photo accepted, unlinked URL rejected, atomic guard installed, invoker security preserved.
- Added pure/mocked/source tests for sorting, photo promotion, detail-check rejection, research evidence projection and shared UI wiring.
- Updated CI triggers/regression step and the opt-in live fixture runner for the direct cutout contract.
- Local TypeScript, lint, Jest/Deno suites, installed-device acceptance and paid AI visual tests were **not executed in this editor session**. Edge deployment/runtime confirmation remains pending.
- Live visual acceptance requires original/output inspection, especially small lettering, stamps, coin legends, reflective surfaces, missing components and real damage. March of the Mods fixtures remain available under `test-lab/studio` for the opt-in runner.
