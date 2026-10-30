// Canonical SECURITY INVOKER inventory projection queries. Uses existing items/listings and paid RLS, not a separate inventory.
import { getSupabaseClient } from '@/template';
import { mapItem } from './itemService';
import { getProductionNicheSpecialistIds } from './nicheRouting';
import type { InventoryTab,InventoryViewItem } from './inventoryViewService';
import type { ListingWithItem } from './listingService';
const tabs:InventoryTab[]=['stock','draft','live','sold'];
function mapProjectedInventory(row:any):InventoryViewItem {
  const item=mapItem(row.item ?? {}), raw=row.listing;
  const listing=raw ? {
    ...raw,id:raw.id,itemId:raw.item_id,tenantId:raw.tenant_id,marketplaceId:raw.marketplace_id,
    title:raw.title,description:raw.description ?? '',price:Number(raw.price ?? 0),status:raw.status,
    externalListingId:raw.external_listing_id ?? undefined,publishedAt:raw.published_at ?? undefined,
    floorPrice:Number(raw.floor_price ?? 0),ceilingPrice:Number(raw.ceiling_price ?? 0),shippingCost:Number(raw.shipping_cost ?? 0),
    views:Number(raw.views ?? 0),watchers:Number(raw.watchers ?? 0),createdAt:raw.created_at,updatedAt:raw.updated_at,
    itemTitle:item.canonicalTitle,itemSpecialistId:item.specialistId,itemStatus:item.status,itemSoldAt:item.soldAt,
    itemQuantity:item.quantity,itemMedia:item.media,
  } as ListingWithItem : undefined;
  return { ...item,id:row.item_id ?? item.id,canonical_title:item.canonicalTitle,specialist_id:row.specialist_id ?? item.specialistId,media:item.media,attributes:item.attributes,listing };
}
export async function loadInventoryTab(tenantId:string,nicheId:string,tab:InventoryTab):Promise<{ rows:InventoryViewItem[];error:string|null }> {
  const specialists=getProductionNicheSpecialistIds(nicheId);
  if(!tenantId.trim() || !specialists.length || !tabs.includes(tab)) return { rows:[],error:'A valid account, niche and inventory tab are required.' };
  const rows:InventoryViewItem[]=[];const size=200;
  for(let offset=0;offset<50000;offset+=size) {
    const { data,error }=await getSupabaseClient().from('swish_inventory_tab_rows').select('*')
      .eq('tenant_id',tenantId).eq('inventory_tab',tab).in('specialist_id',specialists)
      .order('sort_at',{ ascending:false }).range(offset,offset+size-1);
    if(error) return { rows:[],error:error.message };
    rows.push(...(data ?? []).map(mapProjectedInventory));
    if((data?.length ?? 0)<size) return { rows,error:null };
  }
  return { rows:[],error:'Inventory exceeds the bounded query size. Narrow the stock scope before loading.' };
}
export async function loadInventoryCounts(tenantId:string,nicheId:string):Promise<{ counts:Record<InventoryTab,number>;error:string|null }> {
  const counts:Record<InventoryTab,number>={ stock:0,draft:0,live:0,sold:0 };
  const specialists=getProductionNicheSpecialistIds(nicheId);
  if(!tenantId.trim() || !specialists.length) return { counts,error:'A valid account and niche are required.' };
  let error:string|null=null;
  await Promise.all(tabs.map(async tab=>{
    const result=await getSupabaseClient().from('swish_inventory_tab_rows').select('item_id',{ count:'exact',head:true })
      .eq('tenant_id',tenantId).eq('inventory_tab',tab).in('specialist_id',specialists);
    if(result.error) error=result.error.message;
    else counts[tab]=result.count ?? 0;
  }));
  return { counts,error };
}
