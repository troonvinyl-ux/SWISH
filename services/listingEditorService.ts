import { availableListingPhotos, preferredListingPhotos } from '@/shared/smartStudio';
import { photoPersistenceIssue } from '@/shared/photoPersistence';
import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { getProductionNicheSpecialistIds } from './nicheRouting';
import { normalizeAntiqueAspects, validateAntiqueSpecifics, selectAntiqueCondition, validateAntiqueListingBasics, type AntiqueConditionPolicy } from '@/shared/antiqueListingPolicy';
export interface EditorSave {
  tenantId: string; listingId: string; title: string; description: string;
  price: string; shippingCost: string; floorPrice: string; ceilingPrice: string;
  categoryId: string; categoryName: string; condition: string; conditionDescription: string;
  quantity: string; sku: string; itemSpecifics: Array<{ name: string; value: string }>;
  nicheId?: string; conditionId?: string; media?: string[];
  listingOptions?: { listingType: 'FixedPriceItem' | 'Chinese'; auctionDays: number; startPrice: string; reservePrice: string; bestOfferEnabled: boolean; dispatchDays: number };
}
export async function loadListingEditor(tenantId: string, listingId: string, nicheId: string) {
  const specialists = getProductionNicheSpecialistIds(nicheId);
  if (!specialists.length) return { data: null, error: 'A valid niche is required' };
  const { data, error } = await getSupabaseClient().from('listings')
    .select('*, items!inner(*)').eq('tenant_id', tenantId).eq('items.tenant_id', tenantId).eq('id', listingId)
    .in('items.specialist_id', specialists).maybeSingle();
  return { data, error: error?.message ?? (!data ? 'Listing not found in this niche' : null) };
}
export async function invokeListingOperation(body: Record<string, unknown>, functionName = 'swish-ebay-list'): Promise<{ data: any; error: string | null }> {
  const endpoint = body.route === 'get_category_aspects' && functionName === 'swish-ebay-list' ? 'swish-ebay-category' : functionName;
  try {
    const { data, error } = await getSupabaseClient().functions.invoke(endpoint, { body });
    if (error) {
      let message = error.message;
      if (error instanceof FunctionsHttpError) {
        try { const parsed = JSON.parse(await error.context.text()); message = `[HTTP ${error.context.status}] ${parsed.error ?? message}`; }
        catch { /* Do not expose raw HTML/provider bodies. */ }
      }
      return { data: null, error: message };
    }
    if (body.route === 'get_category_aspects' && data?.success && Array.isArray(data.aspects)) {
      const normalized = data.aspects.map((aspect: any) => ({ ...aspect,
        aspectName: String(aspect.aspectName ?? aspect.localizedAspectName ?? aspect.name ?? ''),
        aspectConstraint: { ...(aspect.aspectConstraint ?? {}), aspectRequired: aspect.aspectConstraint?.aspectRequired === true || aspect.required === true,
          aspectUsage: aspect.aspectConstraint?.aspectUsage ?? aspect.usage ?? (aspect.required ? 'REQUIRED' : 'OPTIONAL') },
        aspectValues: aspect.aspectValues ?? (aspect.values ?? []).map((value: string) => ({ localizedValue: value })),
      }));
      if (normalized.some((aspect: any) => !aspect.aspectName && aspect.aspectConstraint.aspectRequired)) return { data:null,error:'Marketplace returned unnamed required fields. Retry taxonomy lookup before publishing.' };
      return { data:{ ...data,aspects:normalized },error:data.error ?? null };
    }
    return { data, error: data?.error ?? null };
  } catch { return { data: null, error: 'Marketplace request failed. No successful operation was inferred.' }; }
}
export interface AntiqueCategoryHint { label: string; query: string; note: string; ceramic: boolean }
export interface AntiqueCategoryCandidate { id: string; name: string; categoryPath: string; isLeaf: true }
export interface AntiqueCategoryItem { canonicalTitle: string; specialistId: string; attributes?: Record<string, unknown>; material?: string }
/** A category search lead, not proof of a maker, date, provenance or authenticity. */
export function getAntiqueCategoryHint(item: AntiqueCategoryItem): AntiqueCategoryHint | null {
  if (!getProductionNicheSpecialistIds('antiques').includes(item.specialistId as any)) return null;
  const attrs = item.attributes ?? {};
  const evidence = [item.canonicalTitle, item.material, attrs.material, attrs.object_type, attrs.type].filter(value => typeof value === 'string').join(' ');
  const ceramic = /\b(pottery|ceramics?|porcelain|terracotta|terra cotta|earthenware|stoneware|lekanis|lekane|lekythos|amphora|krater|kylix|oinochoe|red[ -]figure|black[ -]figure)\b/i.test(evidence);
  if (!ceramic) return { label: 'Search by identified object', query: item.canonicalTitle.trim().slice(0, 100), note: 'Choose the current eBay category that fits the object; suggestions are not confirmed identifications.', ceramic: false };
  const object = item.canonicalTitle.match(/\b(lekanis|lekane|lekythos|amphora|krater|kylix|oinochoe|vase|bowl|plate|figurine|lid)\b/i)?.[0]?.toLowerCase() ?? '';
  const lid = /\blid\b/i.test(item.canonicalTitle) && object !== 'lid' ? ' lid' : '';
  return { label: 'Pottery / ceramics', query: `pottery ceramic ${object}${lid}`.trim(), note: 'Search pottery or ceramic categories. Apulian-style decoration does not establish ancient origin or authenticity; use an antiquities category only after evidence review.', ceramic: true };
}
export function rankAntiqueCategoryCandidates(raw: unknown, hint: AntiqueCategoryHint): AntiqueCategoryCandidate[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.filter((value: any) => {
    if (!value?.id || !value?.name || value.isLeaf !== true || seen.has(String(value.id))) return false;
    const path = `${value.categoryPath ?? ''} ${value.name}`;
    if (hint.ceramic && (!/pottery|ceramic|porcelain|earthenware|stoneware|terracotta/i.test(path) || /\b(coins?|banknotes?|militaria|military)\b/i.test(path))) return false;
    seen.add(String(value.id)); return true;
  }).map((value: any) => ({ id: String(value.id), name: String(value.name), categoryPath: String(value.categoryPath ?? value.name), isLeaf: true as const })).slice(0, 6);
}
/** Lookup uses existing eBay Taxonomy integration; no AI-generated category IDs or writes. */
export async function suggestAntiqueCategories(tenantId: string, item: AntiqueCategoryItem) {
  const hint = getAntiqueCategoryHint(item);
  if (!tenantId || !hint || hint.query.length < 2) return { suggestions: [] as AntiqueCategoryCandidate[], source: '', error: 'An Antique item and tenant are required.' };
  let lastError: string | null = null;
  for (const endpoint of ['swish-ebay-category', 'swish-ebay-list']) {
    const result = await invokeListingOperation({ route: 'get_category_suggestions', tenantId, query: hint.query }, endpoint);
    if (result.error || !result.data?.success) { lastError = result.error ?? 'Category lookup unavailable.'; continue; }
    const suggestions = rankAntiqueCategoryCandidates(result.data.suggestions, hint);
    if (suggestions.length) return { suggestions, source: String(result.data.source ?? 'unknown'), error: null };
    lastError = hint.ceramic ? 'No suitable pottery/ceramic leaf category was returned. Search the live category browser; no unrelated category has been selected.' : 'No matching category was returned. Try the category browser.';
  }
  return { suggestions: [] as AntiqueCategoryCandidate[], source: '', error: lastError };
}
export async function saveListingEditor(input: EditorSave): Promise<{ error: string | null }> {
  const amounts = [input.price,input.shippingCost,input.floorPrice,input.ceilingPrice].map(Number);
  const quantity = Number(input.quantity);
  if (!input.title.trim() || input.title.length > 80 || amounts.some(amount => !Number.isFinite(amount) || amount < 0) || !Number.isInteger(quantity) || quantity < 1) return { error: 'Enter a valid title, non-negative prices, and positive whole quantity.' };
  const specifics = input.itemSpecifics.filter(specific => specific.name.trim() && specific.value.trim()).map(specific => ({ name: specific.name.trim(), value: specific.value.trim() }));
  const names = new Set(specifics.map(specific => specific.name.toLowerCase()));
  if (specifics.length > 25 || names.size !== specifics.length || specifics.some(specific => specific.name.length > 65 || specific.value.length > 65)) return { error: 'Item specifics must be unique, at most 25, and no more than 65 characters per name/value. Values were not truncated.' };
  const antique = Boolean(input.nicheId && getProductionNicheSpecialistIds(input.nicheId).length);
  if (antique && input.conditionDescription.length > 1000) return { error: 'eBay condition notes support at most 1,000 characters.' };
  const { data, error } = await getSupabaseClient().rpc('swish_save_listing_editor', {
    p_tenant_id: input.tenantId, p_listing_id: input.listingId,
    p_listing_patch: { title: input.title.trim(), description: input.description, price: amounts[0], shipping_cost: amounts[1], floor_price: amounts[2], ceiling_price: amounts[3], category_id: input.categoryId || null },
    p_item_patch: { condition: input.condition, condition_grade: input.conditionDescription, quantity, sku: input.sku.trim(), ebay_category_id: input.categoryId, ebay_category_name: input.categoryName,
      ...(antique ? { condition_notes: input.conditionDescription, ebay_condition_id: input.conditionId ?? '', ...(input.media ? { ebay_listing_media: input.media } : {}), ...(input.listingOptions ? { ebay_listing_options: input.listingOptions } : {}) } : {}) },
    p_specifics: specifics,
  });
  if (error || !data) return { error: error?.message ?? 'Save was not confirmed' };
  if (antique) {
    const readback = await loadListingEditor(input.tenantId, input.listingId, input.nicheId!);
    const row = readback.data as any; const item = row?.items; const attrs = item?.attributes ?? {};
    const sameSpecifics = Array.isArray(attrs.ebay_item_specifics) && attrs.ebay_item_specifics.length === specifics.length && specifics.every((specific,index) => attrs.ebay_item_specifics[index]?.name === specific.name && attrs.ebay_item_specifics[index]?.value === specific.value);
    const sameOptions = !input.listingOptions || Object.entries(input.listingOptions).every(([key,value]) => attrs.ebay_listing_options?.[key] === value);
    const sameMedia = !input.media || Array.isArray(attrs.ebay_listing_media) && attrs.ebay_listing_media.length === input.media.length && input.media.every((url,index)=>attrs.ebay_listing_media[index]===url);
    if (readback.error || !row || row.title !== input.title.trim() || row.description !== input.description || Number(row.price) !== amounts[0] || Number(row.shipping_cost) !== amounts[1] || Number(row.floor_price) !== amounts[2] || Number(row.ceiling_price) !== amounts[3] || String(row.category_id ?? '') !== input.categoryId || item?.condition !== input.condition || item?.condition_notes !== input.conditionDescription || Number(item?.quantity) !== quantity || item?.sku !== input.sku.trim() || !sameSpecifics || !sameOptions || !sameMedia || String(attrs.ebay_condition_id ?? '') !== String(input.conditionId ?? '') || attrs.ebay_category_name !== input.categoryName) {
      return { error: 'Save completed but persisted fields could not be confirmed. Reload the draft before submission; do not create another draft.' };
    }
  }
  return { error: null };
}
export async function saveAntiqueCategory(tenantId: string, itemId: string, categoryId: string, categoryName: string) {
  const taxonomy = await invokeListingOperation({ route: 'get_category_aspects', tenantId, categoryId, forceLive: true });
  if (taxonomy.error || taxonomy.data?.isLeaf !== true) return { attributes: null, error: taxonomy.error ?? 'Selected category could not be verified against eBay. Nothing was saved.' };
  const client = getSupabaseClient();
  const { data: row, error } = await client.from('items').select('attributes,updated_at').eq('id', itemId).eq('tenant_id', tenantId).in('specialist_id', getProductionNicheSpecialistIds('antiques')).maybeSingle();
  if (error || !row) return { attributes: null, error: error?.message ?? 'Antique item not found.' };
  const attributes = { ...row.attributes, ebay_category_id: categoryId, ebay_category_name: categoryName };
  const saved = await client.from('items').update({ attributes }).eq('id', itemId).eq('tenant_id', tenantId).eq('updated_at', row.updated_at).select('attributes').maybeSingle();
  if (saved.error || !saved.data) return { attributes: null, error: saved.error?.message ?? 'The item changed during category selection. Reload and retry.' };
  const persisted = await client.from('items').select('attributes').eq('id', itemId).eq('tenant_id', tenantId).maybeSingle();
  if (persisted.error || persisted.data?.attributes?.ebay_category_id !== categoryId) return { attributes: null, error: 'Category saved but reload could not confirm it. Reload this item before continuing.' };
  return { attributes: persisted.data.attributes, error: null };
}
export interface SpecialistPreflightResult {
  ready: boolean; error: string | null; issue?: 'condition';
  conditionPolicy?: AntiqueConditionPolicy; conditionId?: string; categoryId?: string;
}
/** Read-only preflight via the existing Taxonomy/Metadata API; never a live publication. */
export async function checkAntiqueListing(tenantId: string, listingId: string, nicheId = 'antiques'): Promise<SpecialistPreflightResult> {
  try {
    const loaded = await loadListingEditor(tenantId, listingId, nicheId);
    if (loaded.error || !loaded.data) return { ready: false, error: loaded.error };
    const row: any = loaded.data; const item = row.items; const attributes = item.attributes ?? {};
    const photoIssue = photoPersistenceIssue(item.media ?? [], attributes);
    if(photoIssue)return {ready:false,error:photoIssue};
    const categoryId = String(row.category_id ?? '');
    if (!categoryId || attributes.ebay_category_id !== categoryId) return { ready: false, error: 'Save the same category on this draft and inventory item before submitting.' };
    const [aspects, conditions, validation] = await Promise.all([
      invokeListingOperation({ route: 'get_category_aspects', tenantId, categoryId, forceLive: true }),
      invokeListingOperation({ route: 'get_condition_policies', tenantId, categoryId }),
      invokeListingOperation({ route: 'validate_category', tenantId, categoryId }, 'swish-ebay-category'),
    ]);
    if (validation.error || validation.data?.valid !== true || validation.data?.isLeaf !== true) return { ready: false, error: validation.error ?? 'The current eBay category could not be verified. No publication allowed.' };
    if (aspects.error || aspects.data?.success !== true) return { ready: false, error: aspects.error ?? 'Current category-specific requirements unavailable.' };
    if (conditions.error || conditions.data?.success !== true || !conditions.data?.policy) return { ready: false, error: conditions.error ?? 'Current condition requirements unavailable.' };
    const conditionPolicy = conditions.data.policy as AntiqueConditionPolicy;
    const conditionId = String(attributes.ebay_condition_id ?? '');
    const condition = selectAntiqueCondition(conditionPolicy, conditionId);
    if (condition.error) return { ready: false, error: 'Choose the eBay condition that matches this item.', issue: 'condition', conditionPolicy, conditionId, categoryId };
    const specifics = Array.isArray(attributes.ebay_item_specifics) ? attributes.ebay_item_specifics : [];
    const missing = validateAntiqueSpecifics(specifics, normalizeAntiqueAspects(aspects.data.aspects));
    if (missing) return { ready: false, error: missing, conditionPolicy, conditionId, categoryId };
    const originalMedia = item.media ?? [];
    const allowedMedia = availableListingPhotos(originalMedia, attributes);
    const media = Array.isArray(attributes.ebay_listing_media) ? attributes.ebay_listing_media : preferredListingPhotos(originalMedia, attributes);
    if (media.some((url: string) => !allowedMedia.includes(url))) return { ready: false, error: 'Select original or accepted clean photos linked to this inventory item.' };
    const options = attributes.ebay_listing_options ?? {};
    const price = options.listingType === 'Chinese' ? Number(options.startPrice) : Number(row.price);
    const basic = validateAntiqueListingBasics({ title: row.title, description: row.description, price, quantity: Number(item.quantity ?? 1), media });
    if (basic) return { ready: false, error: basic };
    return { ready: true, error: null, conditionPolicy, conditionId, categoryId };
  } catch { return { ready: false, error: 'Specialist preflight could not run. No successful validation was inferred.' }; }
}

