import fs from 'node:fs';
import path from 'node:path';
import { calculateProfit, formatCurrency } from '@/services/profitEngine';
const mockRpc = jest.fn();
jest.mock('@/template', () => ({ getSupabaseClient: () => ({ rpc: mockRpc }) }));
import { transitionItemStatus, markItemSold, archiveItem, updateItem } from '@/services/itemService';
const read = (file: string) => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
beforeEach(() => mockRpc.mockReset());
test('transitions are confirmed by one atomic server command', async () => {
  mockRpc.mockResolvedValue({ data: true, error: null });
  expect(await transitionItemStatus('item', 'tenant', 'identified', 'user')).toEqual({ error: null });
  expect(mockRpc).toHaveBeenCalledWith('swish_transition_item', expect.objectContaining({ p_item_id: 'item', p_tenant_id: 'tenant', p_status: 'identified' }));
});
test('a denied/missing command never becomes a successful lifecycle event', async () => {
  mockRpc.mockResolvedValue({ data: null, error: { message: 'denied' } });
  expect((await archiveItem('item', 'tenant')).error).toBe('denied');
  mockRpc.mockResolvedValue({ data: null, error: null });
  expect((await transitionItemStatus('item', 'tenant', 'held')).error).toContain('not confirmed');
});
test('unscoped and invalid sale mutations never call the backend', async () => {
  expect((await updateItem('id', {}, undefined)).error).toContain('tenantId');
  expect((await markItemSold('id', '', { soldPrice: 12 })).error).toBeTruthy();
  expect((await markItemSold('id', 'tenant', { soldPrice: Number.NaN })).error).toBeTruthy();
  expect(mockRpc).not.toHaveBeenCalled();
});
test('sale evidence is explicitly user reported, not fabricated marketplace proof', async () => {
  mockRpc.mockResolvedValue({ data: true, error: null });
  expect((await markItemSold('id', 'tenant', { soldPrice: 20 })).error).toBeNull();
  expect(mockRpc.mock.calls[0][1].p_notes).toBe('User-reported sale');
});
test('SQL transition is invoker-scoped, locked, audited and no-op safe', () => {
  const sql = read('supabase/migrations/20261102_core_atomic_commands.sql');
  expect(sql).toContain('security invoker'); expect(sql).toContain('for update');
  expect(sql).toContain('public.swish_can_access_niche'); expect(sql).toContain('public.audit_events');
  expect(sql).toContain('Confirmed marketplace listing required');
  expect(sql).toContain("then return true; end if;");
  expect(sql).toContain('from public,anon,authenticated');
  expect(sql).toContain('pg_advisory_xact_lock');
});
test('rate-derived fees are always estimates and losses retain their sign', () => {
  expect(calculateProfit({ salePrice: 20, acquisitionCost: 10 }).isEstimate).toBe(true);
  expect(calculateProfit({ salePrice: 20, acquisitionCost: 10, marketplaceFee: 0 }).isEstimate).toBe(false);
  expect(formatCurrency(-12.5)).toBe('-£12.50');
});
test('provider message ingestion preserves local reviewed state and uses the actual schema', () => {
  const source = read('supabase/functions/swish-ebay-messages/index.ts');
  expect(source).toContain("rpc('swish_ingest_ebay_message'");
  expect(source).not.toContain("onConflict: 'ebay_message_id'");
  expect(source).toContain('item_id: ebayItemId');
  expect(source).toContain('const buyerUsername = msgRow.buyer_username');
  expect(source).toContain('success: failed === 0');
});
