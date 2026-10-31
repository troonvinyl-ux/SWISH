# Threads Flip — numbered screen implementation map

**Branch:** `feat/threads-flip-numbered-screen-parity`  
**Visual identity:** `#0C080C` ink, `#160E16` surface, `#E91E8C` hot pink, `#FF3DAA` highlight, `#FFF0F5` cream. Keep the existing Threads Flip palette; do not substitute SWISH yellow.  
**Rule:** the numbers below are stable screen IDs. Shared SWISH pages keep their shared data/actions; Threads Flip applies a presentation skin only when the active production niche is `clothing`.

## 16-screen parity checklist

The reference is the **pink-and-black Threads Flip Neon Resale App Showcase**. Screen numbers below match the labels on that reference exactly; the separate sign-in form is an authentication state, not a numbered product screen.

| ID | Reference screen | Route / state | Required visual and functional treatment |
|---|---|---|---|
| 01 | Splash / Welcome | `app/login.tsx` welcome state | SWISHFLIP mark, garment-led Threads Flip hero artwork, clothing reseller tagline, category icons, Get Started and Sign In actions |
| 02 | Home Dashboard | `HomeTab` in `app/threads-flip.tsx` | Clothing assistant hero, wardrobe metrics, 2×3 tool grid, category strip, Pro banner, four-item bottom navigation |
| 03 | Scan / Capture | `IdentifyTab` capture state | Camera/library capture with four dedicated slots: Front, Back, Label, Detail; clear capture guidance |
| 04 | Photo Checklist | `IdentifyTab` reviewingPhotos state | Four thumbnail rows, captured checks, retake actions, Continue to identification |
| 05 | AI Identification | `IdentifyTab` identifying state | Branded scan/progress treatment and visible AI stages for photos, brand, label, category and specifics |
| 06 | Item Identified | `IdentifyTab` idResult state | Garment title, image strip, brand/category/department/style/material/size, confidence and Continue |
| 07 | Condition & Auth | `IdentifyTab` condition panel | Condition grade, authenticity risk, flaws and evidence notes |
| 08 | Market Value | `ValueTab` in `app/threads-flip.tsx` | Clearly labelled illustrative sample until live sold evidence is available; value range, comps, costs and profit |
| 09 | Save to Inventory | `IdentifyTab` savedItemId state | Item photo, title, category/size tags, estimated value, save confirmation and upload progress |
| 10 | My Wardrobe | `/(tabs)/inventory` | Clothing-only stock/draft/live/sold data, search, filters, garment thumbnails and pink active states |
| 11 | Create Listing | `app/create-listing.tsx` | eBay listing workflow using saved garment details/photos, title and description generation |
| 12 | Category & Specifics | `app/create-listing.tsx` category/item-specific stage | Clothing category and required eBay aspects such as Department, Style, Outer Shell Material, Brand, Size and Colour |
| 13 | Listing Review | `app/create-listing.tsx` review stage | Garment gallery, final title, price, postage, draft status, Edit and Publish actions |
| 14 | My Listings | `/ebay-admin` | Clothing-only listing status tabs, thumbnail-led rows, selection and publish actions |
| 15 | Sold Items & Orders | `app/orders.tsx` | Clothing order thumbnails, order reference, sale amount, fulfilment status and order tabs |
| 16 | Settings / More | `app/settings.tsx` | eBay connection, AI & identification, pricing rules, listing templates, preferences, support and About |

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

- [x] Existing Threads Flip brand artwork is used on the screen 01 welcome splash.
- [ ] Add separate editorial apparel photography for the screen 02 home hero and category tiles (vintage, designer, streetwear, trainers and accessories).
- [ ] Add clear brand-label, care-label, size-label and garment-detail photo examples for the capture guidance.
- [ ] Add neutral garment thumbnails for empty/demo states; never imply demo prices are real market evidence.
- [ ] Standardise 3:4 garment imagery and square category tiles; avoid embedded brand logos unless licensed.

The capture flow now has four functional photo slots and a separate checklist screen. The additional product/category photography remains a pre-merge visual asset task.

## Known issue found during code inspection

The Threads Flip home metric counted only `specialist_id = 'clothing'`, while the clothing module declares both `clothing` and `trainers_sneakers`. The count query has been corrected on this branch to include both IDs. The shared inventory hook already resolves the production specialist IDs. The Orders screen and eBay Hub were also using `activeNicheId` directly; they now respect `fixedNicheId` first so niche APKs remain correctly scoped. Repricing stale-listing results and linked rules are filtered to the active niche in the shared hook.


## Repricing isolation regression check

The shared repricing service must receive the effective niche ID for every read and write. The UI hook uses `fixedNicheId ?? activeNicheId`, and the service fails closed for an unknown niche, filters stale listings by the production specialist IDs at query time, and verifies listing ownership before generating an AI suggestion or applying a price change. Do not replace this with client-side filtering alone.

## Authentication branding

The shared login route remains shared across all niches. Threads Flip branding is conditional on the effective niche being `clothing`; all other niche builds retain the SWISH mark and Commerce Intelligence Platform tagline.
