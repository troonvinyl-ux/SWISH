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

The shared credential helper now supports a controlled fail-closed switch:

- Default compatibility mode: legacy plaintext JSON can still be read during migration, with a structural warning only. Never log the stored value or fields.
- Strict mode: set the Edge Function secret `SWISH_REJECT_PLAINTEXT_CREDENTIALS=true`. In this mode, plaintext values are rejected. Do not enable before all existing tenant connector rows have been migrated and checked.
- The key remains a server-only secret named `SWISH_CREDENTIAL_KEY`; use one supported random 32-byte key encoding (hex or base64) consistently across all credential-consuming functions.
- The migration endpoint is `swish-migrate-credentials`, invoked per tenant by an authenticated owner/admin. It reports counts and row-safe errors without returning credential material.

Deployment checklist:
1. Confirm `SWISH_CREDENTIAL_KEY` exists in the deployed Edge Function secret store; never paste it into GitHub or chat.
2. Deploy the shared crypto helper and every Edge Function that imports it as one coordinated release.
3. Run the credential migration from Settings for every tenant with an eBay connector.
4. Verify `failed = 0` and `migrated + alreadyEncrypted = totalRows` for each tenant. The function's summary does not inspect database values after write, so an owner must also verify the migration output/connector health without exposing credential contents.
5. Test connection status, OAuth reconnect, token refresh, listing draft/update, images, sync, orders, messages, finance and dispatch against the approved controlled/live environment.
6. Only after all connector rows are confirmed encrypted, set `SWISH_REJECT_PLAINTEXT_CREDENTIALS=true` for all deployed functions and verify affected health checks.
7. Rotate any eBay app or signing credentials if there is evidence they were exposed. Do not rotate the encryption key blindly: encrypted existing records require a deliberate decrypt/re-encrypt migration.

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
