# Shared niche home template — all 11 supplied header assets

## Uploaded headers

All eleven supplied images are stored locally and bundled for offline display. They are separate from existing logo, launcher and master-card artwork.

| Upload | Canonical niche | Header asset |
| --- | --- | --- |
| IMG_9726.jpeg | tech | assets/images/headers/tech.jpeg |
| IMG_9727.jpeg | bicycles | assets/images/headers/bicycles.jpeg |
| IMG_9728.jpeg | motocross | assets/images/headers/motocross.jpeg |
| IMG_9729.jpeg | beauty | assets/images/headers/beauty.jpeg |
| IMG_9730.jpeg | trading_cards | assets/images/headers/trading-cards.jpeg |
| IMG_9731.jpeg | antiques | assets/images/headers/antiques.jpeg |
| IMG_9732.jpeg | surplus_flip | assets/images/headers/surplus.jpeg |
| IMG_9733.jpeg | clothing | assets/images/headers/clothing.jpeg |
| IMG_9734.jpeg | fossils | assets/images/headers/fossils.jpeg |
| IMG_9735.jpeg | collectibles | assets/images/headers/collectibles.jpeg |
| IMG_9736.jpeg | coins | assets/images/headers/coins.jpeg |

Approved source dimensions: 1920 × 1120 pixels, 12:7 landscape. Text is rendered separately, never baked into the image. Expo Image displays local sources directly, with a readability gradient and responsive header height.

All eleven supplied headers are mapped in constants/nicheHeaderArtwork.ts. No substitute images were generated and original brand assets were not overwritten. Command portfolio tiles use the same mapping, centre positioning, 12:7 aspect ratio, caching and a readability gradient.

## Shared design and preserved variations

Product soul: specialist resellers use a private niche workspace to identify, review, value and sell their stock with confidence, focus and clarity.

Material: dark, layered translucent Glass panels for the command experience; original niche workflows remain intact. Signatures: image-led bordered header, accent-coloured Inventory / Live / Sold metrics, and large two-column action cards (three columns on desktop). Context hooks: niche photography, explicit product categories and specialist checks.

All eleven home tabs now use `SharedNicheDashboard`, based on the Collectibles layout. `ModuleHome`, `CollectiblesDashboard` and `NicheOverview` are compatible adapters. The unified application selects the same component rather than replacing it with a legacy dashboard. Legacy per-niche build scripts remain historical tooling and are not a request to produce separate APKs.

Niche colours, names, scanner routes and terminology remain canonical. Core cards use the existing inventory, editor, valuation and eBay services. Additional cards preserve specialist workspace, card grading, antique condition/value/guides/care, MX acquisition, manifests and original specialist dashboards. Legacy specialist pages were not edited or deleted.

Saved-item operations use an explicit picker instead of silently choosing the first item. Routes are filtered for the current module and installed-build allowlist. Existing auth, tenant checks, entitlements, storage and backend policies are unchanged. The home reuses `useInventory` and adds no background polling or AI/API requests.

## Verification status

- Assets downloaded into the repository successfully.
- Source and pure regression coverage added in `services/__tests__/sharedNicheHomeHeaders.test.ts`.
- No test runner, installed-device access or release tools are available in this session: runtime, APK, orientation and image-cropping acceptance remain unverified.
- Suggested repository command: `npx jest --config jest.config.ci.js --runInBand services/__tests__/sharedNicheHomeHeaders.test.ts`.
- Existing APKs need their normal compatible OTA or new build delivery; repository changes alone do not prove installed apps have updated.
