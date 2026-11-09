# eBay publishing: advice instead of arbitrary certainty gates

## Observed failure
The supplied screenshot and backend log at 2026-11-09 05:50:47 show HTTP 422 `COIN_CONFIDENCE_BELOW_THRESHOLD`. This was SWISH's own 95% rule, not a returned eBay requirement.

## Changes
- Removed percentage and observation-only publication bans for registered specialists. Existing AI scores, state and evidence remain unchanged; they are not upgraded to verified or authenticated.
- Retained the separate Quick List review threshold. It does not authorize or prevent ordinary seller-reviewed publication.
- The draft editor shows confidence as advice, with the actual stored specialist follow-up questions or missing evidence when present. Users can review factual title/description, disclose uncertainty and continue without paying for another identification.
- Genuine field failures now include the exact server/eBay detail, requested field names, a clarification question and a direct action. The action opens/scrolls the relevant editor section, expands its controls, or opens account/policy settings. Supported condition choices and item-specific value lists come from current eBay metadata, never generated guesses.
- List now is not silently disabled by unavailable category metadata. Review listing requirements checks again or opens the missing category selection.
- Explicit pre-submission taxonomy/condition failures carry `notSubmitted: true`; these do not create an unconfirmed-publication lock. Ambiguous writes, network failures and pending claims still require status reconciliation, not another submission.
- Advisory quality verification no longer changes draft lifecycle to verified/needs_correction and cannot hide draft-only re-identification after a failed attempt.

## Preserved controls
Authentication, tenant/module entitlement, registered specialist ownership, physical manifest inspection, actual product safety restrictions, photo persistence and verification, required eBay category/condition/specifics, saved seller pricing and selected policies, atomic publish claims and no duplicate retry. No listing is published, ended or deleted by this development change.

## Verification status
Added pure client clarification regressions, server confidence tests, pre-dispatch service-failure and required-field propagation tests. Updated the existing shared revision CI workflow and canonical/server shared-asset parity checks. Execution of TypeScript, Jest, Deno and installed-device tests is not available in this editor session; no passing result is claimed.

## APK delivery
The server rule applies once the changed eBay Edge Function is deployed. The new editor guidance needs a compatible published OTA update downloaded/applied by the installed APK, or a replacement APK. Saving source is not proof of OTA publication or device delivery. Test the supplied draft on the installed Android build and check actual eBay acceptance; do not create a replacement inventory item.
