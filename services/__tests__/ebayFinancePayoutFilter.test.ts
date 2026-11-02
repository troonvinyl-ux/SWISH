const fs = require('node:fs');
const path = require('node:path');

describe('eBay Finances payout filter contract', () => {
  test('ordinary payout history uses the supported payoutDate filter', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../supabase/functions/swish-ebay-finances/index.ts'), 'utf8');
    expect(source).toContain('payoutDate:[');
    expect(source).not.toContain('lastAttemptedPayoutDate:[');
    expect(source).toContain('payoutStatus:RETRYABLE_FAILED');
    expect(source).toContain('resp.status === 204');
    expect(source).toContain('noPayouts: true');
  });
});
