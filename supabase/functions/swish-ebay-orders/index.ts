import { withEdgeFunctionLogging } from '../_shared/edgeFunctionLogging.ts';
// Shared eBay order sync: explicit payment + shipping evidence, atomic line ingestion, strict niche isolation.
import { serveModule } from '../_shared/moduleScope.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { encryptCredentials,decryptCredentials } from '../_shared/credentialCrypto.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { fulfillmentOrderLines,tradingOrderPage,type OrderLineEvidence } from '../_shared/ebayOrderAdapters.ts';
const REST='https://api.ebay.com/sell/fulfillment/v1';
const adminClient=()=>createClient(Deno.env.get('SUPABASE_URL')??'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'');
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json'}});
const escape=(v:string)=>v.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
async function credentials(tenantId:string){
 const db=adminClient();const result=await db.from('marketplace_connectors').select('id,status,credential_ref').eq('tenant_id',tenantId).eq('marketplace_id','ebay').maybeSingle();
 if(result.error||!result.data?.credential_ref||result.data.status!=='connected')throw new Error('Connect eBay in Marketplaces.');
 let creds=await decryptCredentials(result.data.credential_ref);
 if(!creds.accessToken)throw new Error('Re-authorise eBay.');
 if(!creds.expiresAt||Date.parse(creds.expiresAt)<Date.now()+300000){
  if(!creds.refreshToken)throw new Error('eBay consent needs renewal.');
  const response=await fetch('https://api.ebay.com/identity/v1/oauth2/token',{method:'POST',headers:{Authorization:`Basic ${btoa(`${creds.clientId}:${creds.clientSecret}`)}`,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:creds.refreshToken}).toString(),signal:AbortSignal.timeout(15000)});
  const payload=await response.json();if(!response.ok||!payload.access_token)throw new Error('eBay token refresh failed. Re-authorise only if consent was revoked.');
  creds={...creds,accessToken:payload.access_token,expiresAt:new Date(Date.now()+Number(payload.expires_in??7200)*1000).toISOString()};
  const saved=await db.from('marketplace_connectors').update({credential_ref:await encryptCredentials(creds),access_token_expires_at:creds.expiresAt}).eq('id',result.data.id).eq('credential_ref',result.data.credential_ref).select('id').maybeSingle();
  if(saved.error||!saved.data)throw new Error('Refreshed consent could not be saved securely.');
 }
 return creds;
}
const headers=(token:string)=>({Authorization:`Bearer ${token}`,Accept:'application/json','X-EBAY-C-MARKETPLACE-ID':'EBAY_GB'});
async function restGet(url:string,token:string){const response=await fetch(url,{headers:headers(token),signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error(`eBay Fulfillment HTTP ${response.status}`);return response.json();}
async function fulfillmentOrders(token:string,days:number){
 const orders:any[]=[],from=new Date(Date.now()-days*86400000).toISOString();let complete=false;
 for(let offset=0;offset<4000;offset+=200){const payload=await restGet(`${REST}/order?filter=${encodeURIComponent(`creationdate:[${from}..]`)}&limit=200&offset=${offset}`,token);if(!Array.isArray(payload.orders))throw new Error('eBay order page was incomplete');orders.push(...payload.orders);if(offset+payload.orders.length>=Number(payload.total??0)||payload.orders.length<200){complete=true;break;}}
 if(!complete)throw new Error('eBay order page limit reached; choose a shorter sync window');return orders;
}
async function tradingOrders(token:string,clientId:string,days:number){
 const lines:OrderLineEvidence[]=[],errors:string[]=[];let pages=1;
 for(let page=1;page<=pages;page++){
  // All seller commitments, including unpaid. Trading API has a maximum 90-day creation window.
  const from=new Date(Date.now()-Math.min(90,days)*86400000).toISOString(),to=new Date(Date.now()-120000).toISOString();
  const body=`<?xml version="1.0" encoding="utf-8"?><GetOrdersRequest xmlns="urn:ebay:apis:eBLBaseComponents"><RequesterCredentials><eBayAuthToken>${escape(token)}</eBayAuthToken></RequesterCredentials><CreateTimeFrom>${from}</CreateTimeFrom><CreateTimeTo>${to}</CreateTimeTo><OrderRole>Seller</OrderRole><DetailLevel>ReturnAll</DetailLevel><Pagination><EntriesPerPage>100</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination></GetOrdersRequest>`;
  const response=await fetch('https://api.ebay.com/ws/api.dll',{method:'POST',headers:{'X-EBAY-API-SITEID':'3','X-EBAY-API-COMPATIBILITY-LEVEL':'967','X-EBAY-API-CALL-NAME':'GetOrders','X-EBAY-API-APP-NAME':clientId,'Content-Type':'text/xml'},body,signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error(`eBay Trading HTTP ${response.status}`);const parsed=tradingOrderPage(await response.text());pages=parsed.pages;lines.push(...parsed.lines);errors.push(...parsed.errors);
 }
 return {lines,errors};
}
async function workers<T>(values:T[],work:(value:T)=>Promise<void>){let next=0;await Promise.all(Array.from({length:Math.min(4,values.length)},async()=>{for(;;){const index=next++;if(index>=values.length)return;await work(values[index]);}}));}
serveModule(withEdgeFunctionLogging('swish-ebay-orders', async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response(null,{headers:corsHeaders});if(req.method!=='POST')return json({error:'Method not allowed'},405);
 let logId='';const db=adminClient();
 try{
  const body=await req.json(),{tenantId,nicheId,specialistIds,daysBack=90,mode='both'}=body;
  if(!tenantId||!nicheId||!Array.isArray(specialistIds)||!specialistIds.length||!Number.isInteger(daysBack)||daysBack<1||daysBack>365||!['both','fulfillment_api','trading_api'].includes(mode))return json({error:'Invalid shared order scope or sync window'},400);
  const userClient=createClient(Deno.env.get('SUPABASE_URL')??'',Deno.env.get('SUPABASE_ANON_KEY')??'',{global:{headers:{Authorization:req.headers.get('Authorization')??''}}});
  // Use caller RLS for inventory matching, not service-role tenant-wide guesses.
  const listingMap=new Map<string,{id:string;itemId:string}>();
  for(let offset=0;;offset+=200){const loaded=await userClient.from('listings').select('id,item_id,external_listing_id,items!inner(specialist_id,tenant_id)').eq('tenant_id',tenantId).eq('items.tenant_id',tenantId).eq('marketplace_id','ebay').in('items.specialist_id',specialistIds).not('external_listing_id','is',null).order('id').range(offset,offset+199);if(loaded.error)throw new Error('Niche listing scope could not be read');for(const row of loaded.data??[])if(row.external_listing_id)listingMap.set(row.external_listing_id,{id:row.id,itemId:row.item_id});if((loaded.data?.length??0)<200)break;}
  const logged=await db.from('ebay_sync_log').insert({tenant_id:tenantId,sync_type:'orders',status:'running',metadata:{nicheId,daysBack,mode}}).select('id').single();if(logged.error||!logged.data)throw new Error('Order sync logging unavailable');logId=logged.data.id;
  const started=Date.now();const creds=await credentials(tenantId);const errors:string[]=[],warnings:string[]=[];let restOkay=false,tradingOkay=false;const restLines:OrderLineEvidence[]=[],xmlLines:OrderLineEvidence[]=[];
  // Fulfillment paid orders plus Trading unpaid commitments/delivery evidence; not fallback-only.
  await Promise.all([
   mode!=='trading_api'?(async()=>{try{
    const orders=await fulfillmentOrders(creds.accessToken,daysBack);const seen=new Set(orders.map(order=>String(order.orderId)));
    const open=await userClient.from('orders').select('external_order_id').eq('tenant_id',tenantId).eq('marketplace_id','ebay').in('fulfilment_status',['awaiting_payment','awaiting_dispatch','packing','label_created','dispatched']).not('external_order_id','is',null).order('id').limit(201);
    if(open.error)throw new Error('Open-order read failed');if((open.data?.length??0)>200)warnings.push('More than 200 open order lines: shorten the sync window and review remaining historical orders.');
    const oldIds=[...new Set((open.data??[]).slice(0,20).map(row=>row.external_order_id as string))].filter(id=>!seen.has(id));
    if((open.data?.length??0)>20)warnings.push('Historical open-order refresh is capped at 20 lines per run. Review older posted orders separately.');
    await workers(oldIds,async id=>{try{orders.push(await restGet(`${REST}/order/${encodeURIComponent(id)}`,creds.accessToken));}catch{warnings.push(`Historical order ${id} is not available from Fulfillment; Trading/Seller Hub review may be needed.`);}});
    for(const order of orders)try{restLines.push(...fulfillmentOrderLines(order));}catch(cause){errors.push(`Order ${order.orderId}: ${cause instanceof Error?cause.message:'Invalid eBay evidence'}`);}restOkay=true;
   }catch(cause){warnings.push(cause instanceof Error?cause.message:'Fulfillment unavailable');}})():Promise.resolve(),
   mode!=='fulfillment_api'?(async()=>{try{const parsed=await tradingOrders(creds.accessToken,creds.clientId,daysBack);xmlLines.push(...parsed.lines);errors.push(...parsed.errors);tradingOkay=true;}catch(cause){warnings.push(cause instanceof Error?cause.message:'Trading unpaid-order lookup unavailable');}})():Promise.resolve(),
  ]);
  if(!restOkay&&!tradingOkay)throw new Error('Neither eBay order source completed. Saved orders are unchanged.');
  if(mode==='both'&&!tradingOkay)errors.push('Paid orders were retrieved, but unpaid commitments and legacy delivery evidence are not verified.');
  // Merge provider representations of one transaction. Never turn a whole mixed-niche cart into one item.
  const merged=new Map<string,OrderLineEvidence>();
  for(const line of restLines){const counterparts=xmlLines.filter(other=>other.legacyItemId===line.legacyItemId&&other.aliases.some(alias=>line.aliases.includes(alias)));const match=counterparts.length===1?counterparts[0]:null;const next=match?{...line,lineKey:match.lineKey,aliases:[...new Set([...line.aliases,...match.aliases])],shippedAt:match.shippedAt,deliveredAt:match.deliveredAt,trackingNumber:match.trackingNumber,carrier:match.carrier}:line;
   if(match?.deliveredAt&&next.paid){next.status='delivered';next.fulfilmentStatus='delivered';next.requiresAction=false;next.action=null;}else if(match?.shippedAt&&next.paid){next.status='dispatched';next.fulfilmentStatus='dispatched';next.requiresAction=false;next.action=null;}merged.set(next.lineKey,next);}
  for(const line of xmlLines)if(!merged.has(line.lineKey))merged.set(line.lineKey,line);
  // Fetch actual shipping references for posted REST lines. FULFILLED never means delivered.
  const shippingCache=new Map<string,Promise<any>>();
  await workers([...merged.values()].filter(line=>line.source==='fulfillment_rest'&&line.paid&&line.shippingCheck===true),async line=>{try{
   let pending=shippingCache.get(line.orderId);if(!pending){pending=restGet(`${REST}/order/${encodeURIComponent(line.orderId)}/shipping_fulfillment`,creds.accessToken);shippingCache.set(line.orderId,pending);}const data=await pending;
   const shipments=Array.isArray(data.fulfillments)?data.fulfillments:[];const shipment=shipments.find((ship:any)=>ship.lineItems?.some((li:any)=>String(li.lineItemId)===line.lineId));if(shipment){line.trackingNumber=shipment.shipmentTrackingNumber??shipment.trackingNumber??line.trackingNumber;line.carrier=shipment.shippingCarrierCode??line.carrier;line.shippedAt=shipment.shippedDate??line.shippedAt;if(line.shippedAt&&!line.deliveredAt){line.status='dispatched';line.fulfilmentStatus='dispatched';line.requiresAction=false;line.action=null;}}
  }catch{errors.push(`Order ${line.orderId}: tracking readback unavailable; posted state retained, delivery not inferred.`);}});
  let imported=0,updated=0,skipped=0;const multiChecks=new Set<string>();
  for(const line of merged.values()){
   if(Date.now()-started>85000){errors.push('Sync time budget reached. Completed lines are retained; run a shorter date window for the remainder.');break;}
   const listing=listingMap.get(line.legacyItemId);if(!listing){skipped++;continue;}
   const ingested=await db.rpc('swish_ingest_ebay_order_line',{p_tenant_id:tenantId,p_niche_id:nicheId,p_listing_id:listing.id,p_line:line});
   if(ingested.error||!ingested.data?.id){errors.push(`Order ${line.orderId}: ${ingested.error?.code??'unconfirmed'} ${String(ingested.error?.message??'Atomic order save not confirmed').slice(0,220)}`);continue;}
   if(ingested.data.imported)imported++;else if(ingested.data.updated)updated++;else skipped++;if(ingested.data.multiQuantity)multiChecks.add(listing.id);
  }
  let quantityChecked=0;const ids=[...multiChecks];
  for(let start=0;start<ids.length;start+=12){try{const response=await userClient.functions.invoke('swish-ebay-listing-status',{body:{tenantId,nicheId,listingIds:ids.slice(start,start+12)}});if(response.error||response.data?.success!==true)errors.push('Multi-unit inventory readback is pending. No whole-item sale was inferred.');else quantityChecked+=Number(response.data.checked??0);}catch{errors.push('Multi-unit inventory readback unavailable.');}}
  const partial=errors.length>0;const result={success:!partial,partial,imported,updated,skipped,total:merged.size,matched:imported+updated,errors:errors.slice(0,20),warnings:warnings.slice(0,10),quantityStatusChecked:quantityChecked,quantityStatusPending:Math.max(0,ids.length-quantityChecked),apiUsed:restOkay&&tradingOkay?'fulfillment_rest+trading_xml':restOkay?'fulfillment_rest':'trading_xml',feeNote:'Fees are estimates unless Finances sync supplied actual values. Delivery requires explicit marketplace/carrier evidence.'};
  const completed=await db.from('ebay_sync_log').update({status:partial?'partial':'completed',records_fetched:merged.size,records_created:imported,records_updated:updated,records_skipped:skipped,errors:errors.slice(0,20),completed_at:new Date().toISOString(),metadata:{nicheId,daysBack,mode,restOkay,tradingOkay,warnings:warnings.slice(0,10)}}).eq('id',logId);
  if(completed.error)return json({...result,success:false,partial:true,error:'Orders were processed, but sync outcome logging is pending. Refresh saved orders before retrying.'});
  console.log(`[SWISH shared orders] niche=${nicheId} imported=${imported} updated=${updated} skipped=${skipped} errors=${errors.length}`);return json({...result,error:partial?'Some order evidence could not be synchronized. Saved successful lines are retained; review the issues.':undefined});
 }catch(cause){const message=cause instanceof Error?cause.message:'Order sync failed';if(logId)await db.from('ebay_sync_log').update({status:'failed',error_message:message,completed_at:new Date().toISOString()}).eq('id',logId);console.error('[SWISH shared orders] Sync not confirmed');return json({success:false,error:message},503);}
}));
