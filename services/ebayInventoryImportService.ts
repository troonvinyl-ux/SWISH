import {getSupabaseClient} from '@/template';
import {resolveProductionNiche} from './nicheRouting';
export interface CanonicalEbayImport {itemId:string;listingId:string;inventoryId:string|null;existing:boolean}
/** The existing canonical tables are inserted together, or the whole transaction rolls back. */
export async function importCanonicalEbayInventory(tenantId:string,nicheId:string,externalId:string,item:Record<string,unknown>,listing:Record<string,unknown>,existingItemId?:string):Promise<CanonicalEbayImport>{
 const niche=resolveProductionNiche(nicheId);
 if(!tenantId||!niche||!/^\d{6,20}$/.test(externalId.trim()))throw new Error('Account, module and external listing identity are required.');
 // This RPC may still commit after a device-side cancellation. A bounded
 // wait prevents an indefinite "108/118" display, but an unknown result is
 // NEVER a reason to replay a write automatically. Re-read the linked ID.
 const controller=new AbortController();
 let timer:ReturnType<typeof setTimeout>|undefined;
 let timedOut=false;
 const request=getSupabaseClient().rpc('swish_import_ebay_inventory',{p_tenant_id:tenantId,p_niche_id:niche,p_external_id:externalId.trim(),p_item:item,p_listing:listing,p_existing_item_id:existingItemId??null}).abortSignal(controller.signal);
 const timeout=new Promise<never>((_,reject)=>{
  timer=setTimeout(()=>{timedOut=true;controller.abort();reject(new Error('SWISH_IMPORT_UNCONFIRMED: Import request timed out. Previously saved listings remain intact. Refresh the existing eBay links before explicitly retrying this listing.'));},30000);
 });
 let data:CanonicalEbayImport|null=null;
 let error:{message:string}|null=null;
 try{
  const result=await Promise.race([request,timeout]);
  data=result.data as CanonicalEbayImport|null;
  error=result.error;
  if(timedOut)throw new Error('SWISH_IMPORT_UNCONFIRMED: Import timed out; refresh the saved eBay link before retrying.');
 }finally{if(timer)clearTimeout(timer);}
 if(error)throw new Error(error.message);
 if(!data?.itemId||!data?.listingId||typeof data.existing!=='boolean')throw new Error('Import outcome is unconfirmed. Reopen the same listing; do not create a replacement item.');
 return data as CanonicalEbayImport;
}
