// SWISH — Credential Encryption Utility
//
// AES-256-GCM encryption for eBay credentials stored in
// marketplace_connectors.credential_ref. This module must only be imported by
// trusted Supabase Edge Functions.
//
// Key: SWISH_CREDENTIAL_KEY env var — base64-encoded or hex-encoded 32-byte key.
// Format: "enc:v1:<base64-iv>:<base64-ciphertext>"
//
// Legacy plaintext reads are a temporary compatibility mode, disabled when
// SWISH_REJECT_PLAINTEXT_CREDENTIALS=true. Enable that switch only after the
// owner has run the credential migration for every tenant and confirmed that
// no plaintext rows remain. The fail-closed mode prevents legacy credentials
// from being used again if the migration rollout has been completed.
//
// SECURITY INVARIANTS:
// - Credential contents are never logged or returned to clients.
// - The encryption key is read exclusively from Edge Function secrets.
// - Callers must verify user/tenant membership before accessing credentials.

const ENC_PREFIX = 'enc:v1:';

type ServerEnvironment = { env: { get(name: string): string | undefined } };

function readServerEnv(name: string): string | undefined {
  const denoRuntime = (globalThis as typeof globalThis & { Deno?: ServerEnvironment }).Deno;
  if (!denoRuntime) throw new Error('[CredentialCrypto] Server secret environment is unavailable');
  return denoRuntime.env.get(name);
}

function plaintextFallbackEnabled(): boolean {
  return readServerEnv('SWISH_REJECT_PLAINTEXT_CREDENTIALS') !== 'true';
}

/** Derive a non-exportable AES-256-GCM key from the server-side secret. */
async function getKey(): Promise<CryptoKey> {
  const raw = readServerEnv('SWISH_CREDENTIAL_KEY');
  if (!raw) throw new Error('[CredentialCrypto] Server credential encryption is not configured');

  let keyBytes: Uint8Array;
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    keyBytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) keyBytes[i] = parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
  } else {
    try {
      const decoded = atob(trimmed);
      keyBytes = Uint8Array.from(decoded, (c) => c.charCodeAt(0));
    } catch {
      throw new Error('[CredentialCrypto] Server credential encryption key must be base64 or hex encoded');
    }
  }

  if (keyBytes.length !== 32) {
    throw new Error('[CredentialCrypto] Server credential encryption key must be exactly 32 bytes');
  }

  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** Encrypt credentials with AES-GCM and a fresh 96-bit IV. */
export async function encryptCredentials(credentials: Record<string, unknown>): Promise<string> {
  if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) {
    throw new Error('[CredentialCrypto] Credential payload must be an object');
  }
  const plaintextBytes = new TextEncoder().encode(JSON.stringify(credentials));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await getKey();
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintextBytes);
  const toB64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
  return `${ENC_PREFIX}${toB64(iv)}:${toB64(new Uint8Array(ciphertext))}`;
}

/**
 * Decrypt an encrypted value. Legacy plaintext JSON is accepted only during the
 * explicitly controlled compatibility window. Set SWISH_REJECT_PLAINTEXT_CREDENTIALS
 * to "true" after all tenants have migrated to make plaintext credentials fail closed.
 */
export async function decryptCredentials(stored: string): Promise<Record<string, unknown>> {
  if (!stored) throw new Error('[CredentialCrypto] Empty credential reference');

  if (!stored.startsWith(ENC_PREFIX)) {
    if (!plaintextFallbackEnabled()) {
      throw new Error('[CredentialCrypto] Legacy plaintext credentials are disabled; migrate or reconnect eBay');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(stored);
    } catch {
      throw new Error('[CredentialCrypto] Credential reference format is invalid');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('[CredentialCrypto] Legacy credential payload must be a JSON object');
    }
    // Structural warning only. Never log the value or any credential fields.
    console.warn('[CredentialCrypto] Legacy plaintext credential encountered; owner migration is required');
    return parsed as Record<string, unknown>;
  }

  const parts = stored.slice(ENC_PREFIX.length).split(':');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error('[CredentialCrypto] Encrypted credential reference format is invalid');
  }

  let iv: Uint8Array;
  let ciphertext: Uint8Array;
  try {
    iv = Uint8Array.from(atob(parts[0]), (c) => c.charCodeAt(0));
    ciphertext = Uint8Array.from(atob(parts[1]), (c) => c.charCodeAt(0));
  } catch {
    throw new Error('[CredentialCrypto] Encrypted credential reference encoding is invalid');
  }
  if (iv.length !== 12 || ciphertext.length < 16) {
    throw new Error('[CredentialCrypto] Encrypted credential reference has invalid lengths');
  }

  const key = await getKey();
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  } catch {
    throw new Error('[CredentialCrypto] Credentials cannot be decrypted; verify the server key or reconnect eBay');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new Error('[CredentialCrypto] Decrypted credential payload is invalid');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('[CredentialCrypto] Decrypted credential payload must be an object');
  }
  return parsed as Record<string, unknown>;
}

/** True only for the versioned authenticated-encryption format. */
export function isEncrypted(stored: string): boolean {
  return typeof stored === 'string' && stored.startsWith(ENC_PREFIX);
}

/** Convert one legacy plaintext credential payload to encrypted storage. */
export async function migrateToEncrypted(stored: string): Promise<string | null> {
  if (!stored || isEncrypted(stored)) return null;
  const credentials = await decryptCredentials(stored);
  const encrypted = await encryptCredentials(credentials);
  console.log('[CredentialCrypto] Migrated one legacy credential reference to encrypted format');
  return encrypted;
}

/** Testable policy helper, useful for the Edge Function regression suite. */
export function rejectsPlaintextCredentials(): boolean {
  return !plaintextFallbackEnabled();
}
