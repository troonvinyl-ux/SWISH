// SWISH — Credential Encryption Utility
//
// AES-256-GCM encryption for eBay credentials stored in marketplace_connectors.credential_ref.
// Encryption/decryption happens ONLY inside Edge Functions — never on the client.
//
// Key: SWISH_CREDENTIAL_KEY env var — base64-encoded 32-byte random value.
// Format: "enc:v1:<base64-iv>:<base64-ciphertext>"
//
// Migration: decrypt() accepts both encrypted format AND legacy plaintext JSON.
// Once re-encrypted, credentials are opaque to any client-side query.

const ENC_PREFIX = 'enc:v1:';

/** Derive a CryptoKey from the SWISH_CREDENTIAL_KEY environment variable */
async function getKey(): Promise<CryptoKey> {
  const raw = Deno.env.get('SWISH_CREDENTIAL_KEY');
  if (!raw) throw new Error('[CredentialCrypto] SWISH_CREDENTIAL_KEY is not set');

  // Accept both base64 and hex for flexibility
  let keyBytes: Uint8Array;
  try {
    // Try base64 first
    const decoded = atob(raw.trim());
    keyBytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) keyBytes[i] = decoded.charCodeAt(i);
  } catch {
    // Try hex
    if (/^[0-9a-fA-F]{64}$/.test(raw.trim())) {
      const hex = raw.trim();
      keyBytes = new Uint8Array(32);
      for (let i = 0; i < 32; i++) keyBytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    } else {
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

/** Decrypt a credential string. Handles both encrypted format and legacy plaintext JSON. */
export async function decryptCredentials(stored: string): Promise<Record<string, unknown>> {
  if (!stored) throw new Error('[CredentialCrypto] Empty credential_ref');

  // Legacy plaintext JSON — migrate transparently
  if (!stored.startsWith(ENC_PREFIX)) {
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
