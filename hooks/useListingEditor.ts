import { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from './useApp';
import { loadListingEditor, saveListingEditor, invokeListingOperation, type EditorSave } from '@/services/listingEditorService';
export interface ListingEditorState extends EditorSave {
  itemId: string; externalListingId: string; status: string; media: string[]; specialistId: string; itemAttributes?: Record<string, any>;
  inventoryId: string; valuationMid: number; itemTitle: string; subtitle: string;
  listingType: 'FixedPriceItem' | 'Chinese'; auctionDays: number; startPrice: string; reservePrice: string; bestOfferEnabled: boolean; dispatchDays: number;
}
interface Aspect { name: string; required: boolean; values: string[] }
export function useListingEditor(listingId: string) {
  const { tenant, fixedNicheId, activeNicheId, triggerInventoryReload } = useApp();
  const scope = `${tenant?.id}:${fixedNicheId ?? activeNicheId}:${listingId}`;
  const currentScope = useRef(scope); currentScope.current = scope;
  const [state, setState] = useState<ListingEditorState | null>(null); const [loadedScope, setLoadedScope] = useState('');
  const [loading, setLoading] = useState(false); const [busy, setBusy] = useState(false); const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null); const [aspects, setAspects] = useState<Aspect[]>([]);
  const [categories, setCategories] = useState<any[]>([]); const [categorySource, setCategorySource] = useState('');
  const requirements = useCallback(async (categoryId: string) => {
    if (!tenant || !categoryId) return;
    const result = await invokeListingOperation({ route: 'get_category_aspects', tenantId: tenant.id, categoryId });
    if (currentScope.current !== scope) return;
    if (result.error || !result.data?.success) { setError(result.error ?? 'Category requirements unavailable; publishing will re-check.'); return; }
    const normalized: Aspect[] = (result.data.aspects ?? []).map((aspect: any) => ({ name: String(aspect.aspectName ?? aspect.localizedAspectName ?? ''), required: aspect.aspectConstraint?.aspectRequired === true || aspect.aspectConstraint?.aspectUsage === 'REQUIRED', values: (aspect.aspectValues ?? []).map((value: any) => String(value.localizedValue ?? '')).filter(Boolean) })).filter((aspect: Aspect) => aspect.name);
    setAspects(normalized);
    setState(previous => {
      if (!previous) return previous;
      const names = new Set(previous.itemSpecifics.map(specific => specific.name.toLowerCase()));
      const missing = normalized.filter(aspect => aspect.required && !names.has(aspect.name.toLowerCase())).map(aspect => ({ name: aspect.name, value: '' }));
      return { ...previous, itemSpecifics: [...previous.itemSpecifics, ...missing] };
    });
  }, [tenant?.id, scope]);
  const load = useCallback(async () => {
    if (!tenant || !listingId) return;
    setLoading(true); setError(null);
    try {
      const result = await loadListingEditor(tenant.id, listingId, fixedNicheId ?? activeNicheId);
      if (currentScope.current !== scope) return;
      if (result.error || !result.data) { setError(result.error); return; }
      const row: any = result.data; const item = row.items ?? {}; const attrs = item.attributes ?? {};
      const isCoin = ['coins','islamic_silver','banknotes','gold','silver','coins_uk','coins_world','coins_currency'].includes(item.specialist_id);
      const specifics: Array<{ name: string; value: string }> = Array.isArray(attrs.ebay_item_specifics) ? attrs.ebay_item_specifics.filter((specific: any) => typeof specific?.name === 'string' && typeof specific?.value === 'string').map((specific: any) => ({ name: specific.name, value: specific.value })) : [];
      const names = new Set(specifics.map(specific => specific.name.toLowerCase()));
      for (const [key,value] of Object.entries(attrs)) {
        if (key.startsWith('_') || /^(ebay|numista|inferred|identification|valuation|batch|capture|niche|classification)/i.test(key) || typeof value !== 'string' || !value.trim() || value.length > 65) continue;
        const name = isCoin && key === 'material' ? 'Metal' : key.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
        if (!names.has(name.toLowerCase())) { specifics.push({ name, value }); names.add(name.toLowerCase()); }
      }
      const categoryId = String(row.category_id ?? attrs.ebay_category_id ?? '');
      setState({ tenantId: tenant.id, listingId: row.id, itemAttributes: attrs, itemId: item.id, externalListingId: row.external_listing_id ?? '', status: row.status, title: row.title ?? '', description: row.description ?? '', price: String(row.price ?? 0), shippingCost: String(row.shipping_cost ?? 0), floorPrice: String(row.floor_price ?? 0), ceilingPrice: String(row.ceiling_price ?? 0), categoryId, categoryName: String(attrs.ebay_category_name ?? categoryId), condition: item.condition ?? '', conditionDescription: item.condition_grade ?? '', quantity: String(item.quantity ?? 1), sku: item.sku ?? '', itemSpecifics: specifics, media: item.media ?? [], specialistId: item.specialist_id ?? '', inventoryId: item.inventory_id ?? '', valuationMid: Number(item.valuation_mid ?? 0), itemTitle: item.canonical_title ?? '', subtitle: '', listingType: 'FixedPriceItem', auctionDays: 7, startPrice: String(row.price ?? 0), reservePrice: '', bestOfferEnabled: false, dispatchDays: 3 });
      setLoadedScope(scope); setDirty(false); setAspects([]);
      if (categoryId) await requirements(categoryId);
    } finally { if (currentScope.current === scope) setLoading(false); }
  }, [tenant?.id, listingId, fixedNicheId, activeNicheId, scope, requirements]);
  useEffect(() => { void load(); }, [load]);
  const update = <K extends keyof ListingEditorState>(key: K, value: ListingEditorState[K]) => { setState(previous => previous ? { ...previous, [key]: value } : null); setDirty(true); };
  const save = async (): Promise<boolean> => {
    if (!state || busy || loadedScope !== scope) return false;
    setBusy(true); setError(null);
    try { const result = await saveListingEditor(state); if (currentScope.current !== scope) return false; if (result.error) { setError(result.error); return false; } setDirty(false); triggerInventoryReload(); return true; }
    finally { setBusy(false); }
  };
  const categoriesLookup = async (query: string, parentId = '') => {
    if (!tenant) return;
    setBusy(true); setError(null);
    try {
      const body = { tenantId: tenant.id, route: query.trim() ? 'get_category_suggestions' : 'get_category_children', query: query.trim(), parentId };
      let result = await invokeListingOperation(body, 'swish-ebay-category');
      if (result.error || !result.data?.success) result = await invokeListingOperation(body);
      if (currentScope.current !== scope) return;
      if (result.error || !result.data?.success) { setError(result.error ?? 'Category lookup unavailable'); return; }
      setCategories(result.data.suggestions ?? result.data.children ?? []); setCategorySource(result.data.source ?? 'unknown');
    } finally { setBusy(false); }
  };
  const chooseCategory = async (category: any) => {
    if (!category.isLeaf) { await categoriesLookup('', category.id); return; }
    update('categoryId', String(category.id)); update('categoryName', String(category.name)); setCategories([]); await requirements(String(category.id));
  };
  const revise = async (skuOnly = false): Promise<string | null> => {
    if (!state?.externalListingId) return 'This listing is not published on eBay';
    if (!await save()) return 'Local save failed; no eBay revision was sent';
    setBusy(true);
    try {
      const result = await invokeListingOperation({ route: skuOnly ? 'revise_sku' : 'revise', tenantId: state.tenantId, listingId: state.listingId, externalListingId: state.externalListingId,
        ...(skuOnly ? { sku: state.sku } : { title: state.title, description: state.description, price: Number(state.price), categoryId: state.categoryId, condition: state.condition, conditionDescription: state.conditionDescription, listingType: state.listingType, quantity: Number(state.quantity), sku: state.sku, startPrice: Number(state.startPrice), reservePrice: state.reservePrice ? Number(state.reservePrice) : undefined, bestOfferEnabled: state.bestOfferEnabled, dispatchDays: state.dispatchDays, itemSpecifics: state.itemSpecifics.filter(specific => specific.name && specific.value), mediaUrls: state.media.filter(url => url.startsWith('https://')) }) });
      if (result.error || !result.data?.success) return result.error ?? 'eBay revision was not confirmed';
      return result.data.warning ?? result.data.warnings?.join('\n') ?? null;
    } finally { setBusy(false); }
  };
  const generate = async (field: 'title' | 'description') => {
    if (!state || busy) return;
    setBusy(true);
    try { const result = await invokeListingOperation({ item_id: state.itemId, tenant_id: state.tenantId, marketplace_id: 'ebay', fields: [field] }, 'swish-list-generate'); if (result.error || !result.data?.listing?.[field]) setError(result.error ?? 'Generation returned no field'); else update(field, result.data.listing[field]); }
    finally { setBusy(false); }
  };
  return { data: loadedScope === scope ? state : null, loading, busy, dirty, error, aspects, categories, categorySource, update, save, revise, generate, categoriesLookup, chooseCategory, reload: load };
}
