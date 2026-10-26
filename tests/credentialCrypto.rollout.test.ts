import { rejectsPlaintextCredentials, isEncrypted } from '../supabase/functions/_shared/credentialCrypto.ts';

describe('shared credential crypto rollout gate', () => {
  const original = Deno.env.get('SWISH_REJECT_PLAINTEXT_CREDENTIALS');

  afterEach(() => {
    if (original === undefined) Deno.env.delete('SWISH_REJECT_PLAINTEXT_CREDENTIALS');
    else Deno.env.set('SWISH_REJECT_PLAINTEXT_CREDENTIALS', original);
  });

  it('keeps plaintext compatibility enabled until the migration gate is explicitly enabled', () => {
    Deno.env.delete('SWISH_REJECT_PLAINTEXT_CREDENTIALS');
    expect(rejectsPlaintextCredentials()).toBe(false);
  });

  it('fails closed for legacy plaintext when strict mode is enabled', () => {
    Deno.env.set('SWISH_REJECT_PLAINTEXT_CREDENTIALS', 'true');
    expect(rejectsPlaintextCredentials()).toBe(true);
  });

  it('does not treat plaintext JSON as encrypted storage', () => {
    expect(isEncrypted(JSON.stringify({ accessToken: 'redacted-fixture' }))).toBe(false);
  });

  it('recognises only the versioned encrypted prefix', () => {
    expect(isEncrypted('enc:v1:dGVzdA==:dGVzdA==')).toBe(true);
    expect(isEncrypted('enc:v2:dGVzdA==:dGVzdA==')).toBe(false);
  });
});
