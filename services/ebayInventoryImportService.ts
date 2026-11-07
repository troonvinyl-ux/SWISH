import {getSupabaseClient} from '@/template';
import {resolveProductionNiche} from './nicheRouting';
export interface CanonicalEbayImport {itemId:string;listingId:string;inventoryId:string|null;existing:boolean}
/** The existing canonical tables are inserted together, or the whole transaction rolls back. */
export async function importCanonicalEbayInventory(tenantId:string,nicheId:string,externalId:string,item:Record<string,unknown>,listing:Record<string,unknown>,existingItemId?:string):Promise<CanonicalEbayImport>{
 const niche=resolveProductionNiche(nicheId);
 if(!tenantId||!niche||!/^\d{6,20}$/.test(externalId.trim()))throw new Error('Account, module and external listing identity are required.');
 const {data,error}=await getSupabaseClient().rpc('swish_import_ebay_inventory',{p_tenant_id:tenantId,p_niche_id:niche,p_external_id:externalId.trim(),p_item:item,p_listing:listing,p_existing_item_id:existingItemId??null});
 if(error)throw new Error(error.message);
 if(!data?.itemId||!data?.listingId||typeof data.existing!=='boolean')throw new Error('Import outcome is unconfirmed. Reopen the same listing; do not create a replacement item.');
 return data as CanonicalEbayImport;
}
