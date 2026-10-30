import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { getProductionNicheSpecialistIds } from './nicheRouting';
export interface EditorSave {
  tenantId: string; listingId: string; title: string; description: string;
  price: string; shippingCost: string; floorPrice: string; ceilingPrice: string;
  categoryId: string; categoryName: string; condition: string; conditionDescription: string;
  quantity: string; sku: string; itemSpecifics: Array<{ name: string; value: string }>;
}
export async function loadListingEditor(tenantId: string, listingId: string, nicheId: string) {
  const specialists = getProductionNicheSpecialistIds(nicheId);
  if (!specialists.length) return { data: null, error: 'A valid niche is required' };
  const { data, error } = await getSupabaseClient().from('listings')
    .select('*, items!inner(*)').eq('tenant_id', tenantId).eq('id', listingId)
    .in('items.specialist_id', specialists).maybeSingle();
  return { data, error: error?.message ?? (!data ? 'Listing not found in this niche' : null) };
}
export async function invokeListingOperation(body: Record<string, unknown>, functionName = 'swish-ebay-list'): Promise<{ data: any; error: string | null }> {
  // The dedicated taxonomy service preserves eBay localizedAspectName and its normalized name/required fields.
  // The legacy listing route can discard localized names; never let that erase mandatory manifest specifics.
  const endpoint = body.route === 'get_category_aspects' && functionName === 'swish-ebay-list' ? 'swish-ebay-category' : functionName;
  const { data, error } = await getSupabaseClient().functions.invoke(endpoint, { body });
  if (error) {
    let message = error.message;
    if (error instanceof FunctionsHttpError) {
      try { const text = await error.context.text(); const parsed = JSON.parse(text); message = parsed.error ?? message; }
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
}
export async function saveListingEditor(input: EditorSave): Promise<{ error: string | null }> {
  const amounts = [input.price,input.shippingCost,input.floorPrice,input.ceilingPrice].map(Number);
  const quantity = Number(input.quantity);
  if (!input.title.trim() || input.title.length > 80 || amounts.some(amount => !Number.isFinite(amount) || amount < 0) || !Number.isInteger(quantity) || quantity < 1) return { error: 'Enter a valid title, non-negative prices, and positive whole quantity.' };
  const specifics = input.itemSpecifics.filter(specific => specific.name.trim() && specific.value.trim()).map(specific => ({ name: specific.name.trim(), value: specific.value.trim() }));
  const names = new Set(specifics.map(specific => specific.name.toLowerCase()));
  if (specifics.length > 25 || names.size !== specifics.length || specifics.some(specific => specific.name.length > 65 || specific.value.length > 65)) return { error: 'Item specifics must be unique, at most 25, and no more than 65 characters per name/value. Values were not truncated.' };
  const { data, error } = await getSupabaseClient().rpc('swish_save_listing_editor', {
    p_tenant_id: input.tenantId, p_listing_id: input.listingId,
    p_listing_patch: { title: input.title.trim(), description: input.description, price: amounts[0], shipping_cost: amounts[1], floor_price: amounts[2], ceiling_price: amounts[3], category_id: input.categoryId || null },
    p_item_patch: { condition: input.condition, condition_grade: input.conditionDescription, quantity, sku: input.sku.trim(), ebay_category_id: input.categoryId, ebay_category_name: input.categoryName },
    p_specifics: specifics,
  });
  return { error: error?.message ?? (!data ? 'Save was not confirmed' : null) };
}
