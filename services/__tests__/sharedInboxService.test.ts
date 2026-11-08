// Mocked existing backend service tests. No live buyer messages or eBay sends.
jest.mock('@/template', () => ({ getSupabaseClient: jest.fn() }));
import { getSupabaseClient } from '@/template';
import { listEbayMessages, syncEbayMessages, sendEbayReply, updateEbayMessageFlag, suggestEbayReply } from '../ebayMessageService';
function query(result: any) { const q: any = {}; for (const method of ['select', 'eq', 'order', 'limit', 'update']) q[method] = jest.fn(() => q); q.maybeSingle = jest.fn(async () => result); q.then = (resolve: any) => Promise.resolve(result).then(resolve); return q; }
beforeEach(() => jest.clearAllMocks());
test('message reads retain tenant filters and errors are not successful empty inboxes', async () => {
  const q = query({ data: null, error: { message: 'Access denied' } });
  (getSupabaseClient as jest.Mock).mockReturnValue({ from: jest.fn(() => q) });
  expect((await listEbayMessages('tenant')).error).toBe('Access denied');
  expect(q.eq).toHaveBeenCalledWith('tenant_id', 'tenant');
});
test('archive/read flags require tenant and confirmed changed row', async () => {
  const q = query({ data: null, error: null }); (getSupabaseClient as jest.Mock).mockReturnValue({ from: jest.fn(() => q) });
  expect((await updateEbayMessageFlag('tenant', 'message', 'is_read')).error).not.toBeNull();
  expect(q.eq).toHaveBeenCalledWith('id', 'message'); expect(q.eq).toHaveBeenCalledWith('tenant_id', 'tenant');
  expect((await updateEbayMessageFlag('', 'message', 'is_archived')).error).not.toBeNull();
});
test('reply and sync never treat an acknowledgement or unknown response as provider success', async () => {
  const invoke = jest.fn().mockResolvedValue({ data: { success: true }, error: null });
  (getSupabaseClient as jest.Mock).mockReturnValue({ functions: { invoke } });
  expect((await sendEbayReply('tenant', { messageId: 'message', replyText: 'Reviewed reply', buyerUsername: 'buyer' })).ebaySuccess).toBe(false);
  expect((await syncEbayMessages('tenant')).error).not.toBeNull();
});
test('provider-confirmed replies retain local reconciliation pending state', async () => {
  (getSupabaseClient as jest.Mock).mockReturnValue({ functions: { invoke: jest.fn().mockResolvedValue({ data: { success: true, ebaySuccess: true, localSyncPending: true }, error: null }) } });
  expect(await sendEbayReply('tenant', { messageId: 'message', replyText: 'Reviewed reply', buyerUsername: 'buyer' })).toMatchObject({ ebaySuccess: true, localSyncPending: true });
});
test('reply templates do not invent dispatch or order status', () => {
  const suggested = suggestEbayReply({ subject: 'Where is shipping?' } as any);
  expect(suggested).toContain('check the current order'); expect(suggested).not.toContain('has been processed'); expect(suggested).not.toContain('dispatching it very soon');
});
