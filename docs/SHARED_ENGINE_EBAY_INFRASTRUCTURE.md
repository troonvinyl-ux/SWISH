# Shared SWISH engine and eBay infrastructure: deployment and verification gate

This document records the current authoritative shared infrastructure and the checks required before the five niche-completion stages can rely on it.

## Authoritative implementation map

- Mobile/main app and backend source: `troonvinyl-ux/SWISH`.
- Shared credential cryptography: `supabase/functions/_shared/credentialCrypto.ts`.
- Shared eBay OAuth: `supabase/functions/swish-ebay-oauth`.
- eBay listing operations: `swish-ebay-list`; seller listing/import operations: `swish-ebay-browse`; listing sync: `swish-ebay-sync`.
- Orders and fulfilment: `swish-ebay-orders`, `swish-ebay-post-order`.
- Seller messages: `swish-ebay-messages`.
- Seller finance: `swish-ebay-finances` and `_shared/ebayDigitalSignature.ts`.
- Image download: `swish-image-download`.
- eBay-backed valuation: `swish-market-value`.
- Safe client-side connector metadata: `services/marketplaceService.ts` (credential fields must remain excluded).
- Web client: `troonvinyl-ux/SwishWeb`, which must use existing Supabase/Edge Function contracts rather than a competing backend.

Five niche routes are registered in the main app: Coins, Motocross, Bicycles, Clothing, and Surplus Flip. Common eBay operations remain in the shared server functions; niche-specific identification and valuation belongs in specialist functions/configurations.

## Credential migration and rollout

The authoritative credential policy is fail-closed: ordinary calls to `decryptCredentials()` reject plaintext and malformed values. Legacy plaintext parsing belongs only to `migrateToEncrypted()` in the owner-authorised `swish-migrate-credentials` Edge Function. Do not introduce a runtime plaintext compatibility toggle or competing credential policy.

- `SWISH_CREDENTIAL_KEY` remains a server-only secret, a random 32-byte value encoded consistently as hex or base64.
- The migration endpoint is invoked one tenant at a time by an authenticated owner/admin. It returns counts and row-safe errors, never credential material.
- Before deployment, confirm the server secret exists and every tenant's connector rows have been migrated. The owner must verify counts and connection health; source-only checks cannot prove production rows are encrypted.

## eBay requirements

- Always submit with Simple Delivery by default as specified by the product requirement.
- UK/EU Finances API access depends on the server-only eBay digital-signature key pair: `EBAY_SIGNATURE_PRIVATE_KEY` and matching `EBAY_SIGNATURE_KEY_JWE`.
- Do not report live finance integration as working until secrets are configured and a real controlled funds-summary request succeeds.
- eBay customer tokens and listing/order data remain tenant-owned. All privileged access must be made through authenticated server functions with tenant membership checks.

## CI and evidence

GitHub Actions can validate code and fixtures, but it cannot by itself prove deployed secrets, whether production connector rows are encrypted, or that a live seller account can successfully access eBay. Record unit/mocked, build, sandbox, and live results separately. Do not claim a skipped external test passed.

## Known work requiring continued implementation and verification

- Review and align duplicate token-refresh implementations across the listed eBay Edge Functions, with particular care around concurrent refreshes and credential-row overwrites.
- Confirm all database/RLS policies for `marketplace_connectors`, OAuth sessions, listings, orders, messages, finance, images, and niche-scoped records.
- Verify mobile and web use the same Edge Function input/response/error contracts and all five niche routes select the correct specialist.
- Run the complete regression suite and relevant app/web builds on the final revision.
- Verify deployment secret configuration and run tenant-by-tenant migration in the deployed environment; these actions cannot be completed through repository-only changes.


## Web contract audit (repository observation)

The web client is `troonvinyl-ux/SwishWeb`; its `src/lib/supabase.ts` centralises Supabase client creation and an Edge Function invocation wrapper. Current web pages use the shared function names for important eBay flows, including:
- `EbayHub.tsx`: `swish-ebay-oauth` and `swish-ebay-sync`.
- `EbayFinances.tsx`: `swish-ebay-finances`.
- `EbayMessages.tsx`: `swish-ebay-messages`.
- `EbayReturns.tsx`: `swish-ebay-post-order`.
- `ListingEditor.tsx` / `ListingNew.tsx`: `swish-ebay-list`.

This confirms reuse of the current shared function names, but not full response/error-contract parity for every route. The web parity document itself warns that some web pages rely on earlier table/function names. A caller-by-caller contract comparison and safe web build remain explicit release gates.
