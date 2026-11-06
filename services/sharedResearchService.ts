// Ephemeral niche-scoped research. No inventory writes or invented sold records.
import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { prepareImageForAI } from './aiIdentificationService';
export interface ResearchComparable {id:string;title:string;price?:number;currency:string;date?:string;imageUrl?:string;url?:string;condition?:string;kind:'sold'|'asking';source:string}
export interface ResearchSnapshot {results:ResearchComparable[];soldAverage?:number;soldCount?:number;estimate?:{low:number;mid:number;high:number;confidence:string};note:string}
export function projectResearch(data:any):ResearchSnapshot {
 const results:ResearchComparable[]=[];
 const sold=data?.verifiedSoldResearch??data?.teapeakProductResearch??data?.teapeakData??{};
 const add=(rows:any[],kind:'sold'|'asking')=>{for(const row of Array.isArray(rows)?rows:[]){const price=Number(row.price??row.soldPrice??row.priceAmount);if(!row.title||!Number.isFinite(price)||price<=0)continue;const index=results.length;results.push({id:`${kind}:${row.itemId??index}:${index}`,title:String(row.title),price,currency:row.currency??'GBP',date:kind==='sold'?row.soldDate??row.lastSoldDate??row.endDate:row.createdAt??row.startDate,imageUrl:row.imageUrl,url:row.itemUrl??row.url??(row.itemId?`https://www.ebay.co.uk/itm/${row.itemId}`:undefined),condition:row.condition,kind,source:kind==='sold'?'eBay sold record':'eBay asking price'});}};
 add(sold.items??sold.topSoldListings??data?.soldMarket?.sampleSoldListings??[],'sold');
 add(data?.activeAskingPrices?.sampleListings??data?.browseApiResults?.topItems??[],'asking');
 const average=Number(sold.averageSoldPrice??sold.avgSoldPrice??data?.soldMarket?.medianPrice??0);
 const count=Number(sold.soldQuantity??sold.soldCount??data?.soldMarket?.verifiedSoldCount??0);
 const g=data?.geminiMarketResearch;const range=g?.estimatedRange??{};const mid=Number(g?.estimatedMid??range.mid??0);
 return {results,soldAverage:average>0?average:undefined,soldCount:count>0?count:undefined,estimate:mid>0?{low:Number(g?.estimatedLow??range.low??0),mid,high:Number(g?.estimatedHigh??range.high??0),confidence:String(g?.confidence??'unknown')}:undefined,note:results.length||average>0||mid>0?'Asking prices are not sold prices. AI estimates are not verified sales.':'No comparable evidence returned. Try an exact model, edition or catalogue number.'};
}
export async function researchNiche(options:{tenantId:string;nicheId:string;specialistId:string;query:string;imageUri:string|null;signal:AbortSignal}):Promise<ResearchSnapshot> {
 const body:Record<string,unknown>={tenantId:options.tenantId,nicheId:options.nicheId,specialistId:options.specialistId,title:options.query.trim()||'Photo research',attributes:{},identificationConfidence:0,identificationTier:'candidate',applyToItem:false,researchMode:true};
 if(options.imageUri){const image=await prepareImageForAI(options.imageUri);if(image.startsWith('https://'))body.imageUrls=[image];else body.imageBase64=image;}
 if(options.signal.aborted)throw new Error('Research cancelled.');
 const {data,error}=await getSupabaseClient().functions.invoke('swish-market-value',{body,signal:options.signal});
 if(error){let message='Research could not complete. Retry.';if(error instanceof FunctionsHttpError){try{const raw=await error.context.text();const parsed=JSON.parse(raw);if(typeof parsed.error==='string')message=parsed.error.slice(0,400);}catch{message=`Research unavailable (HTTP ${error.context?.status??500}).`;}}throw new Error(message);}
 if(!data?.success||data.error)throw new Error(typeof data?.error==='string'?data.error:'Research returned no evidence.');return projectResearch(data);
}
