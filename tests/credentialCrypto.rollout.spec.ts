

import { webcrypto } from 'node:crypto';
import {
  decryptCredentials,
  encryptCredentials,
  isEncrypted,
  rejectsPlaintextCredentials,
} from '../supabase/functions/_shared/credentialCrypto';

const envValues = new Map<string, string>();
const originalDeno = (globalThis as typeof globalThis & { Deno?: unknown }).Deno;

beforeEach(() => {
  envValues.clear();
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
  (globalThis as typeof globalThis & { Deno?: unknown }).Deno = {
    env: { get: (name: string) => envValues.get(name) },
  };
});

afterEach(() => {
  if (originalDeno === undefined) {
    delete (globalThis as typeof globalThis & { Deno?: unknown }).Deno;
  } else {
    (globalThis as typeof globalThis & { Deno?: unknown }).Deno = originalDeno;
  }
  jest.restoreAllMocks();
});

describe('shared credential crypto rollout gate', () => {
  it('enables legacy compatibility only while the strict flag is not true', () => {
    expect(rejectsPlaintextCredentials()).toBe(false);
    envValues.set('SWISH_REJECT_PLAINTEXT_CREDENTIALS', 'false');
    expect(rejectsPlaintextCredentials()).toBe(false);
    envValues.set('SWISH_REJECT_PLAINTEXT_CREDENTIALS', 'true');
    expect(rejectsPlaintextCredentials()).toBe(true);
  });

  it('rejects legacy plaintext in strict mode before parsing the payload', async () => {
    envValues.set('SWISH_REJECT_PLAINTEXT_CREDENTIALS', 'true');
    await expect(decryptCredentials(JSON.stringify({ accessToken: 'fixture-token' })))
      .rejects.toThrow('Legacy plaintext credentials are disabled');
  });

  it('accepts an object-like legacy payload only during compatibility mode', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(decryptCredentials(JSON.stringify({ clientId: 'fixture-id' })))
      .resolves.toEqual({ clientId: 'fixture-id' });
  });

  it('recognises encrypted format without treating plaintext JSON as encrypted', () => {
    expect(isEncrypted(JSON.stringify({ accessToken: 'fixture-token' }))).toBe(false);
    expect(isEncrypted('enc:v1:dGVzdA==:dGVzdA==')).toBe(true);
    expect(isEncrypted('enc:v2:dGVzdA==:dGVzdA==')).toBe(false);
    expect(isEncrypted(null as unknown as string)).toBe(false);
  });

  it('round-trips credentials using AES-GCM and a server-side key fixture', async () => {
    // Test-only key. Never use this value outside automated tests.
    envValues.set('SWISH_CREDENTIAL_KEY', '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff');
    const input = { clientId: 'fixture-id', clientSecret: 'fixture-secret', accessToken: 'fixture-token' };
    const encrypted = await encryptCredentials(input);
    expect(isEncrypted(encrypted)).toBe(true);
    expect(encrypted).not.toContain(input.clientSecret);
    await expect(decryptCredentials(encrypted)).resolves.toEqual(input);
  });

  it('rejects truncated ciphertext and altered authenticated payloads', async () => {
    envValues.set('SWISH_CREDENTIAL_KEY', '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff');
    const encrypted = await encryptCredentials({ accessToken: 'fixture-token' });
    const [, iv, ciphertext] = encrypted.split(':');
    await expect(decryptCredentials(`enc:v1:${iv}:abc`)).rejects.toThrow('invalid lengths');

    const bytes = Uint8Array.from(Buffer.from(ciphertext, 'base64'));
    bytes[0] ^= 0x01;
    const altered = `enc:v1:${iv}:${Buffer.from(bytes).toString('base64')}`;
    await expect(decryptCredentials(altered)).rejects.toThrow('Credentials cannot be decrypted');
  });
});
