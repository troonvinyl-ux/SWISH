import { useState, useEffect, useRef, useCallback } from 'react';
import { availableListingPhotos, preferredListingPhotos, selectedListingPhotos, processedListingPhotoIssue } from '@/shared/smartStudio';
import { moveMainImageFirst } from '@/services/itemPhotoService';
import { recoverCapturedItemPhotos } from '@/services/capturedPhotoRecoveryService';
import { reviseSavedListing, inspectLiveListing } from '@/services/ebayRevisionService';
import type { LiveListingContent } from '@/shared/ebayRevisionContract';
import { useApp } from './useApp';
import { useAuth } from '@/template';
import { automaticCondition, automaticSpecifics, inventoryIdentification } from '@/services/listingAutofillService';
import { existingOriginalPhotos, processExistingItemPhoto } from '@/services/existingImageStudioService';
import { getItem } from '@/services/itemService';
import { submitListingToMarketplace } from '@/services/listingService';
import { isProductionNiche } from '@/constants/niches';
import { getSpecialistProfile, mappedSpecialistSpecifics } from '@/shared/specialistIntelligence';
import { loadListingEditor, saveListingEditor, invokeListingOperation, type EditorSave } from '@/services/listingEditorService';
import { normalizeAntiqueAspects, seedAntiqueSpecifics, type AntiqueAspect, type AntiqueConditionPolicy } from '@/shared/antiqueListingPolicy';
export interface ListingEditorState extends EditorSave {
  itemId: string; externalListingId: string; status: string; media: string[]; availableMedia: string[]; specialistId: string; itemAttributes?: Record<string, any>;
  inventoryId: string; valuationMid: number; itemTitle: string; subtitle: string; conditionId: string;
  listingType: 'FixedPriceItem' | 'Chinese'; auctionDays: number; startPrice: string; reservePrice: string; bestOfferEnabled: boolean; dispatchDays: number;
}
interface Aspect { name: string; required: boolean; values: string[]; mode?: string; maxLength?: number; cardinality?: string; variations?: boolean }
export function useListingEditor(listingId: string) {
  const { tenant, fixedNicheId, activeNicheId, triggerInventoryReload } = useApp();
  const nicheId = fixedNicheId ?? activeNicheId;
  const {user}=useAuth();
  const [unconfirmed,setUnconfirmed]=useState(false);
  const [publishedId,setPublishedId]=useState('');
  // Legacy name retained to reuse the proven full editor contract for all niches.
  const antique = isProductionNiche(nicheId);
  const scope = `${tenant?.id}:${nicheId}:${listingId}`;
  const currentScope = useRef(scope); currentScope.current = scope;
  const categoryRequest = useRef(0);
  const actionLock = useRef(false);
  const [live, setLive] = useState<LiveListingContent | null>(null);
  const [state, setState] = useState<ListingEditorState | null>(null); const [loadedScope, setLoadedScope] = useState('');
  const [loading, setLoading] = useState(false); const [busy, setBusy] = useState(false); const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null); const [aspects, setAspects] = useState<Aspect[]>([]);
  const [conditionPolicy, setConditionPolicy] = useState<AntiqueConditionPolicy | null>(null);
  const [requirementsReady, setRequirementsReady] = useState(false);
  const [categories, setCategories] = useState<any[]>([]); const [categorySource, setCategorySource] = useState('');
  const requirements = useCallback(async (categoryId: string) => {
    if (!tenant || !categoryId) return;
    const request = ++categoryRequest.current;
    setRequirementsReady(false); setConditionPolicy(null); setAspects([]);
    try {
      const result = await invokeListingOperation({ route: 'get_category_aspects', tenantId: tenant.id, categoryId, ...(antique ? { forceLive: true } : {}) });
      if (currentScope.current !== scope || request !== categoryRequest.current) return;
      if (result.error || !result.data?.success || result.data?.isLeaf === false) { setError(result.error ?? 'Category requirements unavailable. Retry before submitting.'); return; }
      const normalized: Aspect[] = antique ? normalizeAntiqueAspects(result.data.aspects) : (result.data.aspects ?? []).map((aspect: any) => ({ name: String(aspect.aspectName ?? aspect.localizedAspectName ?? ''), required: aspect.aspectConstraint?.aspectRequired === true || aspect.aspectConstraint?.aspectUsage === 'REQUIRED', values: (aspect.aspectValues ?? []).map((value: any) => String(value.localizedValue ?? '')).filter(Boolean) })).filter((aspect: Aspect) => aspect.name);
      setAspects(normalized);
      setState(previous => {
        if (!previous || previous.categoryId !== categoryId) return previous;
        const names = new Set(previous.itemSpecifics.map(specific => specific.name.toLowerCase()));
        const profile = getSpecialistProfile(nicheId);
        const attributes = previous.itemAttributes ?? {};
        const seeded = profile ? { ...attributes, ...mappedSpecialistSpecifics(profile,attributes) } : attributes;
        const itemSpecifics = antique ? seedAntiqueSpecifics(previous.itemSpecifics, normalized as AntiqueAspect[], seeded) : [...previous.itemSpecifics, ...normalized.filter(aspect => aspect.required && !names.has(aspect.name.toLowerCase())).map(aspect => ({ name: aspect.name, value: '' }))];
        return { ...previous, itemSpecifics };
      });
      if (antique) {
        const response = await invokeListingOperation({ route: 'get_condition_policies', tenantId: tenant.id, categoryId });
        if (currentScope.current !== scope || request !== categoryRequest.current) return;
        if (response.error || response.data?.success !== true || !response.data?.policy) { setError(response.error ?? 'eBay condition requirements unavailable. Retry category lookup.'); return; }
        setConditionPolicy(response.data.policy);
        setState(previous=>previous&&previous.categoryId===categoryId&&!previous.conditionId?{...previous,conditionId:automaticCondition(response.data.policy,previous.condition)}:previous);
      }
      setRequirementsReady(true);
    } catch (cause) { if (currentScope.current === scope && request === categoryRequest.current) setError(cause instanceof Error ? cause.message : 'Category requirements failed.'); }
  }, [tenant?.id, scope, antique]);
  const load = useCallback(async () => {
    if (!tenant || !listingId) return;
    setLoading(true); setError(null); setLoadedScope(''); setLive(null);
    try {
      let result = await loadListingEditor(tenant.id, listingId, nicheId);
      if (currentScope.current !== scope) return;
      if (result.error || !result.data) { setError(result.error); return; }
      const initialItem = (result.data as any).items;
      setUnconfirmed(Boolean((result.data as any).publish_claim_id));setPublishedId('');
      // Saved drafts use the same automatic photo processing as capture; live edits are never silently sent to eBay.
      if(user&&!(result.data as any).external_listing_id&&initialItem?.id){
        const savedItem=await getItem(initialItem.id);
        if(savedItem.item&&!savedItem.error&&savedItem.item.tenantId===tenant.id){
          for(const originalUri of existingOriginalPhotos(savedItem.item))await processExistingItemPhoto({tenantId:tenant.id,nicheId,itemId:initialItem.id,userId:user.id,originalUri});
          if(currentScope.current!==scope)return;
          result=await loadListingEditor(tenant.id,listingId,nicheId);
          if(result.error||!result.data){setError(result.error??'Draft unavailable.');return;}
        }
      }
      let recoveredPhotos = false;
      if (initialItem?.id && (!(initialItem.media ?? []).length || (initialItem.attributes?._photo_pipeline && initialItem.attributes._photo_pipeline.status !== 'complete'))) {
        const recovered = await recoverCapturedItemPhotos(tenant.id, initialItem.id, nicheId);
        if (currentScope.current !== scope) return;
        if (recovered.error || !recovered.item) setError(recovered.error ?? 'Captured photos could not be recovered. Open the saved inventory item to retry.');
        else {
          recoveredPhotos = true; triggerInventoryReload();
          result = await loadListingEditor(tenant.id, listingId, nicheId);
          if (currentScope.current !== scope) return;
          if (result.error || !result.data) { setError(result.error ?? 'Reload the draft to view its recovered photos.'); return; }
        }
      }
      const row: any = result.data; const item = row.items ?? {}; const attrs = item.attributes ?? {};
      const isCoin = ['coins','islamic_silver','banknotes','gold','silver','coins_uk','coins_world','coins_currency'].includes(item.specialist_id);
      const specifics: Array<{ name: string; value: string }> = Array.isArray(attrs.ebay_item_specifics) ? attrs.ebay_item_specifics.filter((specific: any) => typeof specific?.name === 'string' && typeof specific?.value === 'string').map((specific: any) => ({ name: specific.name, value: specific.value })) : [];
      const names = new Set(specifics.map(specific => specific.name.toLowerCase()));
      if (!antique) for (const [key,value] of Object.entries(attrs)) {
        if (key.startsWith('_') || /^(ebay|numista|inferred|identification|valuation|batch|capture|niche|classification)/i.test(key) || typeof value !== 'string' || !value.trim() || value.length > 65) continue;
        const name = isCoin && key === 'material' ? 'Metal' : key.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
        if (!names.has(name.toLowerCase())) { specifics.push({ name, value }); names.add(name.toLowerCase()); }
      }
      const categoryId = String(row.category_id ?? attrs.ebay_category_id ?? '');
      const options = antique ? attrs.ebay_listing_options ?? {} : {};
      const originals: string[] = item.media ?? [];
      const availableMedia = availableListingPhotos(originals, attrs);
      // Seed recovered photos only when the draft had no original photos to select.
      // An intentionally empty selection on an otherwise populated item is preserved.
      const seedRecovered = recoveredPhotos && Array.isArray(attrs.ebay_listing_media) && !attrs.ebay_listing_media.length && !row.external_listing_id;
      const media = antique && Array.isArray(attrs.ebay_listing_media) && !seedRecovered ? selectedListingPhotos(originals, attrs).filter((url: string) => availableMedia.includes(url)) : preferredListingPhotos(originals, attrs);
      setState({ tenantId: tenant.id, listingId: row.id, nicheId, itemAttributes: attrs, itemId: item.id, externalListingId: row.external_listing_id ?? '', status: row.status, title: row.title ?? '', description: row.description ?? '', price: String(row.price ?? 0), shippingCost: String(row.shipping_cost ?? 0), floorPrice: String(row.floor_price ?? 0), ceilingPrice: String(row.ceiling_price ?? 0), categoryId, categoryName: String(attrs.ebay_category_name ?? categoryId), condition: item.condition ?? '', conditionDescription: antique ? item.condition_notes || item.condition_grade || '' : item.condition_grade ?? '', conditionId: String(attrs.ebay_condition_id ?? ''), quantity: String(item.quantity ?? 1), sku: item.sku ?? '', itemSpecifics: specifics, media, availableMedia, specialistId: item.specialist_id ?? '', inventoryId: item.inventory_id ?? '', valuationMid: Number(item.valuation_mid ?? 0), itemTitle: item.canonical_title ?? '', subtitle: '', listingType: options.listingType ?? 'FixedPriceItem', auctionDays: Number(options.auctionDays ?? 7), startPrice: String(options.startPrice ?? row.price ?? 0), reservePrice: String(options.reservePrice ?? ''), bestOfferEnabled: options.bestOfferEnabled === true, dispatchDays: Number(options.dispatchDays ?? 3) });
      setLoadedScope(scope); setDirty(seedRecovered || (Array.isArray(attrs.ebay_listing_media) && JSON.stringify(media) !== JSON.stringify(attrs.ebay_listing_media))); setAspects([]);
      if (categoryId) await requirements(categoryId);
    } catch { if (currentScope.current === scope) setError('Listing could not load. Reload before making changes.'); }
    finally { if (currentScope.current === scope) setLoading(false); }
  }, [tenant?.id, listingId, nicheId, scope, antique, requirements, triggerInventoryReload, user?.id]);
  useEffect(() => { void load(); return () => { categoryRequest.current++; }; }, [load]);
  const update = <K extends keyof ListingEditorState>(key: K, value: ListingEditorState[K]) => { setState(previous => previous ? { ...previous, [key]: value } : null); setDirty(true); };
  const setMainPhoto = useCallback((uri: string) => {
    if (!state || busy || !state.availableMedia.includes(uri)) return;
    const photos = state.media.includes(uri) ? state.media : [...state.media, uri];
    if (photos.length > 12) { setError('Select at most 12 listing photos.'); return; }
    setState(previous => previous ? { ...previous, media: moveMainImageFirst(photos, uri) } : null); setDirty(true);
  }, [state, busy]);
  const persistState = async (snapshot: ListingEditorState): Promise<boolean> => {
    const result = await saveListingEditor({ ...snapshot, ...(antique ? { listingOptions: { listingType: snapshot.listingType, auctionDays: snapshot.auctionDays, startPrice: snapshot.startPrice, reservePrice: snapshot.reservePrice, bestOfferEnabled: snapshot.bestOfferEnabled, dispatchDays: snapshot.dispatchDays } } : {}) });
    if (currentScope.current !== scope) return false;
    if (result.error) { setError(result.error); return false; }
    setDirty(false); triggerInventoryReload(); return true;
  };
  const save = async (): Promise<boolean> => {
    if (!state || busy || actionLock.current || loadedScope !== scope) return false;
    actionLock.current = true; setBusy(true); setError(null);
    try { return await persistState(state); }
    catch { if (currentScope.current === scope) setError('Save was not confirmed. Reload before submitting.'); return false; }
    finally { actionLock.current = false; if (currentScope.current === scope) setBusy(false); }
  };
  const categoriesLookup = async (query: string, parentId = '') => {
    if (!tenant || busy) return;
    setBusy(true); setError(null);
    try {
      const body = { tenantId: tenant.id, route: query.trim() ? 'get_category_suggestions' : 'get_category_children', query: query.trim(), parentId };
      let result = await invokeListingOperation(body, 'swish-ebay-category');
      if (result.error || !result.data?.success) result = await invokeListingOperation(body);
      if (currentScope.current !== scope) return;
      if (result.error || !result.data?.success) { setError(result.error ?? 'Category lookup unavailable'); return; }
      setCategories(result.data.suggestions ?? result.data.children ?? []); setCategorySource(result.data.source ?? 'unknown');
    } catch { if (currentScope.current === scope) setError('Category search failed. Retry.'); }
    finally { if (currentScope.current === scope) setBusy(false); }
  };
  const chooseCategory = async (category: any) => {
    if (busy) return;
    if (!category.isLeaf) { await categoriesLookup('', category.id); return; }
    update('categoryId', String(category.id)); update('categoryName', String(category.name)); setCategories([]); await requirements(String(category.id));
  };
  const revise = async (skuOnly = false): Promise<string | null> => {
    if (!state?.externalListingId || loadedScope !== scope) return 'This listing is not published in the current workspace.';
    if (busy || actionLock.current) return 'A listing operation is already running.';
    const snapshot = state;
    actionLock.current = true; setBusy(true); setError(null);
    try {
      if (!await persistState(snapshot)) return 'Local save failed; no eBay revision was sent.';
      const result = skuOnly
        ? await invokeListingOperation({ route: 'revise_sku', tenantId: snapshot.tenantId, listingId: snapshot.listingId, externalListingId: snapshot.externalListingId, sku: snapshot.sku })
        : await reviseSavedListing(snapshot.tenantId, snapshot.listingId);
      if (currentScope.current !== scope) return 'Workspace changed; reload listing status.';
      if (result.data?.live) setLive(result.data.live);
      if (result.error || !result.data?.success) {
        const message = result.error ?? 'eBay revision was not confirmed.'; setError(message); return message;
      }
      triggerInventoryReload();
      const warning = skuOnly ? result.data.warning ?? null : result.error;
      if (warning) setError(warning);
      return warning;
    } catch { const message = 'Revision outcome could not be confirmed. Check live details before retrying.'; if (currentScope.current === scope) setError(message); return message; }
    finally { actionLock.current = false; if (currentScope.current === scope) setBusy(false); }
  };
  const checkLive = async () => {
    if (!state?.externalListingId || busy || actionLock.current || loadedScope !== scope) return;
    actionLock.current = true; setBusy(true); setError(null);
    try {
      const result = await inspectLiveListing(state.tenantId, state.listingId);
      if (currentScope.current !== scope) return;
      if (result.error) setError(result.error); else setLive(result.live);
    } finally { actionLock.current = false; if (currentScope.current === scope) setBusy(false); }
  };
  const generate = async (field: 'title' | 'description') => {
    if (!state || busy) return;
    setBusy(true);
    try {
      const result = await invokeListingOperation({ item_id: state.itemId, tenant_id: state.tenantId, marketplace_id: 'ebay', fields: [field] }, 'swish-list-generate');
      if (currentScope.current !== scope) return;
      if (result.error || !result.data?.listing?.[field]) setError(result.error ?? 'Generation returned no field'); else update(field, result.data.listing[field]);
    } catch { if (currentScope.current === scope) setError('Generation failed. Your saved content is unchanged.'); }
    finally { if (currentScope.current === scope) setBusy(false); }
  };
  const submit=async()=>{
    if(!state||state.externalListingId||unconfirmed||publishedId||busy||actionLock.current||loadedScope!==scope)return;
    actionLock.current=true;setBusy(true);setError(null);
    try{
      if(!await persistState(state))return;
      const result=await submitListingToMarketplace(state.tenantId,state.listingId,undefined,{listingType:state.listingType,auctionDays:state.auctionDays,startPrice:state.listingType==='Chinese'?Number(state.startPrice):undefined,reservePrice:Number(state.reservePrice)||undefined});
      if(currentScope.current!==scope)return;
      if(result.success&&result.externalListingId){setPublishedId(result.externalListingId);triggerInventoryReload();}
      else {setUnconfirmed(Boolean(result.publicationUnconfirmed||result.accepted));setError(result.error??'Listing was not confirmed.');}
    }catch{if(currentScope.current===scope){setUnconfirmed(true);setError('Publication needs checking. Do not submit again.');}}
    finally{actionLock.current=false;if(currentScope.current===scope)setBusy(false);}
  };
  const syncPublication=async()=>{
    if(!state||busy||actionLock.current)return;actionLock.current=true;setBusy(true);setError(null);
    try{const checked=await invokeListingOperation({route:'inspect_live',tenantId:state.tenantId,listingId:state.listingId});if(currentScope.current!==scope)return;if(checked.data?.live?.externalListingId&&checked.data.live.listingStatus==='Active'){setPublishedId(checked.data.live.externalListingId);triggerInventoryReload();}else setError(checked.error??'The existing listing is not confirmed live yet. Synchronise eBay; resubmission remains blocked.');}
    finally{actionLock.current=false;if(currentScope.current===scope)setBusy(false);}
  };
  return { submit,syncPublication,unconfirmed,publishedId,data: loadedScope === scope ? state : null, live: loadedScope === scope ? live : null, checkLive, loading, busy, dirty, error, aspects, categories, categorySource, conditionPolicy: loadedScope === scope ? conditionPolicy : null, requirementsReady, update, setMainPhoto, save, revise, generate, categoriesLookup, chooseCategory, reload: load, retryRequirements: () => { if (state?.categoryId) void requirements(state.categoryId); } };
}
