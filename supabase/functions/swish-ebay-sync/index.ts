// Shared eBay sync: current GetItem observations, canonical lifecycle command,
// original media preservation and no write from an incomplete marketplace snapshot.
import { serveModule } from '../_shared/moduleScope.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { encryptCredentials, decryptCredentials } from '../_shared/credentialCrypto.ts';
import registry from '../_shared/niche-modules.json' with {type:'json'};
import { corsHeaders } from '../_shared/cors.ts';
import { parseLiveContent } from '../_shared/ebayLiveContent.ts';
import { parseEbayListingStatus } from '../_shared/listingStatus.ts';
import { buildSellingRequest, sellingSectionXml, sellingPagination, tradingDiagnostic, type SellingSection } from '../_shared/ebaySellingRequest.ts';
const TRADING_API='https://api.ebay.com/ws/api.dll';
const TOKEN_URL='https://api.ebay.com/identity/v1/oauth2/token';
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json'}});
const adminClient=()=>createClient(Deno.env.get('SUPABASE_URL')??'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'',{auth:{persistSession:false}});
const tag=(xml:string,name:string)=>xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'i'))?.[1]?.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/,'$1').trim()??'';
const decode=(value:string)=>value.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'");
const clean=(value:string)=>decode(value).replace(/<style[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<script[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,8000);
const authError=(xml:string)=>/hardExpired|IAF_INVALID_TOKEN|IAF_EXPIRED|<ErrorCode>(931|932|16110|16111)</i.test(xml);
function safeFailure(cause:unknown):string{
 const message=cause instanceof Error?cause.message:'';
 return /^(eBay Trading HTTP|REQUIRES_REAUTH:|RETRY:|Selling |Incomplete |GetItem |Sync |SWISH )/.test(message)?message:'Marketplace connection timed out or failed';
}
async function getValidToken(client:ReturnType<typeof adminClient>,tenantId:string){
 const {data:conn,error}=await client.from('marketplace_connectors').select('id,credential_ref,access_token_expires_at').eq('tenant_id',tenantId).eq('marketplace_id','ebay').maybeSingle();
 if(error)throw new Error('RETRY: eBay connection could not be read');
 if(!conn?.credential_ref)throw new Error('REQUIRES_REAUTH: eBay not connected');
 let creds:any;try{creds=await decryptCredentials(conn.credential_ref);}catch{throw new Error('REQUIRES_REAUTH: eBay credential could not be opened securely');}
 if(!creds.accessToken)throw new Error('REQUIRES_REAUTH: eBay token missing');
 const expiry=Date.parse(creds.expiresAt??conn.access_token_expires_at??'');
 if(!Number.isFinite(expiry)||expiry<Date.now()+300000){
  if(!creds.refreshToken)throw new Error('REQUIRES_REAUTH: Refresh consent unavailable');
  let response:Response;
  try{response=await fetch(TOKEN_URL,{method:'POST',headers:{Authorization:`Basic ${btoa(`${creds.clientId}:${creds.clientSecret}`)}`,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:creds.refreshToken}).toString(),signal:AbortSignal.timeout(12000)});}catch{throw new Error('RETRY: eBay token service unavailable; existing connection preserved');}
  const payload=await response.json().catch(()=>({}));
  if(!response.ok||!payload.access_token){
   if(payload.error==='invalid_grant'){
    const saved=await client.from('marketplace_connectors').update({status:'requires_reauth',last_error:'Refresh consent revoked or expired'}).eq('id',conn.id).eq('credential_ref',conn.credential_ref);
    if(saved.error)throw new Error('RETRY: Revoked consent state could not be persisted');
    throw new Error('REQUIRES_REAUTH: Refresh consent revoked or expired');
   }
   throw new Error('RETRY: eBay token service unavailable; existing connection preserved');
  }
  const updated={...creds,accessToken:payload.access_token,expiresAt:new Date(Date.now()+Number(payload.expires_in??7200)*1000).toISOString()};
  const reference=await encryptCredentials(updated);
  const saved=await client.from('marketplace_connectors').update({credential_ref:reference,access_token_expires_at:updated.expiresAt,status:'connected',last_error:null}).eq('id',conn.id).eq('credential_ref',conn.credential_ref).select('id').maybeSingle();
  if(saved.error||!saved.data)throw new Error('RETRY: Connector changed while refreshing. Retry without reconnecting.');
  creds=updated;
 }
 return {token:String(creds.accessToken),clientId:String(creds.clientId)};
}
async function trading(xml:string,call:string,token:string,clientId:string){
 const response=await fetch(TRADING_API,{method:'POST',headers:{'X-EBAY-API-SITEID':'3','X-EBAY-API-COMPATIBILITY-LEVEL':'967','X-EBAY-API-CALL-NAME':call,'X-EBAY-API-APP-NAME':clientId,'X-EBAY-API-IAF-TOKEN':token,'Content-Type':'text/xml;charset=utf-8'},body:xml,signal:AbortSignal.timeout(20000)});
 const text=await response.text();
 if(authError(text))throw new Error('REQUIRES_REAUTH: eBay rejected the access token');
 if(!response.ok||!['Success','Warning'].includes(tag(text,'Ack')))throw new Error(tradingDiagnostic(text,response.status));
 return text;
}
async function fetchSellingPage(token:string,clientId:string,section:SellingSection,page:number){
 const xml=await trading(buildSellingRequest(section,page,200),'GetMyeBaySelling',token,clientId);
 const pagination=sellingPagination(xml,section);
 const body=sellingSectionXml(xml,section);
 const ids=[...body.matchAll(/<ItemID>\s*(\d+)\s*<\/ItemID>/g)].map(match=>match[1]);
 if(!ids.length&&page<pagination.pages)throw new Error('Incomplete selling page; statuses preserved');
 return {ids,pages:pagination.pages};
}
interface Observation{externalId:string;title:string;description:string;status:'active'|'sold'|'ended';quantity:number;sold:number;price:number;shipping:number;categoryId:string;categoryName:string;condition:string;conditionNotes:string;conditionId:string;sku:string;watchers:number;views:number;photos:string[];specifics:Array<{name:string;value:string}>;endedAt:string|null}
async function getItemObservation(id:string,token:string,clientId:string):Promise<Observation>{
 if(!/^\d+$/.test(id))throw new Error('GetItem external identity invalid');
 const xml=await trading(`<?xml version="1.0" encoding="utf-8"?><GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ItemID>${id}</ItemID><IncludeItemSpecifics>true</IncludeItemSpecifics><IncludeWatchCount>true</IncludeWatchCount><DetailLevel>ReturnAll</DetailLevel></GetItemRequest>`,'GetItem',token,clientId);
 const body=tag(xml,'Item');
 if(!body||tag(body,'ItemID')!==id)throw new Error('GetItem identity mismatch; statuses preserved');
 const selling=tag(body,'SellingStatus');const state=tag(selling,'ListingStatus').toLowerCase();
 const quantity=Number(tag(body,'Quantity'));const sold=Number(tag(selling,'QuantitySold'));
 if(!['active','completed','ended'].includes(state)||!tag(selling,'QuantitySold')||!Number.isInteger(quantity)||quantity<1||!Number.isInteger(sold)||sold<0)throw new Error('GetItem availability incomplete; statuses preserved');
 // Reuse the status endpoint's quantity policy: a partially sold ended listing
 // still has canonical units and must not mark the whole item sold.
 const status=parseEbayListingStatus(xml,id).status;
 const specifics=[...tag(body,'ItemSpecifics').matchAll(/<NameValueList(?:\s[^>]*)?>([\s\S]*?)<\/NameValueList>/g)].map(match=>({name:decode(tag(match[1],'Name')),value:decode(tag(match[1],'Value'))})).filter(row=>row.name&&row.value);
 const photos=[...new Set([...body.matchAll(/<PictureURL>\s*([^<]+)\s*<\/PictureURL>/g)].map(match=>decode(match[1]).trim().replace(/^http:/,'https:')))];
 const content=parseLiveContent(xml,id);
 const category=tag(body,'PrimaryCategory');const price=content.sellerPrice;const title=content.title;
 if(!title||!Number.isFinite(price)||price<0)throw new Error('GetItem listing data invalid');
 const end=tag(tag(body,'ListingDetails'),'EndTime');
 return {externalId:id,title,description:content.description,status,quantity,sold,price,shipping:Number(tag(body,'ShippingServiceCost')||0),categoryId:tag(category,'CategoryID'),categoryName:decode(tag(category,'CategoryName')),condition:decode(tag(body,'ConditionDisplayName')),conditionNotes:decode(tag(body,'ConditionDescription')),conditionId:tag(body,'ConditionID'),sku:decode(tag(body,'SKU')),watchers:Number(tag(body,'WatchCount')||0),views:Number(tag(body,'HitCount')||0),photos,specifics,endedAt:end&&Number.isFinite(Date.parse(end))&&Date.parse(end)<=Date.now()?end:null};
}
async function syncItemToSwish(client:ReturnType<typeof adminClient>,tenantId:string,listing:any,item:any,ebay:Observation){
 const previous=item.attributes&&typeof item.attributes==='object'?item.attributes:{};
 const attrs={...previous,_ebay_item_id:ebay.externalId,_ebay_title:ebay.title,_ebay_img_count:ebay.photos.length};
 if(ebay.specifics.length)attrs.ebay_item_specifics=ebay.specifics;
 if(ebay.categoryId)attrs.ebay_category_id=ebay.categoryId;
 if(ebay.categoryName)attrs.ebay_category_name=ebay.categoryName;
 if(ebay.conditionId)attrs.ebay_condition_id=ebay.conditionId;
 const media=[...new Set([...(Array.isArray(item.media)?item.media:[]),...ebay.photos])];
 const patch:Record<string,unknown>={attributes:attrs,media,quantity:ebay.quantity};
 if(ebay.description)patch.description=ebay.description;
 if(ebay.condition)patch.condition=ebay.condition;
 if(ebay.conditionNotes)patch.condition_notes=ebay.conditionNotes;
 if(ebay.sku&&!item.sku)patch.sku=ebay.sku;
 if(!item.canonical_title||/^(Untitled|Title pending)/i.test(item.canonical_title))patch.canonical_title=ebay.title;
 const find=(names:string[])=>ebay.specifics.find(row=>names.some(name=>name.toLowerCase()===row.name.toLowerCase()))?.value;
 const coin=[...registry.products.coins.specialists,...registry.products.coins.legacySpecialists].includes(item.specialist_id);
 const fields:Record<string,string[]>={year_made:['Year','Year Manufactured'],country_of_origin:['Country/Region of Manufacture','Country of Origin'],material:['Material','Metal'],manufacturer:['Brand','Manufacturer'],period:['Era','Period']};
 if(coin)Object.assign(fields,{ruler:['Ruler','Monarch'],denomination:['Denomination'],mint:['Mint','Mint Mark']});
 for(const [key,names]of Object.entries(fields)){const value=find(names);if(!item[key]&&value)patch[key]=value;}
 const saved=await client.from('items').update(patch).eq('id',item.id).eq('tenant_id',tenantId).eq('updated_at',item.updated_at).select('id').maybeSingle();
 if(saved.error||!saved.data)throw new Error('SWISH item metadata save not confirmed; reload before retrying');
 const listingSaved=await client.from('listings').update({title:ebay.title,...(ebay.description?{description:ebay.description}:{}),price:ebay.price,shipping_cost:ebay.shipping,watchers:ebay.watchers,views:ebay.views,...(ebay.categoryId?{category_id:ebay.categoryId}:{})}).eq('id',listing.id).eq('tenant_id',tenantId).eq('external_listing_id',ebay.externalId).select('id').maybeSingle();
 if(listingSaved.error||!listingSaved.data)throw new Error('SWISH listing metadata save not confirmed');
 // The server-only canonical RPC atomically reconciles listing + inventory and audit evidence.
 const status=await client.rpc('swish_apply_ebay_listing_status',{p_tenant_id:tenantId,p_listing_id:listing.id,p_external_id:ebay.externalId,p_status:ebay.status,p_quantity:ebay.quantity,p_quantity_sold:ebay.sold,p_ended_at:ebay.endedAt});
 if(status.error)throw new Error('SWISH canonical listing status could not be persisted');
 const persisted=await client.from('listings').select('status,external_listing_id,items!inner(status,media,attributes)').eq('id',listing.id).eq('tenant_id',tenantId).maybeSingle();
 const linked=Array.isArray(persisted.data?.items)?persisted.data.items[0]:persisted.data?.items;
 if(persisted.error||persisted.data?.status!==ebay.status||persisted.data?.external_listing_id!==ebay.externalId||!linked||media.some(url=>!linked.media?.includes(url)))throw new Error('SWISH sync persisted readback failed');
 return {images:Math.max(0,media.length-(item.media?.length??0)),titleFixed:patch.canonical_title?1:0};
}
serveModule(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response(null,{headers:corsHeaders});
 if(req.method!=='POST')return json({success:false,error:'Method not allowed'},405);
 const body=await req.json().catch(()=>null);const {tenantId,nicheId,mode='full',itemIds}=body??{};
 const products=registry.products as Record<string,{specialists:string[];legacySpecialists:string[]}>;
 if(!tenantId||!products[nicheId]||!['full','data_only','refresh_token_only'].includes(mode))return json({success:false,error:'Valid authorized tenant and niche required'},400);
 const client=adminClient();const started=Date.now();
 try{
  const {token,clientId}=await getValidToken(client,tenantId);
  if(mode==='refresh_token_only')return json({success:true,message:'Existing eBay token is valid'});
  const specialists=[...products[nicheId].specialists,...products[nicheId].legacySpecialists];
  const links=await client.from('listings').select('id,item_id,external_listing_id,items!inner(*)').eq('tenant_id',tenantId).eq('items.tenant_id',tenantId).eq('marketplace_id','ebay').in('items.specialist_id',specialists).not('external_listing_id','is',null).neq('external_listing_id','');
  if(links.error)throw new Error('SWISH scoped listings could not be loaded');
  const listings=(links.data??[]).filter(row=>!itemIds||itemIds.includes(row.item_id));
  if(!listings.length)return json({success:true,processed:0,updated:0,failed:0,imagesFetched:0,titlesFixed:0,message:'No imported eBay listings in this niche. Import listings first; no inventory was changed.'});
  // Fetch section-scoped summaries. Never infer ended/sold from an absent external ID.
  const external=new Set<string>();
  for(const section of (Array.isArray(itemIds)&&itemIds.length ? [] : ['ActiveList','SoldList','UnsoldList']) as SellingSection[]){
   let pages=1;for(let page=1;page<=pages;page++){
    if(Date.now()-started>60000)throw new Error('Sync deadline reached before reconciliation; statuses preserved');
    try{const result=await fetchSellingPage(token,clientId,section,page);pages=result.pages;result.ids.forEach(id=>external.add(id));}
    catch(cause){const detail=safeFailure(cause);console.error(`[EbaySync] ${section} page ${page}: ${detail}; reconciliation cancelled before database writes`);return json({success:false,partial:true,stage:'selling_page',section,page,error:`${detail}. Existing listing statuses were preserved.`,requiresReauth:detail.startsWith('REQUIRES_REAUTH:')},detail.startsWith('REQUIRES_REAUTH:')?401:503);}
   }
  }
  // Fetch exact current observations for linked IDs, including IDs missing from My eBay.
  // A complete set must be verified before ANY inventory mutation.
  const observations=new Map<string,Observation>();
  for(const id of [...new Set(listings.map(row=>String(row.external_listing_id)))]){
   if(Date.now()-started>65000)throw new Error('Sync deadline reached; retry a smaller item selection. Statuses preserved.');
   observations.set(id,await getItemObservation(id,token,clientId));
  }
  let updated=0,imagesFetched=0,titlesFixed=0;const failed:string[]=[];
  for(const listing of listings){
   const item=Array.isArray(listing.items)?listing.items[0]:listing.items;
   try{const result=await syncItemToSwish(client,tenantId,listing,item,observations.get(String(listing.external_listing_id))!);updated++;imagesFetched+=result.images;titlesFixed+=result.titleFixed;}
   catch{failed.push(String(listing.external_listing_id));console.error('[EbaySync] Scoped item reconciliation was not confirmed.');}
  }
  if(!failed.length){const saved=await client.from('marketplace_connectors').update({last_sync_at:new Date().toISOString()}).eq('tenant_id',tenantId).eq('marketplace_id','ebay');if(saved.error)return json({success:false,partial:true,updated,error:'SWISH sync timestamp could not be saved. Item outcomes were reconciled.'},503);}
  return json({success:failed.length===0,partial:failed.length>0,processed:listings.length,updated,failed:failed.length,imagesFetched,titlesFixed,totalEbayListings:external.size,matchedListings:listings.length,orphansFixed:0,failedEbayIds:failed.slice(0,20),...(failed.length?{error:`${failed.length} listing reconciliations were not confirmed. Reload inventory before retrying.`}:{})});
 }catch(cause){const detail=safeFailure(cause);console.error(`[EbaySync] ${detail}`);return json({success:false,error:`${detail}. Synchronisation not confirmed.`,requiresReauth:detail.startsWith('REQUIRES_REAUTH:'),partial:true},detail.startsWith('REQUIRES_REAUTH:')?401:503);}
});
