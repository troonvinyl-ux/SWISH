// SWISH — Credential Encryption Utility
//
// AES-256-GCM encryption for eBay credentials stored in marketplace_connectors.credential_ref.
// Encryption/decryption happens ONLY inside trusted Edge Functions.
// Key: SWISH_CREDENTIAL_KEY server secret, base64- or hex-encoded 32-byte value.
// Format: "enc:v1:<base64-iv>:<base64-ciphertext>"
//
// SECURITY INVARIANTS:
//   - Normal credential reads fail closed for plaintext and malformed payloads.
//   - Legacy plaintext parsing is isolated to migrateToEncrypted() only.
//   - Credential contents are never logged or returned to clients.
//   - Callers must verify tenant membership and resource ownership before access.

const ENC_PREFIX = 'enc:v1:';

type ServerEnvironment = { env: { get(name: string): string | undefined } };

function readServerEnv(name: string): string | undefined {
  const denoRuntime = (globalThis as typeof globalThis & { Deno?: ServerEnvironment }).Deno;
  if (!denoRuntime) throw new Error('[CredentialCrypto] Server secret environment is unavailable');
  return denoRuntime.env.get(name);
}

async function getKey(): Promise<CryptoKey> {
  const raw = readServerEnv('SWISH_CREDENTIAL_KEY');
  if (!raw) throw new Error('[CredentialCrypto] SWISH_CREDENTIAL_KEY is not set');

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
    throw new Error('[CredentialCrypto] SWISH_CREDENTIAL_KEY must be exactly 32 bytes');
  }

  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptCredentials(credentials: Record<string, unknown>): Promise<string> {
  const plaintextBytes = new TextEncoder().encode(JSON.stringify(credentials));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await getKey();
  const ciphertextBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintextBytes);
  const ivB64 = btoa(String.fromCharCode(...iv));
  const ctB64 = btoa(String.fromCharCode(...new Uint8Array(ciphertextBuffer)));
  return `${ENC_PREFIX}${ivB64}:${ctB64}`;
}

/** Decrypt encrypted credentials only. Plaintext legacy values are rejected. */
export async function decryptCredentials(stored: string): Promise<Record<string, unknown>> {
  if (!stored) throw new Error('[CredentialCrypto] Empty credential_ref');
  if (!isEncrypted(stored)) {
    throw new Error('[CredentialCrypto] Plaintext credential_ref rejected; run the owner-authorised credential migration');
  }

  const withoutPrefix = stored.slice(ENC_PREFIX.length);
  const colonIdx = withoutPrefix.indexOf(':');
  if (colonIdx === -1) throw new Error('[CredentialCrypto] Malformed encrypted credential_ref');

  const ivB64 = withoutPrefix.slice(0, colonIdx);
  const ctB64 = withoutPrefix.slice(colonIdx + 1);
  let iv: Uint8Array;
  let ciphertext: Uint8Array;
  try {
    iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0));
    ciphertext = Uint8Array.from(atob(ctB64), c => c.charCodeAt(0));
  } catch {
    throw new Error('[CredentialCrypto] Malformed encrypted credential_ref');
  }
  if (iv.length !== 12 || ciphertext.length < 17) {
    throw new Error('[CredentialCrypto] Malformed encrypted credential_ref');
  }

  const key = await getKey();
  let plaintextBuffer: ArrayBuffer;
  try {
    plaintextBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  } catch {
    throw new Error('[CredentialCrypto] Decryption failed — wrong key or corrupted data');
  }

  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(plaintextBuffer));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('invalid credential object');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error('[CredentialCrypto] Decrypted credential payload is invalid');
  }
}

export function isEncrypted(stored: string): boolean {
  return typeof stored === 'string' && stored.startsWith(ENC_PREFIX);
}

/** Parse legacy plaintext only inside the explicit, owner-authorised migration path. */
function parseLegacyCredentials(stored: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(stored);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Do not expose parse details or stored credential contents.
  }
  throw new Error('[CredentialCrypto] Legacy credential payload is not valid JSON object data');
}

/** Convert one legacy plaintext credential_ref. Returns null if already encrypted. */
export async function migrateToEncrypted(stored: string): Promise<string | null> {
  if (!stored || isEncrypted(stored)) return null;
  const credentials = parseLegacyCredentials(stored);
  const encrypted = await encryptCredentials(credentials);
  console.log('[CredentialCrypto] Migrated legacy credential_ref to encrypted format', {
    plaintextLength: stored.length,
    encryptedLength: encrypted.length,
  });
  return encrypted;
}
