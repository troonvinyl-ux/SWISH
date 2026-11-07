// Mocked client/compatibility regressions; not a live AI or eBay acceptance test.
import fs from 'node:fs';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn() }));
jest.mock('@/template', () => ({ getSupabaseClient: jest.fn() }));
jest.mock('@/services/aiIdentificationService', () => ({ identifyItemWithAI: jest.fn() }));
jest.mock('@/services/listingService', () => ({}));
jest.mock('@/services/listingEditorService', () => ({}));
jest.mock('@/services/marketValueService', () => ({}));
jest.mock('@/services/originalImageService', () => ({}));
jest.mock('@/services/smartStudioStorageService', () => ({}));
jest.mock('@/services/itemService', () => ({}));

import { identifyItemWithAI, type CapturedImage } from '@/services/aiIdentificationService';
import { identifyQuickPhotos } from '@/services/quickListService';
import registry from '@/niche-modules.json';
import { normalizeIdentifySpecialist } from '../../supabase/functions/_shared/identifySpecialistCompatibility';

const identify = identifyItemWithAI as jest.Mock;
const photos: CapturedImage[] = [
  { uri: 'file://retained-front.jpg', slotId: 'front', slotLabel: 'front' },
  { uri: 'file://retained-back.jpg', slotId: 'back', slotLabel: 'back' },
];

beforeEach(() => jest.clearAllMocks());

test.each(['collectibles', 'coins'] as const)('%s Quick List sends the registered specialist with retained originals', async nicheId => {
  const response = { result: { specialistId: registry.products[nicheId].defaultSpecialist }, error: null };
  identify.mockResolvedValue(response);
  const unchanged = JSON.stringify(photos);
  await expect(identifyQuickPhotos('tenant-test', nicheId, photos, null, {})).resolves.toBe(response);
  expect(identify).toHaveBeenCalledTimes(1);
  expect(identify).toHaveBeenCalledWith(photos, registry.products[nicheId].defaultSpecialist, undefined,
    expect.any(Object), { tenantId: 'tenant-test', presentationInParallel: true });
  expect(identify.mock.calls[0][0]).toBe(photos);
  expect(JSON.stringify(photos)).toBe(unchanged);
});

test('the older Collectibles request is normalized to canonical identity, not authorized as generic stock', () => {
  const canonical = normalizeIdentifySpecialist('collectibles', 'swish-identify', 'curiosities_collectibles');
  expect(canonical).toBe('collectibles');
  expect(registry.products.collectibles.specialists).toContain(canonical);
  for (const product of Object.values(registry.products)) {
    expect([...product.specialists, ...product.legacySpecialists]).not.toContain('curiosities_collectibles');
  }
});

test.each(Object.keys(registry.products).filter(niche => niche !== 'collectibles'))('%s retains the generic specialist denial', niche => {
  const value = normalizeIdentifySpecialist(niche, 'swish-identify', 'curiosities_collectibles');
  expect(value).toBe('curiosities_collectibles');
  const product = registry.products[niche as keyof typeof registry.products];
  expect([...product.specialists, ...product.legacySpecialists]).not.toContain(value);
});

test.each(['swish-ebay-list', 'swish-market-value', 'swish-list-generate', ''])('%s does not gain a generic-specialist exception', operation => {
  expect(normalizeIdentifySpecialist('collectibles', operation, 'curiosities_collectibles')).toBe('curiosities_collectibles');
});

test.each(['coins', 'islamic_silver', 'tech', 'unknown', '', null, undefined, 5])('other specialist input %s is never remapped', requested => {
  expect(normalizeIdentifySpecialist('collectibles', 'swish-identify', requested)).toBe(requested);
});

test('compatibility runs inside the trusted module boundary and preserves authorization checks', () => {
  const source = fs.readFileSync('supabase/functions/_shared/moduleScope.ts', 'utf8');
  expect(source.indexOf('const nicheId=scope.niche_id;')).toBeLessThan(source.indexOf('normalizeIdentifySpecialist(nicheId,operation,body.specialistId)'));
  expect(source).toContain('normalizeIdentifySpecialist(nicheId,operation,body.specialist_id)');
  expect(source).toContain('!specialists.includes(value)');
  expect(source).toContain('tenant!==scope.tenant_id');
  expect(source).toContain("rpc('swish_can_access_niche'");
  expect(source).toContain('allowed.data!==true');
  expect(source).toContain('Resource is not in the active account and niche.');
  expect(source).toContain('specialistId:requestedSpecialistId ?? requestedSpecialistAlias ?? product.defaultSpecialist');
});
