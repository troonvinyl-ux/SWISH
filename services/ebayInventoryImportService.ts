import {getSupabaseClient} from '@/template';
import {resolveProductionNiche} from './nicheRouting';
export interface CanonicalEbayImport {itemId:string;listingId:string;inventoryId:string|null;existing:boolean;bindingConfirmed?:boolean;bindingWarning?:string}
type VerifiedSellerRepairPage = {
 success?:boolean;section?:string;page?:number;totalPages?:number;nextPage?:number|null;
 verifiedSeller?:string;updated?:number;alreadyLinked?:number;unlinked?:number;
 otherNiche?:number;conflicts?:number;
};
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
 if(niche!=='coins')return data as CanonicalEbayImport;
 // A successful inventory save is not evidence that the seller owns this eBay
 // listing. The existing Browse worker checks eBay GetItem/Seller.UserID with
 // the current member's verified OAuth token, then repairs both DB records.
 // On verification failure, retain the saved listing and show a clear warning;
 // never re-submit or create another inventory item.
 try{
  const client=getSupabaseClient();
  if(typeof client.functions?.invoke!=='function')return {...data,bindingConfirmed:false,bindingWarning:'Verified seller re-import is unavailable. Use Re-import & Repair eBay Links.'};
  const verified=await client.functions.invoke('swish-ebay-browse',{
   body:{route:'repair_seller_links',tenantId,nicheId:niche,externalListingId:externalId.trim()},
  });
  if(verified.error||verified.data?.success!==true||
     Number(verified.data.updated??0)+Number(verified.data.alreadyLinked??0)!==1)
   return {...data,bindingConfirmed:false,bindingWarning:'Inventory saved, but eBay seller binding was not confirmed. Use Re-import & Repair eBay Links; do not re-list this item.'};
  return {...data,bindingConfirmed:true};
 }catch{return {...data,bindingConfirmed:false,bindingWarning:'Inventory saved, but eBay member ownership could not be confirmed. Use Re-import & Repair eBay Links.'};}
}

/** Native uses the same trusted seller-page repair route as SWISH Web.
 * No eBay item IDs supplied by this client are used as ownership evidence. */
export async function repairVerifiedNativeEbayLinks(
 tenantId:string,nicheId:string,
 onProgress:(state:{section:string;page:number;totalPages:number;updated:number;alreadyLinked:number;unlinked:number;otherNiche:number;conflicts:number;verifiedSeller:string})=>void,
){
 if(nicheId!=='coins')throw new Error('Open Coins before repairing eBay seller bindings.');
 const client=getSupabaseClient();
 let totals={section:'',page:0,totalPages:0,updated:0,alreadyLinked:0,unlinked:0,otherNiche:0,conflicts:0,verifiedSeller:''};
 for(const section of ['ActiveList','SoldList','UnsoldList']){
  let page:number|null=1;
  while(page!==null){
   const current=await client.rpc('swish_current_module');
   if(current.error||current.data?.tenant_id!==tenantId||current.data?.niche_id!==nicheId)
    throw new Error('Your SWISH workspace changed. Previously verified pages remain saved; reopen Coins.');
   const result: {data: VerifiedSellerRepairPage|null;error: unknown}=await client.functions.invoke('swish-ebay-browse',{
    body:{route:'repair_seller_links',tenantId,nicheId,section,page},
   });
   if(result.error||result.data?.success!==true||
      result.data.section!==section||result.data.page!==page)
    throw new Error('eBay re-import could not verify this seller page. Earlier confirmed pages remain saved; retry once connected.');
   const seller=String(result.data.verifiedSeller||'');
   if(!seller||(totals.verifiedSeller&&totals.verifiedSeller!==seller))
    throw new Error('The verified eBay seller changed during re-import. No subsequent pages were applied.');
   totals={section,page,totalPages:Number(result.data.totalPages)||0,verifiedSeller:seller,
    updated:totals.updated+Number(result.data.updated||0),
    alreadyLinked:totals.alreadyLinked+Number(result.data.alreadyLinked||0),
    unlinked:totals.unlinked+Number(result.data.unlinked||0),
    otherNiche:totals.otherNiche+Number(result.data.otherNiche||0),
    conflicts:totals.conflicts+Number(result.data.conflicts||0)};
   onProgress(totals);
   const next: number|null|undefined=result.data.nextPage;
   page=typeof next==='number'?next:null;
   if(page!==null&&(page<=totals.page||page>50))throw new Error('eBay pagination changed. Earlier confirmed pages remain saved.');
  }
 }
 return totals;
}
