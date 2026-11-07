// Canonical SECURITY INVOKER inventory projection queries. Uses existing items/listings and paid RLS, not a separate inventory.
import { getSupabaseClient } from '@/template';
import { backendRead, shareBackendRequest } from './backendRequestService';
import { mapItem } from './itemService';
import { preferredListingPhotos } from '@/shared/smartStudio';
import { getProductionNicheSpecialistIds } from './nicheRouting';
import type { InventoryTab,InventoryViewItem } from './inventoryViewService';
import type { ListingWithItem } from './listingService';
import { readCanonicalInventoryCounts } from './canonicalInventoryService';
const tabs:InventoryTab[]=['stock','draft','live','sold'];
export function mapProjectedInventory(row:any):InventoryViewItem {
  const item=mapItem(row.item ?? {}), raw=row.listing;
  const listing=raw ? {
    ...raw,id:raw.id,itemId:raw.item_id,tenantId:raw.tenant_id,marketplaceId:raw.marketplace_id,
    title:raw.title,description:raw.description ?? '',price:Number(raw.price ?? 0),status:raw.status,
    externalListingId:raw.external_listing_id ?? undefined,publishedAt:raw.published_at ?? undefined,endedAt:raw.ended_at ?? undefined,
    floorPrice:Number(raw.floor_price ?? 0),ceilingPrice:Number(raw.ceiling_price ?? 0),shippingCost:Number(raw.shipping_cost ?? 0),
    views:Number(raw.views ?? 0),watchers:Number(raw.watchers ?? 0),createdAt:raw.created_at,updatedAt:raw.updated_at,
    itemTitle:item.canonicalTitle,itemSpecialistId:item.specialistId,itemStatus:item.status,itemSoldAt:item.soldAt,
    itemQuantity:item.quantity,itemMedia:preferredListingPhotos(item.media,item.attributes),
  } as ListingWithItem : undefined;
  return { ...item,id:row.item_id ?? item.id,canonical_title:item.canonicalTitle,specialist_id:row.specialist_id ?? item.specialistId,media:item.media,attributes:item.attributes,listing };
}
export async function loadInventoryTab(tenantId:string,nicheId:string,tab:InventoryTab):Promise<{ rows:InventoryViewItem[];error:string|null }> {
  const specialists=getProductionNicheSpecialistIds(nicheId);
  if(!tenantId.trim() || !specialists.length || !tabs.includes(tab)) return { rows:[],error:'A valid account, niche and inventory tab are required.' };
  return shareBackendRequest(`inventory-tab:${tenantId}:${nicheId}:${tab}`, async () => {
  try {
  const rows:InventoryViewItem[]=[];const size=200;
  for(let offset=0;offset<50000;offset+=size) {
    const { data,error }=await backendRead(`inventory-tab-page:${tenantId}:${nicheId}:${tab}:${offset}`, signal => getSupabaseClient().from('swish_inventory_tab_rows').select('*')
      .eq('tenant_id',tenantId).eq('inventory_tab',tab).in('specialist_id',specialists)
      .order('sort_at',{ ascending:false }).order('item_id',{ ascending:true }).range(offset,offset+size-1).abortSignal(signal));
    if(error) return { rows:[],error:error.message };
    rows.push(...(data ?? []).map(mapProjectedInventory));
    if((data?.length ?? 0)<size) return { rows,error:null };
  }
  return { rows:[],error:'Inventory exceeds the bounded query size. Narrow the stock scope before loading.' };
  } catch(cause) { return { rows:[],error:cause instanceof Error ? cause.message : 'Inventory tab read failed' }; }
  });
}
export async function loadInventoryCounts(tenantId:string,nicheId:string):Promise<{ counts:Record<InventoryTab,number>;error:string|null }> {
  const counts:Record<InventoryTab,number>={ stock:0,draft:0,live:0,sold:0 };
  const specialists=getProductionNicheSpecialistIds(nicheId);
  if(!tenantId.trim() || !specialists.length) return { counts,error:'A valid account and niche are required.' };
  try {
    const canonical=await readCanonicalInventoryCounts(tenantId,nicheId);
    for(const tab of tabs) counts[tab]=canonical[tab];
    return { counts,error:null };
  } catch(cause) { return { counts,error:cause instanceof Error ? cause.message : 'Inventory counts unavailable' }; }
}
