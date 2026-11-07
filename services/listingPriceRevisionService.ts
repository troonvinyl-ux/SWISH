// One user-clicked, price-only revision. No title/photo writes and no automatic retry.
import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';
export interface PriceRevisionResult {price:number|null;error:string|null;unconfirmed:boolean;notice:string|null}
export async function reviseListingPrice(input:{tenantId:string;nicheId:string;listingId:string;newPrice:number;expectedPrice:number}):Promise<PriceRevisionResult> {
 const failed=(error:string,unconfirmed=false):PriceRevisionResult=>({price:null,error,unconfirmed,notice:null});
 if(!input.tenantId||!input.nicheId||!input.listingId||!Number.isFinite(input.newPrice)||input.newPrice<=0||!Number.isFinite(input.expectedPrice))return failed('A verified listing and positive price are required.');
 try {
  const {data,error}=await getSupabaseClient().functions.invoke('swish-ebay-list',{body:{route:'revise_price',...input}});
  if(error){let message=error.message;let uncertain=false;
   if(error instanceof FunctionsHttpError){try{const payload=JSON.parse(await error.context.text());message=payload.error??message;uncertain=payload.accepted===true||payload.unconfirmed===true;}catch{message=`[HTTP ${error.context.status}] Price revision could not be confirmed.`;uncertain=true;}}
   else uncertain=true;
   return failed(message,uncertain);
  }
  if(data?.success!==true||data?.verified!==true||Math.round(Number(data.price)*100)!==Math.round(input.newPrice*100))return failed(data?.error??'The live eBay price was not confirmed. Check status before retrying.',data?.accepted===true||data?.unconfirmed===true);
  return {price:Number(data.price),error:null,unconfirmed:false,notice:'Price confirmed on eBay'};
 }catch{return failed('Price revision outcome is unconfirmed. Check the live listing before retrying.',true);}
}
