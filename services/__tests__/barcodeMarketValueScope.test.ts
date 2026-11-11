// Deterministic effect/state harness; this does not claim native device testing.
let mockCursor = 0;
let mockSlots: any[] = [];
let mockEffects: Array<() => void> = [];
let mockApp: any;
let mockUser: any;
jest.mock('react', () => ({
  useState: (initial: any) => {
    const index = mockCursor++;
    if (!(index in mockSlots)) mockSlots[index] = initial;
    return [mockSlots[index], (next: any) => { mockSlots[index] = typeof next === 'function' ? next(mockSlots[index]) : next; }];
  },
  useRef: (initial: any) => { const index = mockCursor++; if (!(index in mockSlots)) mockSlots[index] = { current: initial }; return mockSlots[index]; },
  useCallback: (callback: any) => callback,
  useEffect: (effect: any, deps: any[]) => {
    const index = mockCursor++, old = mockSlots[index];
    if (!old || deps.some((value, entry) => !Object.is(value, old.deps[entry]))) {
      mockEffects.push(() => { old?.cleanup?.(); mockSlots[index] = { deps, cleanup: effect() }; });
    }
  },
}));
jest.mock('@/template', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('@/hooks/useApp', () => ({ useApp: () => mockApp }));
jest.mock('@/services/barcodeMarketValueService', () => ({
  barcodeMarketKey: (tenant: string, niche: string, lead: any) => lead.title ? `${tenant}:${niche}:${lead.title}:${lead.region}` : '',
  getBarcodeMarketValue: jest.fn(),
}));
import { useBarcodeMarketValue } from '@/hooks/useBarcodeMarketValue';
import { getBarcodeMarketValue } from '@/services/barcodeMarketValueService';
import type { ProductLead } from '@/shared/quickList';
const lead: ProductLead = { id: 'candidate', gtin: '5014503238124', title: 'DVD A', region: '2', brand: '', model: '', categoryId: '', categoryName: '', specifics: {}, source: 'OnSpace AI', url: '' };
const result: any = { valuation: { valuationMid: 5 } };
function render(product = lead) { mockCursor = 0; const state = useBarcodeMarketValue(product); const effects = mockEffects; mockEffects = []; effects.forEach(effect => effect()); return state; }
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks(); mockCursor = 0; mockSlots = []; mockEffects = [];
  mockApp = { tenant: { id: 'tenant' }, activeNicheId: 'tech', fixedNicheId: null, moduleEpoch: 1, accessReady: true, moduleLoading: false };
  mockUser = { id: 'user' }; (getBarcodeMarketValue as jest.Mock).mockResolvedValue({ result, error: null });
});
afterEach(() => { mockSlots.forEach(slot => slot?.cleanup?.()); jest.useRealTimers(); });
test('pricing starts automatically after identity, runs once for stable renders and remains independent of product confirmation', async () => {
  expect(render().loading).toBe(true); render(); render();
  await jest.advanceTimersByTimeAsync(250); await flush(); expect(render().result).toBe(result); expect(getBarcodeMarketValue).toHaveBeenCalledTimes(1);
});
test('changing a candidate hides the old price immediately and ignores late responses', async () => {
  let resolveOld: (value: any) => void = () => {};
  (getBarcodeMarketValue as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  render(); await jest.advanceTimersByTimeAsync(250);
  const next = { ...lead, title: 'DVD B' }; expect(render(next).result).toBeNull();
  resolveOld({ result: { valuation: { valuationMid: 999 } }, error: null }); await flush(); expect(render(next).result).toBeNull();
  await jest.advanceTimersByTimeAsync(250); await flush(); expect(render(next).result).toBe(result);
});
test('rapid edits debounce to the final product metadata and stale values stay hidden', async () => {
  render(); await jest.advanceTimersByTimeAsync(100); render({ ...lead, title: 'DVD AB' });
  await jest.advanceTimersByTimeAsync(100); const final = { ...lead, title: 'DVD ABC', region: '1' }; render(final);
  await jest.advanceTimersByTimeAsync(250); await flush();
  expect(getBarcodeMarketValue).toHaveBeenCalledTimes(1); expect((getBarcodeMarketValue as jest.Mock).mock.calls[0][0].lead).toBe(final);
});
test('account/module changes invalidate pending results, and unavailable access prevents calls', async () => {
  let resolveOld: (value: any) => void = () => {};
  (getBarcodeMarketValue as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  render(); await jest.advanceTimersByTimeAsync(250);
  mockApp = { ...mockApp, activeNicheId: 'collectibles', moduleEpoch: 2, accessReady: false };
  expect(render().result).toBeNull(); resolveOld({ result, error: null }); await flush();
  await jest.advanceTimersByTimeAsync(500); expect(render().result).toBeNull(); expect(getBarcodeMarketValue).toHaveBeenCalledTimes(1);
});
test('unmount prevents a pending provider response from changing state', async () => {
  let resolvePending: (value: any) => void = () => {};
  (getBarcodeMarketValue as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { resolvePending = resolve; }));
  render(); await jest.advanceTimersByTimeAsync(250);
  mockSlots.forEach(slot => slot?.cleanup?.());
  const before = JSON.stringify(mockSlots.filter(slot => slot && typeof slot === 'object' && 'requestKey' in slot));
  resolvePending({ result, error: null }); await flush();
  expect(JSON.stringify(mockSlots.filter(slot => slot && typeof slot === 'object' && 'requestKey' in slot))).toBe(before);
});
test('retry replaces the error and unmount cancels delayed lookup', async () => {
  (getBarcodeMarketValue as jest.Mock).mockResolvedValueOnce({ result: null, error: 'eBay connection required' });
  render(); await jest.advanceTimersByTimeAsync(250); await flush(); const failed = render(); expect(failed.error).toBe('eBay connection required');
  failed.retry(); expect(render().loading).toBe(true); await jest.advanceTimersByTimeAsync(250); await flush(); expect(render().error).toBe(''); expect(render().result).toBe(result);
  render({ ...lead, title: 'Another item' }); mockSlots.forEach(slot => slot?.cleanup?.()); await jest.advanceTimersByTimeAsync(250); expect(getBarcodeMarketValue).toHaveBeenCalledTimes(2);
});
