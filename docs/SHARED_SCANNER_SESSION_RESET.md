# Shared scanner session reset

## Reported issue
Collectibles reused the mounted scanner state and automatically restored a device capture draft. A previous saved inventory ID could freeze the viewfinder and carry its images, identification and review answers into the next physical-item scan.

## Changes
- Every scanner navigation entry starts an empty physical-item session across all niches, including the persistent Identify tab and full-screen scanner.
- No automatic `readCaptureDraft` hydration. Existing local draft APIs remain available for explicit recovery; they no longer populate a new scanner visit.
- Photos, result, saved ID, answers, mode, market comparison, warning acceptance, errors and progress reset together. The viewfinder resets its photo angle, flash, facing and grid, and remounts for the new session.
- A session token changes on focus, explicit New scan and user/tenant/niche/module-epoch changes. Blur invalidates pending callbacks synchronously. Late photo, enhancement, identification and save callbacks cannot update a subsequent scan or unlock its current operation.
- A newly saved ID remains available during the same scanner visit for photo/valuation retry and opening the saved item. It is not carried into another visit.
- An already-started save remains bound to its original tenant/item and completes photo linkage where possible without inserting that identity into the new scanner. Inventory records are not cleared or deleted.
- Collectibles uses the same scanner overview, evidence progress and upper New scan control as the other niches. Confirmed music metadata is usable within the current visit; scanner cleanup clears that visit's catalogue selection. Deliberate catalogue-only continuation still opens its existing inventory item rather than creating a duplicate.

## Verification
Added Node-only session lifecycle, all-niche empty-state, stale-completion and source-wiring regressions in `services/__tests__/scannerSession.test.ts`. Updated music capture assertions to distinguish same-visit recovery from automatic scanner hydration. Tests were not executed in this editing environment; installed-device camera/navigation acceptance remains unverified.

Device checks: identify/save a collectible, switch to Inventory, return to Identify and confirm an empty scan and live camera; repeat before saving and during AI processing; repeat across niche changes and after New scan; confirm same-visit partial-save retry still uses the existing item ID. Repeat with music catalogue confirmation and original-photo capture.
