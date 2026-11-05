import { listItems,ACTIVE_INVENTORY_STATUSES,ITEM_LIFECYCLE,type Item } from './itemService';
import { getAllListings,type ListingWithItem } from './listingService';
import { isLiveListing,isDraftListing } from './listingLifecycle';
import { getProductionNicheSpecialistIds,resolveProductionNiche } from './nicheRouting';
import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { shareBackendRequest } from './backendRequestService';
export {loadInventoryTab,loadInventoryCounts} from './inventoryTabQueryService';
export type InventoryTab='stock'|'draft'|'live'|'sold';
export interface InventoryViewItem extends Partial<Item> {
  id:string;canonical_title:string;specialist_id:string;media:string[];attributes:Record<string,any>;listing?:ListingWithItem;
}
export async function loadInventoryView(tenantId:string,nicheId:string){
  const canonicalNiche=resolveProductionNiche(nicheId);
  const specialists=getProductionNicheSpecialistIds(canonicalNiche);
  if(!tenantId?.trim()||!canonicalNiche||!specialists.length)return {items:[],listings:[],error:'A verified account and registered niche are required.'};
  return shareBackendRequest(`inventory-view:${tenantId}:${canonicalNiche}`,async()=>{
    // listItems performs swish_can_access_niche once, before any records/relationships are fetched.
    // Do not issue an identical sequential authorization RPC from both orchestration and item service.
    const inventory=await listItems(tenantId, { specialistIds: specialists });
    if(inventory.error)return {items:[],listings:[],error:inventory.error};
    const result=await getAllListings(tenantId, undefined, specialists);
    return {items:inventory.items,listings:result.listings,error:result.error};
  });
}
export function buildInventoryViews(items:Item[],listings:ListingWithItem[]):Record<InventoryTab,InventoryViewItem[]>{
  const live=listings.filter(isLiveListing),draft=listings.filter(isDraftListing);
  const soldListings=listings.filter(listing=>['sold','fulfilled','completed'].includes(String(listing.status??'').toLowerCase())||Boolean(listing.itemSoldAt)||['sold','fulfilled','completed'].includes(String(listing.itemStatus??'').toLowerCase()));
  const listedIds=new Set([...live,...draft,...soldListings].map(listing=>listing.itemId));
  const byId=new Map(items.map(item=>[item.id,item]));
  const view=(item:Partial<Item>,listing?:ListingWithItem):InventoryViewItem=>({...item,id:item.id??listing!.itemId,canonical_title:item.canonicalTitle??listing?.itemTitle??'',specialist_id:item.specialistId??listing?.itemSpecialistId??'',attributes:item.attributes??{},media:listing?.itemMedia?.length?listing.itemMedia:item.media??[],listing});
  const soldById=new Map<string,InventoryViewItem>();
  for(const item of items.filter(candidate=>ITEM_LIFECYCLE.SOLD_STATUSES.includes(candidate.status)))soldById.set(item.id,view(item));
  for(const listing of soldListings)soldById.set(listing.itemId,view(byId.get(listing.itemId)??{},listing));
  return {stock:items.filter(item=>ACTIVE_INVENTORY_STATUSES.includes(item.status)&&!listedIds.has(item.id)).map(item=>view(item)),draft:draft.map(listing=>view(byId.get(listing.itemId)??{},listing)),live:live.map(listing=>view(byId.get(listing.itemId)??{},listing)),sold:[...soldById.values()]};
}
/** One original physical item per All card, including held/archived states. */
export function buildAllInventoryRows(items:Item[],views:Record<InventoryTab,InventoryViewItem[]>):InventoryViewItem[]{
  const classified=new Map<string,InventoryViewItem>();
  for(const tab of ['stock','draft','live','sold'] as const)for(const row of views[tab])classified.set(row.id,row);
  return items.map(item=>classified.get(item.id)??{...item,canonical_title:item.canonicalTitle,specialist_id:item.specialistId,media:item.media,attributes:item.attributes});
}
export async function syncInventoryOrders(tenantId:string,nicheId:string):Promise<{imported:number;error:string|null}>{
  const {data,error}=await getSupabaseClient().functions.invoke('swish-ebay-orders',{body:{tenantId,nicheId,specialistIds:getProductionNicheSpecialistIds(nicheId),daysBack:90,mode:'both'}});
  if(error){let message=error.message;if(error instanceof FunctionsHttpError){try{const text=await error.context.text();const body=JSON.parse(text);message=body.error??message;}catch{/* retain transport error */}}return {imported:0,error:message};}
  if(!data?.success)return {imported:0,error:data?.error??'Order sync was not confirmed'};
  return {imported:data.imported??0,error:data.errors?.length?data.errors.join('\n'):null};
}
