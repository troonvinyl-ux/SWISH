// Mocked existing AI transport; no provider requests, seller writes or real-device claims.
jest.mock('../listingEditorService', () => ({ invokeListingOperation: jest.fn() }));
import { invokeListingOperation } from '../listingEditorService';
import { generateListingCopy } from '../listingCopyService';
beforeEach(() => jest.clearAllMocks());
test('title action selects only title from the existing niche-specific generator result', async () => {
  (invokeListingOperation as jest.Mock).mockResolvedValue({ data: { listing: { title: 'Reviewed DVD edition', description: 'Other generated copy', recommended_price: 999, item_specifics: { Condition: 'New' } } }, error: null });
  expect(await generateListingCopy({ itemId: 'item', tenantId: 'tenant', field: 'title' })).toEqual({ value: 'Reviewed DVD edition', error: null });
  expect(invokeListingOperation).toHaveBeenCalledWith({ item_id: 'item', tenant_id: 'tenant', marketplace_id: 'ebay', fields: ['title'] }, 'swish-list-generate');
});
test('description action preserves the exact formatted HTML and does not replace other fields', async () => {
  const description = '  <div style="font-family:Arial"><h2>Item description</h2><p>Doctor Who &amp; Christmas<br />Visible case wear.</p><table><tr><td>Format</td><td>DVD</td></tr></table><div><strong>TECH FLIP</strong> | POWERED BY SWISHFLIP</div></div>\n';
  (invokeListingOperation as jest.Mock).mockResolvedValue({ data: { listing: { title: 'Unrelated title', description } }, error: null });
  expect(await generateListingCopy({ itemId: 'item', tenantId: 'tenant', field: 'description' })).toEqual({ value: description, error: null });
});
test.each([undefined, null, '', '   ', 7, { text: 'Wrong shape' }])('invalid chosen field %j never becomes replacement text', async title => {
  (invokeListingOperation as jest.Mock).mockResolvedValue({ data: { listing: { title } }, error: null });
  const result = await generateListingCopy({ itemId: 'item', tenantId: 'tenant', field: 'title' });
  expect(result.value).toBeNull(); expect(result.error).toMatch(/unchanged/);
});
test('overlength titles are not silently truncated and large descriptions are rejected', async () => {
  (invokeListingOperation as jest.Mock).mockResolvedValueOnce({ data: { listing: { title: 'x'.repeat(81) } }, error: null }).mockResolvedValueOnce({ data: { listing: { description: 'x'.repeat(100001) } }, error: null });
  expect((await generateListingCopy({ itemId: 'item', tenantId: 'tenant', field: 'title' })).value).toBeNull();
  expect((await generateListingCopy({ itemId: 'item', tenantId: 'tenant', field: 'description' })).value).toBeNull();
});
test('transport errors and absent identity cannot provide replacement content', async () => {
  (invokeListingOperation as jest.Mock).mockResolvedValue({ data: null, error: 'Authentication required' });
  expect(await generateListingCopy({ itemId: 'item', tenantId: 'tenant', field: 'title' })).toEqual({ value: null, error: 'Authentication required' });
  (invokeListingOperation as jest.Mock).mockClear();
  expect((await generateListingCopy({ itemId: '', tenantId: 'tenant', field: 'title' })).value).toBeNull();
  expect(invokeListingOperation).not.toHaveBeenCalled();
});
