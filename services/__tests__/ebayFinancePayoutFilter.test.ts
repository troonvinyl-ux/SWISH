const fs = require('node:fs');
const path = require('node:path');

describe('eBay Finances payout filter contract', () => {

  test('provider errors expose only safe eBay diagnostics and redact credentials', () => {
    const { summarizeEbayFinanceError } = require('../../supabase/functions/_shared/ebayFinance');
    const summary = summarizeEbayFinanceError(JSON.stringify({ errors: [{
      errorId: 25002, domain: 'API_FINANCES', category: 'REQUEST',
      message: 'Invalid filter. Authorization Bearer eyJabcdefgh.abcdefgh.abcdefgh client_secret=secret-value',
      longMessage: 'DO NOT EXPOSE THIS LONG MESSAGE',
      parameters: [{ name: 'token', value: 'DO NOT EXPOSE THIS PARAMETER' }],
    }] }));
    expect(summary).toContain('errorId=25002');
    expect(summary).toContain('API_FINANCES');
    expect(summary).toContain('REQUEST');
    expect(summary).toContain('Bearer [redacted]');
    expect(summary).toContain('client_secret=[redacted]');
    expect(summary).not.toContain('secret-value');
    expect(summary).not.toContain('DO NOT EXPOSE');
  });

  test('malformed or unstructured provider errors never return the raw body', () => {
    const { summarizeEbayFinanceError } = require('../../supabase/functions/_shared/ebayFinance');
    expect(summarizeEbayFinanceError('<html>secret-value</html>')).toBe('Provider error body was not valid JSON');
    expect(summarizeEbayFinanceError('{}')).toBe('Provider returned an unstructured error response');
  });

  test('ordinary payout history uses the supported payoutDate filter', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../supabase/functions/swish-ebay-finances/index.ts'), 'utf8');
    expect(source).toContain('payoutDate:[');
    expect(source).not.toContain('lastAttemptedPayoutDate:[');
    expect(source).toContain('payoutStatus:RETRYABLE_FAILED');
    expect(source).toContain('resp.status === 204');
    expect(source).toContain('noPayouts: true');
  });
});
