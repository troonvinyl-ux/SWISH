# Shared item overview and main-image selection

## Changes

- The canonical `app/stock-listing/[id].tsx` overview is shared by all eleven registered niches and the legacy item route.
- A bounded, responsive photo card replaces the doubly negative-margined gallery. Thumbnail selection is separate from saved main-image selection. Swipe, pinch/double-tap zoom, full-screen viewing, photo saving and sharing remain available.
- A single primary footer action replaces the overflowing action row; secondary actions are accessible through a labelled More sheet. Existing live-action confirmations remain in place.
- Marketplace title/description come from the saved listing rather than silently displaying inventory copy as marketplace copy. Listing price, suggested price, estimated market value and acquisition cost remain distinct.
- Niche name, accent, icon, condition terminology and capture guidance come from the existing niche registry. Folder/pocket fields appear only for coins/cards. Bespoke specialist fields and MX grading remain. Read-only legacy fields no longer show inactive edit buttons.
- The shared listing editor also has a clearly marked first photo and explicit Set main buttons for every niche; selection is limited to 12 photos.

## Persistence and isolation

`selectMainItemImage` reorders the existing `items.media` array, putting the chosen attached image first while retaining all other photos and their relative order. Inventory thumbnails already use this first URL. The existing AppProvider inventory reload signal refreshes other mounted inventory views; revisiting inventory uses the canonical database records.

Reads/writes use the existing client and tenant/niche filters, with RLS unchanged. A fresh row read checks the displayed photo array. The write is constrained by `updated_at` to avoid overwriting a concurrent upload/editor change and verifies the returned photo order. There is no automatic mutation replay.

If an existing `attributes.ebay_listing_media` selection is present, the overview places the selected cover first in that listing selection too, preserves its other selected photos and attributes, and checks the 12-photo limit. This does not publish or revise anything on eBay. The existing explicit revise flow sends saved listing photos. The editor can independently order a listing's selected photos without removing original inventory images.

No new database, table, authentication method, RLS change, eBay credential change, AI provider or edge function was introduced. The only live database operation during this implementation was a read-only schema check confirming the existing media array and scope/version columns; no production item was changed by the development tools.

## Verification status

Source review completed for the gallery, version-constrained media write, inventory thumbnail consumers, listing subset storage and eBay photo selection paths. Added mocked tests in `services/__tests__/itemMainImage.test.ts` covering every registered niche, stable reorder, rejection of unowned/stale photos, version conflicts, unchanged-cover no-op and retention of listing subset/attributes. Added source-contract checks for shared UI wiring.

TypeScript, Jest, installed-device gestures and authenticated save/reload/eBay revision tests have **not been executed** in this tool-only session: no shell/test runner or device automation is available. No merge, APK/IPA build or live eBay deployment claim is made.

Device acceptance: choose a non-first photo, set it as main, revisit inventory and reopen the item; confirm cover/first position and no missing originals. Reopen the listing editor, verify its marked main photo, save and confirm a revision only when desired. Repeat in the authorised niches on narrow portrait, landscape and tablet layouts. Confirm upload/editor conflicts surface an error without overwriting newer changes.
