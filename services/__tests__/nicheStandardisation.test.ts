// Executable pure/source regressions. Not installed-device, authenticated-subscriber or live eBay acceptance.
import fs from 'node:fs';
import { NICHE_MODULES, NICHES, PRODUCTION_NICHE_IDS, getNicheSpecialistIds, nicheIdForSpecialist } from '@/constants/niches';
import { SPECIALISTS } from '@/constants/specialists';
import { registeredSpecialistOwner } from '@/shared/moduleContracts';
import { getNicheWorkflowPolicy, nicheBarcodeAllowed } from '@/shared/nichePolicy';
import { MODULE_RESOURCE_ALIASES, moduleRequestAliasIssue } from '@/shared/moduleRequestContract';
import { getSpecialistProfile } from '@/shared/specialistIntelligence';
import { canonicalProductionSpecialist, getProductionNicheSpecialistIds, isRouteAllowedForModule } from '../nicheRouting';
import { nicheCaptureSlots } from '../nicheCaptureService';
import { quickCaptureSlots, quickBarcodeSupported, quickStartsWithBarcode, quickReviewIssue, barcodeAgreesWithPhotos } from '../quickListPolicyService';
import { classifyListing, nicheToSpecialistId } from '../nicheCategoryService';
import { inferImportNiche } from '@/shared/ebayImportScope';
const read = (path: string) => fs.readFileSync(path, 'utf8');
test.each(PRODUCTION_NICHE_IDS)('%s retains its expertise and uses a single role/ownership/policy contract', niche => {
  const product = NICHE_MODULES[niche], profile = getSpecialistProfile(niche)!;
  expect(profile.nicheId).toBe(niche);
  for (const key of ['recognition', 'conditionRules', 'valuationRules', 'listingRules'] as const) expect(profile[key].length).toBeGreaterThan(20);
  expect(profile.sources.length).toBeGreaterThan(0);
  expect(getNicheWorkflowPolicy(niche)).not.toBeNull();
  expect(NICHES[niche].defaultSpecialist).toBe(product.defaultSpecialist);
  expect(nicheToSpecialistId(niche)).toBe(product.defaultSpecialist);
  expect(getNicheSpecialistIds(niche)).toEqual(getProductionNicheSpecialistIds(niche));
  for (const specialist of getNicheSpecialistIds(niche)) {
    expect(registeredSpecialistOwner(specialist)).toBe(niche);
    expect(nicheIdForSpecialist(specialist)).toBe(niche);
    expect(registeredSpecialistOwner(canonicalProductionSpecialist(specialist)!)).toBe(niche);
  }
  for (const specialist of product.specialists) {
    const slots = nicheCaptureSlots(niche, specialist);
    expect(quickCaptureSlots(niche, specialist)).toEqual(slots);
    expect(new Set(slots.map(slot => slot.id)).size).toBe(slots.length);
    for (const original of SPECIALISTS[specialist as keyof typeof SPECIALISTS].captureRequirements.filter(slot => slot.required)) expect(slots).toEqual(expect.arrayContaining([expect.objectContaining({ id: original.id, required: true })]));
    const originalRequired = slots[0].required;
    slots[0].required = !originalRequired;
    expect(nicheCaptureSlots(niche, specialist)[0].required).toBe(originalRequired);
  }
  for (const other of PRODUCTION_NICHE_IDS.filter(id => id !== niche)) {
    expect(getNicheSpecialistIds(niche).some(id => getNicheSpecialistIds(other).includes(id))).toBe(false);
    expect(isRouteAllowedForModule('/' + NICHE_MODULES[other].entry.replace(/\.tsx$/, ''), niche)).toBe(false);
    expect(nicheCaptureSlots(niche, NICHE_MODULES[other].defaultSpecialist)).toEqual([]);
  }
});
test('Collectibles is barcode-first, ancient coin identification cannot accept barcode leads', () => {
  expect(quickStartsWithBarcode('collectibles')).toBe(true);
  expect(quickBarcodeSupported('coins')).toBe(false);
  expect(nicheBarcodeAllowed('unknown')).toBe(false);
  for (const niche of ['antiques', 'fossils', 'motocross', 'bicycles', 'trading_cards']) expect(nicheBarcodeAllowed(niche)).toBe(false);
  const result: any = { specialistId: 'coins', attributesConfirmed: { EAN: '4006381333931' }, evidenceContradictory: [] };
  const lead: any = { id: 'product', gtin: '4006381333931', title: 'Retail product', model: 'ABC' };
  expect(barcodeAgreesWithPhotos(lead, result)).toBe(false);
  expect(getSpecialistProfile('coins')?.recognition).toContain('Numista');
});
test('confidence thresholds preserve distinct Quick List and ordinary publication review', () => {
  expect(getNicheWorkflowPolicy('coins')?.publicationMinimum).toBe(0.95);
  expect(getNicheWorkflowPolicy('collectibles')).toMatchObject({ quickReviewMinimum: 0.7, publicationMinimum: 0.3 });
  const slots = quickCaptureSlots('coins'), images = slots.map(slot => ({ uri: 'file://' + slot.id, slotId: slot.id, slotLabel: slot.label }));
  const result: any = { specialistId: 'coins', confidence: 0.94, attributes: {}, evidenceContradictory: [] };
  expect(quickReviewIssue('coins', result, slots, images)).toContain('ambiguous');
  expect(quickReviewIssue('coins', { ...result, specialistId: 'collectibles' }, slots, images)).toContain('another specialist');
});
test('shared component capture retains mounts, exact part numbers and music disc roles', () => {
  for (const niche of ['motocross', 'bicycles'] as const) {
    const slots = nicheCaptureSlots(niche, NICHE_MODULES[niche].defaultSpecialist, 'part');
    expect(slots.map(slot => slot.id)).toEqual(expect.arrayContaining(['main', 'part_number', 'back', 'mounts', 'condition']));
    expect(quickCaptureSlots(niche, NICHE_MODULES[niche].defaultSpecialist, 'part')).toEqual(slots);
  }
  expect(nicheCaptureSlots('tunes_flip', 'vinyl_records', 'cd_box_set', 3).map(slot => slot.id)).toEqual(['front_sleeve', 'back_sleeve', 'disc_count', 'disc_1', 'disc_2', 'disc_3']);
});
test.each(MODULE_RESOURCE_ALIASES)('%s rejects conflicting compatibility identities', (_table, left, right) => {
  expect(moduleRequestAliasIssue({ [left]: 'allowed', [right]: 'other' })).not.toBeNull();
  expect(moduleRequestAliasIssue({ [left]: 'same', [right]: 'same' })).toBeNull();
});
test('tenant, niche, specialist and batched resource aliases cannot bypass the guard', () => {
  for (const [left, right] of [['tenantId', 'tenant_id'], ['nicheId', 'niche_id'], ['specialistId', 'specialist_id'], ['externalListingId', 'external_listing_id']]) expect(moduleRequestAliasIssue({ [left]: 'a', [right]: 'b' })).not.toBeNull();
  expect(moduleRequestAliasIssue({ itemIds: ['a'], item_ids: ['b'] })).not.toBeNull();
  expect(moduleRequestAliasIssue({ listingIds: ['a', 'b'], listing_ids: ['b', 'a'] })).toBeNull();
});
test('legacy IDs are read aliases; general and invented identities cannot create production stock', () => {
  expect(canonicalProductionSpecialist('clothing_specialist')).toBe('clothing');
  expect(canonicalProductionSpecialist('mx')).toBe('motocross');
  expect(canonicalProductionSpecialist('curiosities_collectibles')).toBeNull();
  expect(canonicalProductionSpecialist('invented')).toBeNull();
  const ids = getNicheSpecialistIds('collectibles'); ids.push('coins');
  expect(getNicheSpecialistIds('collectibles')).toEqual(['collectibles']);
});
test('import evidence conflicts and arbitrary numeric substrings never assign unrelated stock', () => {
  expect(inferImportNiche('Toys', 'Action figure')).toBe('collectibles');
  expect(inferImportNiche('Coins', 'Action figure')).toBeNull();
  expect(classifyListing('4726', 'Coins', 'Action figure').niche).toBe('unclassified');
  expect(classifyListing('1469', 'Other Collectables', '').niche).not.toBe('coins');
  expect(classifyListing(null, '1234726999', '').niche).toBe('unclassified');
  expect(classifyListing(null, '4726', '').niche).toBe('coins');
});
test('runtime wiring uses shared services and guards stale inbox/order callbacks', () => {
  const capture = read('hooks/useGenericCapture.ts');
  expect(capture).toContain('nicheCaptureSlots('); expect(capture).toContain('persistCapturedItemPhotos(tenant.id,id,visible.images)');
  expect(capture).not.toContain('uploadItemImages(');
  const inbox = read('app/ebay-messages.tsx'); expect(inbox).toContain('useEbayMessages'); expect(inbox).not.toContain('getSupabaseClient');
  const provider = read('contexts/EbayMessagesContext.tsx'); expect(provider).toContain('guard.isCurrent(scope)'); expect(provider).toContain('version !== sequence.current');
  expect(read('app/orders.tsx')).toContain('version !== loadVersion.current');
  expect(read('app/_layout.tsx')).toContain('<EbayMessagesProvider>');
  const boundary = read('supabase/functions/_shared/moduleScope.ts');
  expect(boundary).toContain('moduleRequestAliasIssue'); expect(boundary).toContain('nicheBarcodeAllowed(nicheId)'); expect(boundary).toContain('Resource is not in the active account and niche');
});
test('portable contracts remain byte-identical server deployment assets', () => {
  for (const name of ['nichePolicy.ts', 'moduleRequestContract.ts', 'ebayImportScope.ts', 'photoPersistence.ts']) expect(read('shared/' + name)).toBe(read('supabase/functions/_shared/' + name));
});
