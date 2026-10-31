# Threads Flip — numbered screen implementation map

**Branch:** `feat/threads-flip-numbered-screen-parity`  
**Visual identity:** `#0C080C` ink, `#160E16` surface, `#E91E8C` hot pink, `#FF3DAA` highlight, `#FFF0F5` cream. Keep the existing Threads Flip palette; do not substitute SWISH yellow.  
**Rule:** the numbers below are stable screen IDs. Shared SWISH pages keep their shared data/actions; Threads Flip applies a presentation skin only when the active production niche is `clothing`.

## 16-screen parity checklist

| ID | Mockup screen | Existing implementation / route | Required visual treatment |
|---|---|---|---|
| 01 | App entry / welcome shell | `app/index.tsx` → auth-aware app routing; `app/onboarding.tsx` for first-run setup | Branded entry/welcome state, garment-led hero artwork, black/cream canvas, pink action. This is not a separate native splash route today. |
| 02 | Sign in / sign up | `app/login.tsx` | Shared auth behavior; currently shared SWISH login branding. A niche-branded login requires the selected niche to be available before authentication. |
| 03 | Home dashboard | `app/threads-flip.tsx` → `HomeTab` | Fashion hero, wardrobe metrics, 2×3 tool grid, category strip, Pro banner |
| 04 | Scan / capture | `IdentifyTab` in `app/threads-flip.tsx` | Numbered photo slots: label, full garment, detail/flaw; camera/library actions |
| 05 | AI identification | Identify flow state in `IdentifyTab` | Branded processing state and visible specialist/AI progress |
| 06 | Identification result | Identify flow state in `IdentifyTab` | Garment hero image, brand/type/era/size/material/colour facts, confidence |
| 07 | Condition & authentication | Identify result details in `IdentifyTab` | Condition notes, damage evidence and LOW/MEDIUM/HIGH authentication risk |
| 08 | Market value | `ValueTab` in `app/threads-flip.tsx` | Price range, sold-comparable evidence, fees/costs and net-profit panel; remove example-only values from live claims |
| 09 | Save to inventory | Save action in `IdentifyTab` | Pink confirmation state, photo upload status, direct wardrobe/list action |
| 10 | My wardrobe | Shared `/(tabs)/inventory` | Shared stock/draft/live/sold data and actions; clothing-specific filters and pink visual skin |
| 11 | Create eBay listing | Shared listing creation flow | Garment-first listing editor; preserve shared listing service and eBay flow |
| 12 | Category & item specifics | Shared eBay category/item-specific flow | Clothing attributes (department, style, outer shell/material, size, etc.) in pink/black cards |
| 13 | Listing review | Shared listing review / preview flow | Garment image gallery, title, specifics, price, postage and publish validation |
| 14 | Listings | Shared `/(tabs)/listings` | Clothing-only listings, status chips, thumbnail-led rows and pink actions |
| 15 | Sold items & orders | Shared orders flow | Clothing order imagery, sale price, fees and fulfilment status |
| 16 | More / settings | `app/settings.tsx` (with `app/(tabs)/account.tsx` as account entry) | Threads Flip identity, black canvas and pink header treatment; shared account, eBay, subscription and help controls |

## Existing in-app specialist tabs (additional numbered audit pages)

These are real Threads Flip tabs and must not be omitted from the screen-capture audit:
- **TF-A — Style:** current `StyleTab`; style, care, vintage and authentication guidance.
- **TF-B — Sell:** current `SellTab`; links to shared listings, inventory, orders and eBay hub.
- **TF-C — Insights:** current `InsightsTab`; market trends, recommendations, sales and repricing destinations.
- **TF-D — eBay Seller Hub:** shared `app/ebay-hub.tsx`; clothing-specialist metrics and branded dashboard.
- **TF-E — Repricing:** shared `app/repricing.tsx`; stale listings are now filtered to the active niche in the shared hook.

The Value tab is already numbered **08** in the main 16-screen sequence. QA IDs are aligned as **TF-A Style**, **TF-B Sell**, **TF-C Insights**, **TF-D eBay Seller Hub**, and **TF-E Repricing**.

## Supplemental shared routes in the extended QA sweep

- Account & workspace: `app/(tabs)/account.tsx`
- Listing editor: `app/ebay-listing-editor.tsx`
- Inventory item detail: `app/stock-listing/[id].tsx`

These routes are not substitutes for any of the 16 numbered screens. They must be checked in the extended runtime sweep because the main Threads Flip flows link into them.

## Implementation guardrails

1. Do not fork inventory, listing, eBay, order, authentication or AI services for clothing. Reuse existing shared hooks/services.
2. Apply clothing styling at the screen/presentation layer only. Other niches must remain visually and functionally unchanged.
3. Treat screen IDs as QA identifiers. Every route/state in this map must have a real runtime capture named `01_...` through `16_...`; the five additional specialist tabs use `TF-A_...` through `TF-E_...`.
4. A generated concept image is a visual reference, not proof of a working screen. Capture the actual running app after implementation and compare each screen against its matching reference.
5. Do not mark a screen complete until its route works, data is correctly niche-scoped, primary actions work, and its real screenshot has been reviewed.
6. No APK build until the full page set and regression checks are complete.

## Asset checklist

- Threads Flip wordmark / app icon treatment (existing brand asset retained).
- Editorial hero apparel photography.
- Vintage garment, designer garment, streetwear, trainers and accessories category imagery.
- Brand-label, care-label, size-label and garment-detail photo examples.
- Neutral garment thumbnails for empty/demo states (never imply demo prices are real market evidence).
- Consistent 3:4 garment imagery and square category tiles; avoid embedded brand logos unless licensed.

## Known issue found during code inspection

The Threads Flip home metric counted only `specialist_id = 'clothing'`, while the clothing module declares both `clothing` and `trainers_sneakers`. The count query has been corrected on this branch to include both IDs. The shared inventory hook already resolves the production specialist IDs. The Orders screen and eBay Hub were also using `activeNicheId` directly; they now respect `fixedNicheId` first so niche APKs remain correctly scoped. Repricing stale-listing results and linked rules are filtered to the active niche in the shared hook.
