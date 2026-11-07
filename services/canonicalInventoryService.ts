import { getSupabaseClient } from '@/template';
import { backendRead, shareBackendRequest } from './backendRequestService';
import { resolveProductionNiche } from './nicheRouting';
export interface CanonicalInventoryCounts {
 total:number; units:number; stock:number; draft:number; live:number; sold:number; archived:number; liveListings:number;
 revision?:string; statusCounts?:Record<string,number>;
}
export const emptyCanonicalCounts = ():CanonicalInventoryCounts => ({total:0,units:0,stock:0,draft:0,live:0,sold:0,archived:0,liveListings:0});
export function parseCanonicalCounts(data:unknown):CanonicalInventoryCounts {
 if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Canonical inventory counts unavailable.');
 const row=data as Record<string,unknown>;const counts=emptyCanonicalCounts();
 for(const field of Object.keys(counts) as Array<keyof CanonicalInventoryCounts>){
  const value=row[field==='liveListings'?'live_listings':field];
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw new Error('Canonical inventory count contract was not confirmed.');
  counts[field]=value;
 }
 if(counts.stock+counts.draft+counts.live+counts.sold+counts.archived!==counts.total)throw new Error('Canonical item classification is inconsistent.');
 if(row.revision!==undefined){
  if(typeof row.revision!=='string'||!/^[a-f0-9]{32}$/.test(row.revision))throw new Error('Inventory revision was not confirmed.');
  counts.revision=row.revision;
 }
 if(row.status_counts!==undefined){
  if(!row.status_counts||typeof row.status_counts!=='object'||Array.isArray(row.status_counts))throw new Error('Status counts were not confirmed.');
  const statusCounts:Record<string,number>={};
  for(const [status,value] of Object.entries(row.status_counts)){
   if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw new Error('Status count contract was not confirmed.');
   statusCounts[status]=value;
  }
  if(Object.values(statusCounts).reduce((sum,value)=>sum+value,0)!==counts.total)throw new Error('Status totals do not match canonical inventory.');
  counts.statusCounts=statusCounts;
 }
 return counts;
}
/** All platforms use this existing RLS-enforced RPC; totals never come from listings or visible search results. */
export function readCanonicalInventoryCounts(tenantId:string,nicheId:string):Promise<CanonicalInventoryCounts>{
 const niche=resolveProductionNiche(nicheId);
 if(!tenantId.trim()||!niche)return Promise.reject(new Error('Verified tenant and niche are required.'));
 return shareBackendRequest(`canonical-counts:${tenantId}:${niche}`,async()=>{
  const {data,error}=await backendRead(`tab-counts:${tenantId}:${niche}`,signal=>getSupabaseClient().rpc('swish_inventory_tab_counts',{p_tenant_id:tenantId,p_niche_id:niche}).abortSignal(signal));
  if(error)throw new Error(error.message);
  return parseCanonicalCounts(data);
 });
}
/** A product barcode describes a product, never an individual physical copy. */
export function canonicalExternalKey(tenantId:string,marketplace:string,externalId:string):string {
 const market=['ebay','ebay_gb'].includes(marketplace.trim().toLowerCase())?'ebay':marketplace.trim().toLowerCase();
 return `${tenantId}:${market}:${externalId.trim()}`;
}
