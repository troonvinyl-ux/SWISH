# eBay credential security deployment checklist

The shared credential helper now fails closed: normal eBay operations reject plaintext `marketplace_connectors.credential_ref` values. Legacy plaintext parsing is confined to the owner-authorised `swish-migrate-credentials` Edge Function path.

## Mandatory rollout order — do not skip

**Do not deploy the fail-closed code until every existing connector credential has been migrated and verified.** Deploying it while plaintext rows remain will intentionally make those connections unavailable until they are migrated. Do not merge/deploy this change as a substitute for the data migration.

1. Generate a fresh random 32-byte key in a trusted local environment, for example with `openssl rand -base64 32`.
2. Add it to the server/Edge Function secret store as `SWISH_CREDENTIAL_KEY`. Never place it in client configuration, source control, logs, or API responses.
3. Deploy/configure the current migration-capable backend with the key before migrating data.
4. For every tenant with marketplace connections, run **Credential Encryption Migration** as that tenant's owner/admin. Migrate one tenant at a time.
5. Confirm each migration response reports `failed: 0`. Independently verify all non-empty connector credential references are encrypted (the `enc:v1:` prefix); do not log or export credential values.
6. Repeat for every tenant. Do not infer global completion from a single tenant's successful response.
7. Only then deploy the fail-closed credential utility and all functions that read or write credentials together.
8. After deployment, test OAuth reconnect, token refresh, listing updates, order sync, messages, finance sync, image download, and dispatch in the approved environment.

If any row cannot be decrypted or migrated, stop the rollout for that tenant, reconnect the affected eBay account if required, and rerun verification. Never paste tokens or secrets into support messages.

## Required server-side secrets

- `SWISH_CREDENTIAL_KEY`: base64- or hex-encoded random 32-byte key used by the credential utility.
- `EBAY_SIGNATURE_PRIVATE_KEY`: eBay-generated PKCS#8 PEM private key for UK/EU seller Finances API signing.
- `EBAY_SIGNATURE_KEY_JWE`: matching eBay `publicKeyJwe` value.

Keep all of these server-side only. The Finances API signing secrets must be created in eBay Key Management for the same application keyset and tested using a connected UK seller account. Without them, finance requests intentionally fail rather than making unsigned calls.

## Security and release gates

- Credential encryption/decryption runs only in Edge Functions.
- Client queries must use safe connector columns and must never select `credential_ref`.
- The migration function is tenant-scoped and requires an authenticated owner/admin.
- Normal credential reads must reject plaintext; only the explicit migration helper may parse legacy JSON.
- Test OAuth, token refresh, listing updates, order sync, messages, finance sync, image download, and dispatch after rollout.
- A successful build or mocked test does not prove server secrets are configured, all production rows are encrypted, or live eBay calls work.

## Outstanding production verification

Source changes cannot prove that the deployed secret exists or that every production connector row is encrypted. Record the migration counts and test outcomes for every tenant through the approved admin workflow. If the owner cannot verify all rows and server secrets, report credential security as blocked rather than complete.
