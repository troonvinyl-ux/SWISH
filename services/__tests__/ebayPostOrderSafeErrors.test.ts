import * as fs from 'fs';
import * as path from 'path';

const source = fs.readFileSync(
  path.resolve(__dirname, '../../supabase/functions/swish-ebay-post-order/index.ts'),
  'utf8',
);

describe('eBay Post-Order safe error handling', () => {
  test('provider response bodies and raw exception text are not logged or returned', () => {
    expect(source).not.toContain('e.message');
    expect(source).not.toContain('responseText.slice');
    expect(source).not.toContain('errText.slice');
    expect(source).toContain('eBay rejected dispatch (HTTP ${fulfillResp.status}).');
    expect(source).toContain('eBay shipping lookup failed (HTTP ${resp.status}).');
  });

  test('database and authentication failures return generic messages', () => {
    expect(source).toContain('Unable to read saved return records.');
    expect(source).toContain('Unable to update the saved return record.');
    expect(source).toContain('Unable to read saved case records.');
    expect(source).toContain('Authentication verification failed. Please sign in again.');
  });

  test('successful fulfillment response parsing remains intact', () => {
    expect(source).toContain('const responseData = JSON.parse(responseText)');
    expect(source).toContain('ebayFulfillmentId = responseData.fulfillmentId ?? null');
  });
});
