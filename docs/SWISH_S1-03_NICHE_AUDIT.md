# SWISH S1-03 — Registered niche audit

**Audit date:** 2026-11-02  
**Source of truth:** `niche-modules.json`  
**Scope:** all ten registered production niches, entry points, scanner routes, specialist ownership, package identity and descriptor coverage.

## Findings

| Niche | Android package | Entry file | Scanner route | Entry/route evidence |
|---|---|---|---|---|
| Coin Flipper | `com.swish.coinflipper` | `app/entry/coins.tsx` | `/coin-flipper?tab=capture` | Entry and dedicated scanner screen exist |
| Flipper MX | `com.swish.flippermx` | `app/entry/motocross.tsx` | `/flipper-mx` | Entry and dedicated scanner screen exist |
| Bike Flipper | `com.swish.bikeflipper` | `app/entry/bicycles.tsx` | `/bike-flipper` | Entry and dedicated scanner screen exist |
| Threads Flip | `com.swish.threadsflip` | `app/entry/clothing.tsx` | `/threads-flip?tab=identify` | Entry and dedicated scanner screen exist |
| Card Flipper | `com.swish.cardflipper` | `app/entry/cards.tsx` | `/capture` | Entry exists; shared capture screen is used |
| Antique Flipper | `com.swish.antiqueflipper` | `app/entry/antiques.tsx` | `/antique-capture` | Entry and dedicated antique capture screen exist |
| Fossil Flipper | `com.swish.fossilflipper` | `app/entry/fossils.tsx` | `/capture` | Entry exists; shared capture screen is used |
| Beauty Flipper | `com.swish.beautyflipper` | `app/entry/beauty.tsx` | `/capture` | Entry exists; shared capture screen is used |
| Tech Flipper | `com.swish.techflipper` | `app/entry/tech.tsx` | `/capture` | Entry exists; shared capture screen is used |
| Surplus Flip | `com.swish.surplusflip` | `app/entry/surplus-flip.tsx` | `/surplus-flip` | Entry and dedicated surplus screen exist |

All ten package IDs are distinct. All ten registered entry files exist. Scanner route targets resolve to an existing dedicated route or the shared `app/capture.tsx` route. Specialist ownership is defined centrally by `specialists` and `legacySpecialists` in the canonical registry; aliases are not separate tenant products.

## Gaps and release risks

1. **Only two niche descriptor files exist:** `niches/coins/module.json` and `niches/clothing/module.json`. The other eight registered niches do not yet have a descriptor under `niches/<id>/module.json`.
2. Those two descriptors still say `migration-started-not-yet-bundle-isolated`. This is consistent with the architecture: the products are branded entry/configuration layers over a shared SWISH engine, not independently extracted code bundles.
3. Card, Fossil, Beauty and Tech intentionally point to the shared capture route and currently have no dedicated home screen or dedicated route list in the registry. Their specialist-specific workflow depth and visual acceptance therefore remain open; route existence alone is not evidence of finished niche UX.
4. Static registry ownership and route tests do not prove database isolation. Tenant/niche RLS and server-side authorization still require live integration evidence for every niche.
5. Specialist aliases must always resolve to one canonical product owner. In particular, the legacy `books` alias is assigned to Antique Flipper; it must not become a second product or cross-niche inventory path.

## Acceptance evidence and remaining work

- Static registry/entry/package/specialist/route integrity is covered by `services/__tests__/registeredNicheAudit.test.ts`.
- The canonical registry remains the sole source of package, entry, specialist and scanner-route metadata.
- Remaining production acceptance: create/maintain descriptors for all ten niches, complete specialist-specific UX for shared-capture niches, and execute live RLS/tenant-isolation tests with representative subscriber accounts.

**S1-03 result: IMPLEMENTED — audit and regression guard added; identified isolation/UX gaps remain explicit and are not marked verified.**
