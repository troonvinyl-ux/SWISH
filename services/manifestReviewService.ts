import { getSupabaseClient } from '@/template';
import { getProductionNicheSpecialistIds } from './nicheRouting';
export async function confirmManifestInspection(tenantId: string, itemId: string, nicheId: string): Promise<{ attributes: Record<string, any> }> {
  const ids = getProductionNicheSpecialistIds(nicheId);
  if (!tenantId || !ids.length) throw new Error('Account and niche required.');
  const client = getSupabaseClient();
  const { data: item, error } = await client.from('items').select('attributes,condition,media,updated_at').eq('id',itemId).eq('tenant_id',tenantId).in('specialist_id',ids).single();
  if (error || !item) throw new Error(error?.message ?? 'Item not available in this niche.');
  if (!item.attributes?._manifest) throw new Error('This is not a manifest item.');
  if (!item.condition?.trim() || /customer return/i.test(item.condition)) throw new Error('Save the inspected item condition in the Listing Editor first. Customer Return is not an eBay condition.');
  if (!item.media?.length) throw new Error('Add actual item photos first.');
  const { data: listings, error: listingError } = await client.from('listings').select('price,category_id').eq('tenant_id',tenantId).eq('item_id',itemId).eq('status','draft');
  if (listingError || !listings?.length || listings.some(row=>Number(row.price)<=0 || !row.category_id)) throw new Error('Save a positive listing price and category for every draft first.');
  const attributes = { ...item.attributes, _manifest_review_required:false, _manifest: { ...item.attributes._manifest,
    inspection_confirmed:true, review_reasons:[], reviewed_at:new Date().toISOString(), review_basis:'seller_physical_inspection_and_policy_confirmation' } };
  const { error: saveError, count } = await client.from('items').update({ attributes },{ count:'exact' }).eq('id',itemId).eq('tenant_id',tenantId).in('specialist_id',ids).eq('updated_at',item.updated_at);
  if (saveError || count===0) throw new Error(saveError?.message ?? 'Item changed while reviewing. Reload and try again.');
  return { attributes };
}
