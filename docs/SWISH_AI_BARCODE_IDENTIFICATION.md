# AI-first barcode identification

## Implemented
- A decoded or manually entered barcode now asks OnSpace AI directly through the existing authenticated `barcode_lookup` route. It no longer waits for an eBay catalogue hit or requires an eBay seller connection for discovery.
- Uses `google/gemini-3-flash-preview` with web grounding requested through the compatible web plugin. Secrets remain server-side; no model switch, new key or client credential is introduced.
- A supported result shows the product name, platform/publisher/edition details when supplied, its AI-research provenance and an explicitly opened source link. It carries forward as a contextual lead into the existing photo-identification workflow.
- Photos → Next → List now / Save for later is unchanged. A barcode response never creates inventory or publishes a listing.

## Evidence and safety
- Full barcode/checksum validation runs before AI. Wrong returned codes, ambiguous results, low-confidence proposals and unsupported citation URLs are not accepted as matches.
- Matching sources must be present in provider-returned citations and the model's source excerpt must contain the barcode and identifying title. If the provider supplies an extract, that extract must corroborate both as well. If source extracts are unavailable, the quotation remains an AI claim, not independently verified catalogue evidence; all results are explicitly suggestions.
- Source links are HTTPS-only and are never fetched by the handler. Model-written source URLs without provider citations cannot establish a match.
- GS1 registration prefixes do not establish manufacturing origin, product region, edition or language. The prompt forbids that inference, and manufacturing-origin fields are excluded from barcode specifics.
- No seller photos, physical condition, completeness, authenticity, marketplace category IDs or prices are copied from AI barcode research. Marketplace category and valuation continue through the existing services.
- Photo title/platform/variant agreement is required before treating an AI lead as corroborated. Unseen AI-specific details are not copied into confirmed listing fields. Conflicts block corroboration.
- Module/tenant/entitlement checks remain ahead of the AI call. Session and barcode-request serial checks discard late results. No automatic paid retry is introduced.

## Verification status
- Added mocked client/physical-evidence tests and injected Deno provider tests, including the user-supplied `5024866335279` example as a fixture, not a hard-coded production answer.
- CI now includes both AI and existing eBay barcode-contract tests.
- Compilation, CI execution, deployed web-grounding support and native-device end-to-end testing were not run from this editing session. Retest the example and an unknown barcode on the installed app; check that the cited source supports the returned product, and that photo and draft/publication behavior remains unchanged.
