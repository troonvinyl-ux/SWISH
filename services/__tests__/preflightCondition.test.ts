// Mocked/source regressions only; no live eBay publication or device acceptance.
jest.mock('@/template', () => ({ getSupabaseClient: jest.fn() }));
import fs from 'node:fs';
import { getSupabaseClient } from '@/template';
import { checkAntiqueListing, savePreflightCondition } from '../listingEditorService';
import { PRODUCTION_NICHE_IDS } from '@/constants/niches';
import { selectAntiqueCondition } from '@/shared/antiqueListingPolicy';
const photo = 'https://storage.test/photo.jpg';
const policy = { categoryId: '176984', itemConditionRequired: true, itemConditions: [{ conditionId: '1000', conditionDescription: 'New' }, { conditionId: '4000', conditionDescription: 'Very Good' }] };
const input = { tenantId: 'tenant', listingId: 'draft', nicheId: 'tunes_flip', categoryId: policy.categoryId, conditionId: '4000' };
const item = { id: 'item', tenant_id: 'tenant', specialist_id: 'vinyl_records', updated_at: 'v1', media: [photo], condition: 'Very Good', condition_notes: 'Visible scratch on case', quantity: 1, attributes: { ebay_category_id: policy.categoryId, ebay_condition_id: '', ebay_item_specifics: [{ name: 'Artist', value: 'Various' }], media_grade: 'VG', sleeve_grade: 'VG', ebay_listing_media: [photo], marker: 'Preserve me' } };
const row = { id: 'draft', item_id: 'item', category_id: policy.categoryId, status: 'draft', price: 8, title: 'March Of The Mods CD set', description: 'Two-disc set; visible scratch on case.', items: item };
function chain(result: any) {
  const q: any = {};
  for (const method of ['eq', 'in', 'select', 'update']) q[method] = jest.fn(() => q);
  q.maybeSingle = jest.fn().mockResolvedValue(result);
  return q;
}
function setup(options: { source?: any; readback?: any; saveResult?: any; conditions?: any; aspects?: any } = {}) {
  const read = chain({ data: options.source ?? row, error: null });
  const write = chain(options.saveResult ?? { data: { id: 'item' }, error: null });
  const confirm = chain({ data: options.readback ?? { ...row, items: { ...item, attributes: { ...item.attributes, ebay_condition_id: '4000' } } }, error: null });
  const from = jest.fn().mockReturnValueOnce(read).mockReturnValueOnce(write).mockReturnValueOnce(confirm);
  const invoke = jest.fn().mockImplementation((_name, { body }) => Promise.resolve({ data: body.route === 'validate_category' ? { valid: true, isLeaf: true } : body.route === 'get_category_aspects' ? { success: true, aspects: options.aspects ?? [] } : options.conditions ?? { success: true, policy }, error: null }));
  (getSupabaseClient as jest.Mock).mockReturnValue({ from, functions: { invoke } });
  return { read, write, confirm, from, invoke };
}
beforeEach(() => jest.clearAllMocks());
test('CD preflight identifies the missing condition and supplies actual options', async () => {
  setup();
  const result = await checkAntiqueListing('tenant', 'draft', 'tunes_flip');
  expect(result.ready).toBe(false); expect(result.issue).toBe('condition');
  expect(result.conditionPolicy).toEqual(policy); expect(result.categoryId).toBe('176984');
  expect(result.error).not.toMatch(/refurbished/);
});
test('valid saved CD condition and pressing review pass all supported draft checks', async () => {
  setup({ source: { ...row, items: { ...item, attributes: { ...item.attributes, ebay_condition_id: '4000', pressing_reviewed: 'true' } } } });
  expect((await checkAntiqueListing('tenant', 'draft', 'tunes_flip')).ready).toBe(true);
});
test('missing specifics are not misreported as a missing condition', async () => {
  setup({ source: { ...row, items: { ...item, attributes: { ...item.attributes, ebay_condition_id: '4000' } } }, aspects: [{ localizedAspectName: 'Brand', aspectConstraint: { aspectRequired: true } }] });
  const result = await checkAntiqueListing('tenant', 'draft', 'tunes_flip');
  expect(result.ready).toBe(false); expect(result.issue).toBeUndefined(); expect(result.error).toMatch(/Brand/); expect(result.conditionPolicy).toEqual(policy);
});
test('save changes only the confirmed ID, preserves all grades, notes, photos and attributes', async () => {
  const { write, invoke } = setup();
  expect((await savePreflightCondition(input)).error).toBeNull();
  expect(write.update).toHaveBeenCalledWith({ attributes: { ...item.attributes, ebay_condition_id: '4000' } });
  expect(write.eq).toHaveBeenCalledWith('tenant_id', 'tenant'); expect(write.eq).toHaveBeenCalledWith('updated_at', 'v1');
  expect(write.in).toHaveBeenCalledWith('specialist_id', expect.arrayContaining(['vinyl_records']));
  expect(invoke).toHaveBeenCalledWith('swish-ebay-list', { body: { route: 'get_condition_policies', tenantId: 'tenant', categoryId: '176984' } });
  expect(invoke.mock.calls.every((call: any[]) => call[1].body.route !== 'publish')).toBe(true);
});
test('unsupported condition is not saved or inferred from music grades', async () => {
  const { write } = setup(); expect((await savePreflightCondition({ ...input, conditionId: '2500' })).error).toMatch(/supported/); expect(write.update).not.toHaveBeenCalled();
});
test('a category change blocks stale choices', async () => {
  const { write, invoke } = setup({ source: { ...row, category_id: 'other' } });
  expect((await savePreflightCondition(input)).error).toMatch(/category changed/); expect(write.update).not.toHaveBeenCalled(); expect(invoke).not.toHaveBeenCalled();
});
test('metadata from another category is not trusted', async () => {
  const { write } = setup({ conditions: { success: true, policy: { ...policy, categoryId: 'other' } } });
  expect((await savePreflightCondition(input)).error).not.toBeNull(); expect(write.update).not.toHaveBeenCalled();
});
test('taxonomy failure cannot clear or fabricate a condition', async () => {
  const { write } = setup({ conditions: { success: false, error: 'Conditions unavailable' } });
  expect((await savePreflightCondition(input)).error).toBe('Conditions unavailable'); expect(write.update).not.toHaveBeenCalled();
});
test('concurrent item edit is detected instead of overwritten', async () => {
  const { from } = setup({ saveResult: { data: null, error: null } });
  expect((await savePreflightCondition(input)).error).toMatch(/item changed/); expect(from).toHaveBeenCalledTimes(2);
});
test('readback must confirm the selected ID before claiming success', async () => {
  setup({ readback: row }); expect((await savePreflightCondition(input)).error).toMatch(/could not be confirmed/);
});
test('live listing cannot be silently changed from preflight', async () => {
  const { write } = setup({ source: { ...row, external_listing_id: 'ebay-id', status: 'active' } });
  expect((await savePreflightCondition(input)).error).toMatch(/private draft/); expect(write.update).not.toHaveBeenCalled();
});
test('explicitly condition-disabled categories still omit IDs', () => {
  expect(selectAntiqueCondition({ categoryId: 'category', itemConditionRequired: false, itemConditions: [] }, '')).toEqual({ id: '', error: null });
});
test.each(PRODUCTION_NICHE_IDS)('%s uses the shared condition workflow and keeps the submission gate', () => {
  const preflight = fs.readFileSync('app/listing-preflight.tsx', 'utf8');
  const editor = fs.readFileSync('app/ebay-listing-editor.tsx', 'utf8');
  expect(preflight).toContain('<PreflightConditionCard'); expect(preflight).toContain('(!isAntique || antiqueReady)'); expect(preflight).toContain("antique.issue === 'condition'"); expect(editor).toContain('<EbayConditionPicker');
});
test('music persistence migration preserves the installed function and requires its known registry marker', () => {
  const sql = fs.readFileSync('supabase/migrations/20261108_tunes_editor_condition_persistence.sql', 'utf8');
  expect(sql).toContain('pg_get_functiondef'); expect(sql).toContain("''collectibles'',''tunes_flip'') into v_antique"); expect(sql).toContain('raise exception'); expect(sql).not.toMatch(/update public\.(items|listings)/i);
});
test('shared condition policy and Edge copy remain identical', () => {
  expect(fs.readFileSync('shared/antiqueListingPolicy.ts', 'utf8')).toBe(fs.readFileSync('supabase/functions/_shared/antiqueListingPolicy.ts', 'utf8'));
});
