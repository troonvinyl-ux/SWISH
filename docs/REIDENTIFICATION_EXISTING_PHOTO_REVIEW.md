# Existing-photo re-identification: actionable advisory review

## Reported issue
The shared item overview's Re-Identify modal stopped on an advisory low-light warning for Stored photo 4, but directed the user to a different screen and provided no way to acknowledge the warning in the current modal. This was a local pixel-preflight block, not an eBay publication or storage failure.

## Repair
- Identification returns structured photo-quality warnings separately from network/provider, quota and payload errors. Existing service callers still receive the original error contract.
- The shared Re-Identify modal displays the original photos it will use, labels flagged photos consistently, and allows full-screen inspection.
- A warning card explains dark/plain-subject false positives and provides **Continue with these photos**. Only an explicit press grants an advisory override, then requests re-identification or resumes refinement as appropriate.
- Approval is tied to the account/item, modal session and exact selected photos/order. Changing photos, disabling stored photos, closing the modal or changing item/workspace invalidates approval.
- Duplicate identification presses are locked. Results from a closed or changed evidence session cannot populate a newly opened modal.
- No photos are removed/replaced, no inventory item is created, no identity is automatically confirmed and no marketplace changes are sent by warning acknowledgement. Existing result-review/save flows remain in place.
- The shared item overview serves every niche; no niche-specific bypass or duplicate scanner was introduced. The bulk workflow is outside this change.

## Regression coverage
- `services/__tests__/reidentificationPhotoReview.test.ts`: warning-to-original alignment, advisory unavailable checks, evidence-scope/selection changes and shared UI wiring.
- `services/__tests__/reidentificationPhotoWarningFlow.test.ts`: preflight blocks before AI; explicit override invokes the existing service once; network errors do not become photo warnings; photo limits remain enforced.

These tests were added but not executed in this editor session (no command runner is available). No native/device acceptance is claimed.

## Device retest
1. Open the reported saved teddy bear; select Re-Identify with existing photos.
2. Run Re-ID; inspect Stored photo 4 in the new warning card, then close the photo viewer.
3. Choose Continue with these photos: expect a new AI analysis, then a proposal for user review, not a dead-end warning or automatic save.
4. Change the selected evidence: warning approval must reset. Close/reopen: approval must reset and stale results must not appear.
5. Repeat with newly added photos and refinement, then verify existing inventory photo URLs and live eBay photos are unchanged until the relevant explicit save/revise flow.
6. Exercise failed requests, eight-photo limits and rapid duplicate taps on installed iOS and Android builds.
