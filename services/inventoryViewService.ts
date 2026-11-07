import {ITEM_LIFECYCLE,type Item} from './itemService';
import type {ListingWithItem} from './listingService';
import {isLiveListing,isDraftListing} from './listingLifecycle';
import {getProductionNicheSpecialistIds,resolveProductionNiche} from './nicheRouting';
import {getSupabaseClient} from '@/template';
import {FunctionsHttpError} from '@supabase/supabase-js';
import {backendRead,shareBackendRequest} from './backendRequestService';
import {mapProjectedInventory} from './inventoryTabQueryService';
import {readCanonicalInventoryCounts,type CanonicalInventoryCounts} from './canonicalInventoryService';
export {loadInventoryTab,loadInventoryCounts} from './inventoryTabQueryService';
export type InventoryTab='stock'|'draft'|'live'|'sold';
export interface InventoryViewItem extends Partial<Item>{id:string;canonical_title:string;specialist_id:string;media:string[];attributes:Record<string,any>;listing?:ListingWithItem;inventoryTab?:InventoryTab|'archived'}
interface InventoryRead {items:Item[];listings:ListingWithItem[];canonicalCounts?:CanonicalInventoryCounts;error:string|null}
export async function loadInventoryView(tenantId:string,nicheId:string):Promise<InventoryRead>{
 const canonicalNiche=resolveProductionNiche(nicheId),specialists=getProductionNicheSpecialistIds(canonicalNiche);
 if(!tenantId?.trim()||!canonicalNiche||!specialists.length)return {items:[],listings:[],error:'A verified account and registered niche are required.'};
 return shareBackendRequest(`inventory-view:${tenantId}:${canonicalNiche}`,async()=>{
  try{
   const canonicalCounts=await readCanonicalInventoryCounts(tenantId,canonicalNiche);
   const rows:InventoryViewItem[]=[];
   for(let offset=0;offset<50000;offset+=200){
    const page=await backendRead(`canonical-items:${tenantId}:${canonicalNiche}:${offset}`,signal=>getSupabaseClient().from('swish_inventory_canonical_rows').select('*').eq('tenant_id',tenantId).in('specialist_id',specialists).order('sort_at',{ascending:false}).order('item_id',{ascending:true}).range(offset,offset+199).abortSignal(signal));
    if(page.error)throw new Error(page.error.message);
    for(const raw of page.data??[]){if(!['stock','draft','live','sold','archived'].includes(raw.inventory_tab))throw new Error('Canonical item state was not confirmed.');rows.push({...mapProjectedInventory(raw),inventoryTab:raw.inventory_tab});}
    if((page.data?.length??0)<200){
     const unique=[...new Map(rows.map(row=>[row.id,row])).values()];
     if(unique.length!==canonicalCounts.total)throw new Error('Inventory changed during the read. Refresh to verify the complete canonical collection.');
     return {items:unique as Item[],listings:unique.flatMap(row=>row.listing?[row.listing]:[]),canonicalCounts,error:null};
    }
   }
   throw new Error('Inventory exceeds the bounded query size. Narrow the scope.');
  }catch(cause){return {items:[],listings:[],error:cause instanceof Error?cause.message:'Canonical inventory unavailable.'};}
 });
}
export function buildInventoryViews(items:Item[],listings:ListingWithItem[]):Record<InventoryTab,InventoryViewItem[]>{
 const result:Record<InventoryTab,InventoryViewItem[]>={stock:[],draft:[],live:[],sold:[]};
 const uniqueItems=[...new Map(items.map(item=>[item.id,item])).values()],identities=new Set<string>(),linksByItem=new Map<string,ListingWithItem[]>();
 // Compatibility for pure/offline callers. Current screens use server-projected
 // inventoryTab; raw relationship records are never materialised as new items.
 const ordered=[...listings].sort((a,b)=>String(b.updatedAt??'').localeCompare(String(a.updatedAt??''))||String(b.createdAt??'').localeCompare(String(a.createdAt??''))||String(a.id).localeCompare(String(b.id)));
 for(const listing of ordered){
  const market=['ebay','ebay_gb'].includes(String(listing.marketplaceId??'').trim().toLowerCase())?'ebay':listing.marketplaceId;
  const key=listing.externalListingId?.trim()?`${listing.tenantId}:${market}:${listing.externalListingId.trim()}`:`row:${listing.id}`;
  if(identities.has(key))continue;identities.add(key);
  const links=linksByItem.get(listing.itemId)??[];links.push(listing);linksByItem.set(listing.itemId,links);
 }
 for(const item of uniqueItems){
  const projected=item as Item&InventoryViewItem;
  if(projected.inventoryTab){if(projected.inventoryTab!=='archived')result[projected.inventoryTab].push(projected);continue;}
  const links=(linksByItem.get(item.id)??[]).filter(l=>!item.tenantId||l.tenantId===item.tenantId);
  const sold=ITEM_LIFECYCLE.SOLD_STATUSES.includes(item.status)||Boolean(item.soldAt)||((item.quantity??1)<=1&&links.some(l=>['sold','fulfilled','completed'].includes(String(l.status).toLowerCase())));
  if(!sold&&[...ITEM_LIFECYCLE.ARCHIVED_STATUSES,'archived'].includes(item.status))continue;
  const live=links.find(isLiveListing),draft=links.find(isDraftListing),listing=live??draft??links[0];
  const tab:InventoryTab=sold?'sold':live?'live':draft?'draft':'stock';
  result[tab].push({...item,id:item.id,canonical_title:item.canonicalTitle,specialist_id:item.specialistId,attributes:item.attributes??{},media:item.media??[],listing});
 }
 return result;
}
/** One card per canonical identity, including archived/sold history. */
export function buildAllInventoryRows(items:Item[],views:Record<InventoryTab,InventoryViewItem[]>):InventoryViewItem[]{
 const classified=new Map<string,InventoryViewItem>();
 for(const tab of ['stock','draft','live','sold'] as const)for(const row of views[tab])classified.set(row.id,row);
 return [...new Map(items.map(item=>[item.id,item])).values()].map(item=>classified.get(item.id)??{...item,canonical_title:item.canonicalTitle,specialist_id:item.specialistId,media:item.media,attributes:item.attributes});
}
export async function syncInventoryOrders(tenantId:string,nicheId:string):Promise<{imported:number;error:string|null}>{
 const {data,error}=await getSupabaseClient().functions.invoke('swish-ebay-orders',{body:{tenantId,nicheId,specialistIds:getProductionNicheSpecialistIds(nicheId),daysBack:90,mode:'both'}});
 if(error){let message=error.message;if(error instanceof FunctionsHttpError){try{const text=await error.context.text();const body=JSON.parse(text);message=body.error??message;}catch{/* retain transport error */}}return {imported:0,error:message};}
 if(!data?.success)return {imported:0,error:data?.error??'Order sync was not confirmed'};
 return {imported:data.imported??0,error:data.errors?.length?data.errors.join('\n'):null};
}
