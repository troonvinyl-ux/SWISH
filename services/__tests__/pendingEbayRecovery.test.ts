import { verifyPendingEbayItem } from '../../supabase/functions/_shared/listingStatus';

const response = '<Ack>Success</Ack><Item><ItemID>123456789</ItemID><SKU>COIN-1</SKU>' +
  '<Seller><UserID>seller</UserID></Seller><ListingDetails><StartTime>2026-11-25T19:00:00Z</StartTime></ListingDetails>' +
  '<Quantity>1</Quantity><SellingStatus><ListingStatus>Active</ListingStatus><QuantitySold>0</QuantitySold></SellingStatus></Item>';

test('recovers status and start time from matching seller inventory', () => {
  expect(verifyPendingEbayItem(response, '123456789', 'Seller', 'COIN-1')).toMatchObject({
    status: 'active', startedAt: '2026-11-25T19:00:00Z',
  });
});

test.each([
  ['123456788', 'seller', 'COIN-1'],
  ['123456789', 'another-seller', 'COIN-1'],
  ['123456789', 'seller', 'COIN-2'],
])('rejects another item, seller or SKU before linking', (id, seller, sku) => {
  expect(() => verifyPendingEbayItem(response, id, seller, sku)).toThrow();
});

test('recovers a SKU-less draft using exact eBay listing evidence', () => {
  const legacy = response.replace('<SKU>COIN-1</SKU>',
    '<Title>Roman coin</Title><PrimaryCategory><CategoryID>4733</CategoryID></PrimaryCategory><StartPrice currencyID="GBP">12.95</StartPrice><Currency>GBP</Currency>');
  const details = { title: 'Roman coin', categoryId: '4733', startingPrice: 12.95, decode: (value: string) => value };
  expect(verifyPendingEbayItem(legacy, '123456789', 'seller', '', details).status).toBe('active');
  expect(() => verifyPendingEbayItem(legacy, '123456789', 'seller', '', { ...details, startingPrice: 13.95 })).toThrow();
  expect(() => verifyPendingEbayItem(legacy.replace('<Title>', '<SKU>OTHER</SKU><Title>'), '123456789', 'seller', 'COIN-1', details)).toThrow();
});
