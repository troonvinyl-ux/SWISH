// SWISH — Credential Encryption Utility
//
// AES-256-GCM encryption for eBay credentials stored in marketplace_connectors.credential_ref.
// Encryption/decryption happens ONLY inside Edge Functions — never on the client.
//
// Key: SWISH_CREDENTIAL_KEY env var — base64-encoded 32-byte random value.
// Format: "enc:v1:<base64-iv>:<base64-ciphertext>"
//
// Migration path:
//   decryptCredentials() detects legacy plaintext JSON and transparently
//   returns the parsed object so existing connectors continue to work.
//   After a successful plaintext decode, the caller MUST re-encrypt via
//   encryptCredentials() and persist the encrypted value back to the DB.
//   Once all rows are migrated, legacy plaintext acceptance can be removed.
//
// SECURITY INVARIANTS:
//   - credential_ref is NEVER returned to the client (SELECT columns exclude it).
//   - Credential contents are NEVER logged — only structural metadata (length, format).
//   - tenant_id is always validated via membership check before credential access.

const ENC_PREFIX = 'enc:v1:';

/** Derive a CryptoKey from the SWISH_CREDENTIAL_KEY environment variable */
async function getKey(): Promise<CryptoKey> {
  const raw = Deno.env.get('SWISH_CREDENTIAL_KEY');
  if (!raw) throw new Error('[CredentialCrypto] SWISH_CREDENTIAL_KEY is not set');

  // Accept a 64-character hex key or a base64-encoded 32-byte key.
  // Detect hex first: a hex string is also valid base64 syntax, so trying
  // atob() first can decode it to the wrong byte length and reject a valid key.
  let keyBytes: Uint8Array;
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    keyBytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) keyBytes[i] = parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
  } else {
    try {
      const decoded = atob(trimmed);
      keyBytes = new Uint8Array(decoded.length);
      for (let i = 0; i < decoded.length; i++) keyBytes[i] = decoded.charCodeAt(0);
    } catch {
      throw new Error('[CredentialCrypto] SWISH_CREDENTIAL_KEY must be base64 or hex-encoded 32-byte key');
    }
  }

  if (keyBytes.length !== 32) {
    throw new Error(`[CredentialCrypto] SWISH_CREDENTIAL_KEY must be exactly 32 bytes (got ${keyBytes.length})`);
  }

  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** Encrypt a credential object. Returns "enc:v1:<base64-iv>:<base64-ciphertext>" */
export async function encryptCredentials(credentials: Record<string, unknown>): Promise<string> {
  const plaintext = JSON.stringify(credentials);
  const plaintextBytes = new TextEncoder().encode(plaintext);

  // Random 12-byte IV per encryption
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await getKey();

  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintextBytes,
  );

  const ivB64 = btoa(String.fromCharCode(...iv));
  const ctB64 = btoa(String.fromCharCode(...new Uint8Array(ciphertextBuffer)));

  return `${ENC_PREFIX}${ivB64}:${ctB64}`;
}

/** Decrypt a credential string. Handles both encrypted format and legacy plaintext JSON.
 *
 * MIGRATION BEHAVIOUR:
 *   If the stored value is not encrypted (legacy plaintext JSON), the credential
 *   is decoded and returned. The caller is responsible for re-encrypting and
 *   persisting the encrypted form back to the database. This transparent fallback
 *   allows existing connectors to keep working while a migration is in progress.
 *
 * DO NOT LOG the returned credential object or any of its fields.
 */
export async function decryptCredentials(stored: string): Promise<Record<string, unknown>> {
  if (!stored) throw new Error('[CredentialCrypto] Empty credential_ref');

  // Legacy plaintext JSON — transparent migration path.
  // Log the structural fact (not the content) so operators can track migration progress.
  if (!stored.startsWith(ENC_PREFIX)) {
    console.warn(
      '[CredentialCrypto] MIGRATION REQUIRED: credential_ref is unencrypted plaintext. ' +
      'Re-encrypt this record and persist the encrypted value to eliminate this warning. ' +
      'credential_ref length=' + stored.length,
    );
    try {
      const parsed = JSON.parse(stored);
      if (typeof parsed === 'object' && parsed !== null) return parsed as Record<string, unknown>;
    } catch {}
    throw new Error('[CredentialCrypto] credential_ref is neither encrypted nor valid JSON');
  }

  // Encrypted format: "enc:v1:<iv-b64>:<ct-b64>"
  const withoutPrefix = stored.slice(ENC_PREFIX.length);
  const colonIdx = withoutPrefix.indexOf(':');
  if (colonIdx === -1) throw new Error('[CredentialCrypto] Malformed encrypted credential_ref');

  const ivB64 = withoutPrefix.slice(0, colonIdx);
  const ctB64 = withoutPrefix.slice(colonIdx + 1);

  const iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(ctB64), c => c.charCodeAt(0));

  const key = await getKey();
  let plaintextBuffer: ArrayBuffer;
  try {
    plaintextBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  } catch (e: any) {
    throw new Error(`[CredentialCrypto] Decryption failed — wrong key or corrupted data: ${e.message}`);
  }

  const plaintext = new TextDecoder().decode(plaintextBuffer);
  return JSON.parse(plaintext);
}

/** Returns true if the stored value is already encrypted (not plaintext) */
export function isEncrypted(stored: string): boolean {
  return stored.startsWith(ENC_PREFIX);
}

/**
 * Migrate a single plaintext credential_ref to encrypted format.
 *
 * USAGE: Call this server-side (Edge Function) for any connector where
 * isEncrypted(credential_ref) returns false. Persist the returned value
 * back to marketplace_connectors.credential_ref.
 *
 * Returns null if the stored value is already encrypted — no migration needed.
 * Throws if the stored value cannot be parsed as credential JSON.
 *
 * DO NOT log the parsed credentials object.
 */
export async function migrateToEncrypted(stored: string): Promise<string | null> {
  if (!stored || isEncrypted(stored)) return null; // already encrypted
  const credentials = await decryptCredentials(stored); // will throw if not valid JSON
  const encrypted = await encryptCredentials(credentials);
  console.log('[CredentialCrypto] Migrated plaintext credential_ref to encrypted format. Length before=' + stored.length + ' after=' + encrypted.length);
  return encrypted;
}
