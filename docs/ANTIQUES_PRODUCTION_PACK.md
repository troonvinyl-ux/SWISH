# Antique Flipper — Production Pack

## Purpose

Deliver Antique Flipper as a specialist experience on the existing SWISH engine. The visual reference is the supplied 16-screen Antique Flipper board and its individual screen crops. The native implementation must use real components and live services; mockup images are references, never screen backgrounds.

## Architecture boundaries

- Product identity: `antiques` in `niche-modules.json`.
- Canonical specialist: `antiques`; legacy `books` remains mapped to the same product.
- Shared authentication, tenant, inventory, capture, identification, valuation, listing, eBay and order services remain authoritative.
- Inventory queries remain scoped through the production niche specialist allow-list.
- No new database, authentication provider, marketplace connector or duplicated intelligence engine.
- Antique Flipper visual accent: antique gold/brass on black/charcoal.

## Screen-by-screen implementation map

| # | Reference screen | Production route / component | Functionality |
|---|---|---|---|
| 1 | Splash | Existing native splash + `entry/antiques` | Branded app entry and existing auth gate |
| 2 | Sign in / Sign up | Existing `login` | Existing SWISH authentication |
| 3 | Home dashboard | `app/antique-flipper.tsx` | Bespoke gold dashboard, inventory counters, scan and specialist shortcuts |
| 4 | Scanner / Capture | `app/capture.tsx` via central Scan tab | Existing multi-angle photo capture, camera and gallery, evidence slots |
| 5 | AI Identification | `app/capture.tsx` + `useGenericCapture` | Existing shared identification pipeline and progress state |
| 6 | Identification Result | `SpecialistReview` in capture | Evidence review, editable title and specialist follow-up answers |
| 7 | Condition Assessment | Specialist follow-up in capture and saved item condition fields | Damage, repairs, wear and uncertainty captured as evidence; no visual-only authentication |
| 8 | Market Value | `FlipIntelligencePanel` in capture and existing item valuation flow | Shared valuation service; sold evidence distinguished from asking prices |
| 9 | Add to Inventory | Existing capture save action | Persists identified item through shared item service under antique specialist |
| 10 | Inventory | `app/(tabs)/inventory.tsx` | Existing niche-filtered stock, draft, live and sold lifecycle |
| 11 | Create eBay Listing | `app/create-listing.tsx?id=<item-id>` | Existing shared listing generation flow |
| 12 | Category & Item Specifics | Create Listing category/specifics stages | Live eBay category and item-specific retrieval and validation |
| 13 | Review Listing | Create Listing review stage | Review and save draft / submit through existing lifecycle |
| 14 | Listings | Inventory lifecycle tabs and existing eBay hub | Niche-scoped listing status and eBay management |
| 15 | Sold Items & Orders | Inventory sold tab + existing `orders` | Existing sold item and order records |
| 16 | More / Settings | `app/(tabs)/antique-more.tsx` | Antique settings, eBay connection, price decay, guides and owner diagnostics |

The create-listing stages and capture/identification stages are intentionally implemented using the existing shared workflows rather than duplicating them into separate one-off screens.

## Specialist intelligence

The Antique Flipper specialist must prioritise:
- Furniture and decorative furniture.
- Ceramics, porcelain, pottery and glassware.
- Silverware, metalware and hallmarks.
- Clocks, watches and jewellery.
- Paintings, prints, sculpture and lighting.
- Books, printed material, vintage objects and collectables.

Capture guidance requests a main view, reverse, underside/construction, marks/hallmarks, damage, detail and scale/dimensions.

Identification must separate observations from attribution. Maker, age, provenance, originality, metal content and authenticity must not be asserted without evidence. Candidate matches and confidence must remain explicit.

Condition guidance records location-specific chips, cracks, hairlines, crazing, corrosion, losses, wear, overpainting, replacement parts, repairs and missing components. No aggressive or irreversible restoration instructions are generated from images alone.

Valuation uses the existing shared market value Edge Function. Completed-sale evidence, current asking prices, auction estimates and AI inference must remain separately labelled. Comparables must match type, maker/attribution, pattern, dimensions, condition, restoration and completeness where evidence permits.

## Visual acceptance

- Black/charcoal screen surfaces.
- Antique gold/brass accents and borders.
- Gold primary actions with dark text.
- Premium antique imagery and elegant serif brand treatment.
- Modern, legible sans-serif body text.
- Five-tab flow: Home, Inventory, Scan, Listings, More.
- Central Scan action remains the single-tap capture entry.
- No other niche branding is shown inside the Antique Flipper experience.

## Production gates

1. **Defined** — screen map and specialist contract recorded.
2. **Implemented** — routes, specialist prompts and shared workflow integration complete.
3. **Typechecked** — repository TypeScript check passes.
4. **Regression verified** — existing shared and niche isolation tests pass.
5. **Android build verified** — isolated Antique Flipper APK builds and passes route/package inspection.
6. **Device acceptance** — sign-in, capture, identification, save, inventory, draft, item specifics, listing lifecycle and sold/order views tested on a real device.
7. **Production certified** — only after real eBay and device tests succeed.

## Current implementation notes

This pack adds the bespoke Antique Flipper home and More experience, dedicated guides and restoration pages, gold niche styling, an explicit five-tab More entry for Antique Flipper, and expanded antique specialist capture/intelligence guidance. The existing shared capture, identification, valuation, inventory, listing and order services are reused.

The release is not production-certified until GitHub checks, the isolated APK build, and real-device acceptance have passed. No real eBay listing is published by these code changes.
