const mockInvoke = jest.fn();
const mockQuery: any = {};
for (const method of ['from','select','eq','order','limit','update']) mockQuery[method] = jest.fn(() => mockQuery);
mockQuery.maybeSingle = jest.fn();
mockQuery.then = jest.fn((resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: [], error: null })));
jest.mock('@/template', () => ({ getSupabaseClient: () => ({ ...mockQuery, functions: { invoke: mockInvoke } }) }));
import { syncEbayMessages, sendEbayReply, listEbayMessages, updateEbayMessageFlag } from '../ebayMessageService';
beforeEach(() => { mockInvoke.mockReset(); mockQuery.eq.mockClear(); mockQuery.maybeSingle.mockReset(); });
test('unconfirmed sync cannot masquerade as no new messages', async () => {
  mockInvoke.mockResolvedValue({ data: { success: false, synced: 0, error: 'persist failed' }, error: null });
  expect((await syncEbayMessages('tenant')).error).toBe('persist failed');
});
test('unconfirmed send is never saved as a sent reply', async () => {
  mockInvoke.mockResolvedValue({ data: { success: true, ebaySuccess: false }, error: null });
  expect((await sendEbayReply('tenant', { messageId: 'id', replyText: 'hello', buyerUsername: 'buyer' })).error).toContain('did not confirm');
});
test('confirmed provider send retains the local-reconciliation warning', async () => {
  mockInvoke.mockResolvedValue({ data: { success: true, ebaySuccess: true, localSyncPending: true, message: 'local retry' }, error: null });
  expect(await sendEbayReply('tenant', { messageId: 'id', replyText: 'hello', buyerUsername: 'buyer' })).toEqual({ ebaySuccess: true, localSyncPending: true, message: 'local retry' });
});
test('read/archive requires scoped persistence confirmation', async () => {
  mockQuery.maybeSingle.mockResolvedValue({ data: null, error: null });
  expect((await updateEbayMessageFlag('tenant', 'id', 'is_archived')).error).toContain('not confirmed');
  expect(mockQuery.eq).toHaveBeenCalledWith('tenant_id', 'tenant');
});
test('missing account fails closed without listing messages', async () => {
  expect(await listEbayMessages('')).toEqual({ messages: [], error: 'Business account is required.' });
});
