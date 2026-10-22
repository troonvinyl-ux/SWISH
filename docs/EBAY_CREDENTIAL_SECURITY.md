# eBay credential security deployment checklist

SWISH's Edge Functions encrypt connector credentials in `marketplace_connectors.credential_ref` using AES-256-GCM. Encryption is only secure if the key is configured in the server runtime and every legacy connector row has been migrated.

## Required server configuration

1. Generate a fresh random 32-byte key in a trusted local environment, for example with `openssl rand -base64 32`.
2. Add it to the **server/Edge Function secret store** used by the deployed SWISH backend as `SWISH_CREDENTIAL_KEY`.
3. Do not place the key in app configuration, client-side environment variables, source control, logs, or an API response. Do not send it to the mobile/web client.
4. Deploy the updated `credentialCrypto.ts`, `swish-migrate-credentials`, OAuth, order, finance, messages, sync, listing, browse, and image-download functions together so all credential consumers use the same key.

## UK/EU seller-finance digital signatures

eBay requires digital signatures for all Finances API calls made for UK/EU-domiciled sellers. SWISH's Finances Edge Function now signs its GET requests using the eBay-generated Ed25519 keypair. To enable live available-funds and transaction data:

1. Use eBay's Key Management API to create a signing key for the same eBay application keyset.
2. Store the returned private key as the server-only secret `EBAY_SIGNATURE_PRIVATE_KEY` (PKCS#8 PEM).
3. Store the matching `publicKeyJwe` value as the server-only secret `EBAY_SIGNATURE_KEY_JWE`.
4. Keep both values out of client configuration, source control, logs, and API responses.
5. Deploy the shared `ebayDigitalSignature.ts` helper and the updated `swish-ebay-finances` function, then test a real funds-summary call with the connected UK seller account.

Without these two server secrets, the function intentionally fails rather than making unsigned Finances API calls that eBay will reject.

## Migrate existing credentials

1. Sign in as the owner/admin of the relevant SWISH tenant.
2. Open Settings and run **Credential Encryption Migration** for that tenant.
3. Confirm the result reports `failed: 0` and that every connector row is either migrated or already encrypted.
4. Reconnect eBay if any credential cannot be decrypted. Never paste tokens or secrets into support messages.
5. Test OAuth reconnect, token refresh, listing updates, order sync, messages, finance sync, and dispatch before treating the migration as complete.

The migration endpoint intentionally requires a single tenant ID and does not permit a tenant admin to migrate other tenants' credentials.

## Release gate

The source currently retains a legacy plaintext-read fallback to avoid abruptly breaking an unmigrated existing connection. That fallback must only be removed after the deployed migration has completed successfully for all existing connector rows and the deployed backend has been verified. A successful web build alone does not prove that the server secret exists or that stored rows are encrypted.
