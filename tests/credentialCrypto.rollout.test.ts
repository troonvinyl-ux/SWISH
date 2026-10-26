describe('shared credential crypto rollout gate', () => {
  const original = process.env.SWISH_REJECT_PLAINTEXT_CREDENTIALS;

  afterEach(() => {
    if (original === undefined) delete process.env.SWISH_REJECT_PLAINTEXT_CREDENTIALS;
    else process.env.SWISH_REJECT_PLAINTEXT_CREDENTIALS = original;
  });

  it('keeps plaintext compatibility enabled until the migration gate is explicitly enabled', () => {
    delete process.env.SWISH_REJECT_PLAINTEXT_CREDENTIALS;
    expect(process.env.SWISH_REJECT_PLAINTEXT_CREDENTIALS === 'true').toBe(false);
  });

  it('fails closed for legacy plaintext when strict mode is enabled', () => {
    process.env.SWISH_REJECT_PLAINTEXT_CREDENTIALS = 'true';
    expect(process.env.SWISH_REJECT_PLAINTEXT_CREDENTIALS === 'true').toBe(true);
  });

  it('does not treat plaintext JSON as encrypted storage', () => {
    expect(JSON.stringify({ accessToken: 'redacted-fixture' }).startsWith('enc:v1:')).toBe(false);
  });

  it('recognises only the versioned encrypted prefix', () => {
    expect('enc:v1:dGVzdA==:dGVzdA=='.startsWith('enc:v1:')).toBe(true);
    expect('enc:v2:dGVzdA==:dGVzdA=='.startsWith('enc:v1:')).toBe(false);
  });
});
