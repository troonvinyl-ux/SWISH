# Draft-only re-identification with additional evidence

## User flow
1. Open a draft from Inventory → Draft → Edit. The shared editor now shows **Re-identify · add photos & clues** outside Advanced options. Item overview provides the same entry for saved unpublished drafts.
2. Select up to eight original views in total, take additional photos or choose images from the library. Deselecting/removing a view here excludes it from this attempt; it never deletes saved photos.
3. Enter up to 2,000 characters of private clues: markings, inscriptions, measurements, suspected origins, provenance limitations or corrections. These are explicitly labelled seller hypotheses, not verified facts or buyer-facing copy.
4. Run the existing specialist identification endpoint. Original evidence is used, not a processed duplicate. Lighting warnings require explicit acknowledgement and cannot override access/payload/identity gates. Coins retain existing paid Numista behavior.
5. Review the suggestion, confidence, support, contradictions and missing information. You can add evidence and analyse again. Nothing is applied just because AI returned a result.
6. Apply the reviewed identification to the existing item. Optionally replace the selected draft's title (1–80 characters, editable, not silently truncated). The complete suggestion is stored privately. Description, price, category, specifics, condition and valuation remain unchanged and are flagged for review.
7. Alternatively save just added photos and clues without applying a new identification. Reopen Draft photos & main image to select added views for the seller listing. Valid processed photos remain preferred through the shared gallery policy; originals stay archived.

## Persistence and boundaries
- Services → hook → reusable modal; shared AppProvider reload signaling updates existing inventory views. No second item, duplicate draft, new route, AI provider or commerce pipeline.
- The existing photo persistence service prepares and uploads added views to the same item, merges immutable photo references and verifies canonical links. Partial failure keeps uploaded photos and allows retries to the same item; identification is not applied on upload failure.
- New `swish_apply_draft_reidentification` RPC is security invoker, authenticated-only, and checks the current module/entitlement/RLS. It locks the selected listing and parent item, verifies exact listing/item versions and rejects live, sold, ended, historically published and claimed/in-flight listings, including published siblings.
- Genuine human edits abort stale proposals. A photo-only version change can be retried with the fresh canonical version without replacing non-photo edits.
- Photos necessarily persist before the final atomic identification/title command. If publication/access changes during upload, the final command rejects identification; already saved photo references may remain. No automatic seller revision or publication occurs.
- AI result is a proposal, not factual certification. Stored clue metadata uses a private underscore-prefixed namespace excluded by existing seller-field filters. Existing safety checks remain in place.
- Unsaved editor edits must be saved explicitly before opening this tool. Closing with unsaved evidence requires discard confirmation. Busy actions are locked, and changed sessions/modules/unmount suppress late UI responses and stop subsequent writes.

## Actual validation and remaining acceptance
- RPC installed successfully; live schema ACL read shows security_definer=false, anon_execute=false, authenticated_execute=true.
- Actual authenticated-role/no-session RPC call was rejected; the negative probe rolled back and changed no user records.
- Added mocked regressions for clues transport, limits, published/sibling denials, stale sessions/versions, optional title behavior, photo retry, no inferred save success and source boundaries. Added CI workflow triggers/focused test invocation; test/build execution is pending because this editor has no shell or workflow-dispatch tool.
- No live AI request, seller mutation, photo upload or user record update was performed during implementation. Device acceptance remains required: antique fragment re-ID with inscription/underside photo, saved evidence reopen, failed-upload retry, draft-only denial, preserved price/copy, inventory refresh and confirmation that new images can be selected.
- Source edits do not update an installed APK by themselves. This JS/UI feature needs a compatible OTA publication/download/restart through the configured release pipeline; publication and installed-device checks have not been executed here.
