import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  decryptCredentials,
  encryptCredentials,
  isEncrypted,
  rejectsPlaintextCredentials,
} from '../supabase/functions/_shared/credentialCrypto.ts';

const envValues = new Map<string, string>();
const originalDeno = (globalThis as typeof globalThis & { Deno?: unknown }).Deno;

beforeEach(() => {
  envValues.clear();
  (globalThis as typeof globalThis & { Deno?: unknown }).Deno = {
    env: {
      get: (name: string) => envValues.get(name),
    },
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
  it('keeps plaintext compatibility enabled until strict mode is explicitly enabled', () => {
    expect(rejectsPlaintextCredentials()).toBe(false);
    envValues.set('SWISH_REJECT_PLAINTEXT_CREDENTIALS', 'false');
    expect(rejectsPlaintextCredentials()).toBe(false);
    envValues.set('SWISH_REJECT_PLAINTEXT_CREDENTIALS', 'true');
    expect(rejectsPlaintextCredentials()).toBe(true);
  });

  it('rejects legacy plaintext in strict mode without parsing or returning it', async () => {
    envValues.set('SWISH_REJECT_PLAINTEXT_CREDENTIALS', 'true');
    await expect(decryptCredentials(JSON.stringify({ accessToken: 'fixture-token' })))
      .rejects.toThrow('Legacy plaintext credentials are disabled');
  });

  it('accepts a legacy object only during compatibility mode', async () => {
    envValues.delete('SWISH_REJECT_PLAINTEXT_CREDENTIALS');
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(decryptCredentials(JSON.stringify({ clientId: 'fixture-id' })))
      .resolves.toEqual({ clientId: 'fixture-id' });
  });

  it('recognises only the versioned encrypted prefix', () => {
    expect(isEncrypted(JSON.stringify({ accessToken: 'fixture-token' }))).toBe(false);
    expect(isEncrypted('enc:v1:dGVzdA==:dGVzdA==')).toBe(true);
    expect(isEncrypted('enc:v2:dGVzdA==:dGVzdA==')).toBe(false);
    expect(isEncrypted(null as unknown as string)).toBe(false);
  });

  it('round-trips credentials with authenticated encryption and a server-only key', async () => {
    // Deterministic test key only. Never use this value outside the test.
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
    const altered = `enc:v1:${iv}:${Buffer.from(ciphertext, 'base64').toString('base64').slice(0, -4)}AAAA`;
    await expect(decryptCredentials(altered)).rejects.toThrow();
  });
});
