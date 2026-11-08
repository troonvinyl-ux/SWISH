// Seller Analytics supplies listing views; absent Trading HitCount is not evidence of zero views.
// Used only by an explicit scoped sync. No background inventory polling or credentials in results.
export interface ListingTraffic {views:number;startDate:string;endDate:string;lastUpdatedDate:string}
export function parseListingTraffic(payload:any,allowedIds:readonly string[]):Map<string,ListingTraffic> {
 const result=new Map<string,ListingTraffic>();const allowed=new Set(allowedIds);
 const dimension=payload?.header?.dimensionKeys?.findIndex((entry:any)=>entry.key==='LISTING_ID')??-1;
 const metric=payload?.header?.metrics?.findIndex((entry:any)=>entry.key==='LISTING_VIEWS_TOTAL')??-1;
 if(dimension<0||metric<0||!Array.isArray(payload?.records)||!payload?.startDate||!payload?.endDate)return result;
 for(const record of payload.records){
  const id=String(record?.dimensionValues?.[dimension]?.value??''),count=record?.metricValues?.[metric];
  if(!allowed.has(id)||count?.applicable!==true||typeof count.value!=='number'||!Number.isSafeInteger(count.value)||count.value<0)continue;
  result.set(id,{views:count.value,startDate:String(payload.startDate),endDate:String(payload.endDate),lastUpdatedDate:String(payload.lastUpdatedDate??'')});
 }
 return result;
}
export async function readListingTraffic(token:string,ids:readonly string[],hasAnalyticsScope:boolean,transport:typeof fetch=fetch):Promise<Map<string,ListingTraffic>> {
 const output=new Map<string,ListingTraffic>();
 if(!hasAnalyticsScope||!ids.length||ids.some(id=>!/^\d+$/.test(id)))return output;
 const end=new Date();end.setUTCDate(end.getUTCDate()-1);const start=new Date(end);start.setUTCDate(start.getUTCDate()-29);
 const format=(date:Date)=>date.toISOString().slice(0,10)+'T00:00:00.000+00:00';
 // Report windows exclude today; Analytics can lag behind current WatchCount.
 for(let offset=0;offset<ids.length;offset+=200){
  const page=ids.slice(offset,offset+200);const filter=`marketplace_ids:{EBAY_GB},date_range:[${format(start)}..${format(end)}],listing_ids:{${page.join('|')}}`;
  try{
   const response=await transport(`https://api.ebay.com/sell/analytics/v1/traffic_report?dimension=LISTING&metric=LISTING_VIEWS_TOTAL&filter=${encodeURIComponent(filter)}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},signal:AbortSignal.timeout(8000)});
   if(!response.ok)return output; // Missing consent/report never resets previously saved metrics.
   for(const [id,value]of parseListingTraffic(await response.json(),page))output.set(id,value);
  }catch{return output;}
 }
 return output;
}