/** User-confirmed condition only. Does not change grades, notes, photos or publish. */
export async function savePreflightCondition(input: { tenantId: string; listingId: string; nicheId: string; categoryId: string; conditionId: string }): Promise<{ error: string | null }> {
  try {
    const loaded = await loadListingEditor(input.tenantId, input.listingId, input.nicheId);
    if (loaded.error || !loaded.data) return { error: loaded.error ?? 'Draft not found in this workspace.' };
    const row: any = loaded.data;
    const item = row.items;
    if (row.external_listing_id || ['live','active','published','publishing','sold','ended'].includes(row.status)) return { error: 'This is no longer a private draft. Reopen its listing editor.' };
    if (!input.categoryId || String(row.category_id ?? '') !== input.categoryId || String(item?.attributes?.ebay_category_id ?? '') !== input.categoryId) return { error: 'The category changed. Recheck the draft before choosing its condition.' };
    const result = await invokeListingOperation({ route: 'get_condition_policies', tenantId: input.tenantId, categoryId: input.categoryId });
    if (result.error || !result.data?.success || !result.data?.policy || String(result.data.policy.categoryId) !== input.categoryId) return { error: result.error ?? 'Current category conditions could not be confirmed. Recheck and retry.' };
    const selected = selectAntiqueCondition(result.data.policy, input.conditionId);
    if (selected.error || !selected.id) return { error: selected.error ?? 'Choose a supported condition.' };
    if (!item?.id || !item.updated_at) return { error: 'Draft version unavailable. Reload before saving.' };
    const client = getSupabaseClient();
    const saved = await client.from('items').update({ attributes: { ...item.attributes, ebay_condition_id: selected.id } })
      .eq('id', item.id).eq('tenant_id', input.tenantId).in('specialist_id', getProductionNicheSpecialistIds(input.nicheId))
      .eq('updated_at', item.updated_at).select('id').maybeSingle();
    if (saved.error || !saved.data) return { error: saved.error?.message ?? 'The item changed while saving. Recheck before retrying.' };
    const readback = await loadListingEditor(input.tenantId, input.listingId, input.nicheId);
    const persisted: any = readback.data;
    if (readback.error || !persisted || String(persisted.category_id) !== input.categoryId || String(persisted.items?.attributes?.ebay_category_id) !== input.categoryId || String(persisted.items?.attributes?.ebay_condition_id) !== selected.id) return { error: 'Saved condition could not be confirmed. Recheck the draft; nothing was published.' };
    return { error: null };
  } catch { return { error: 'Condition save was not confirmed. Recheck the draft before retrying.' }; }
}
