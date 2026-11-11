import { assertEquals, assertStringIncludes } from 'jsr:@std/assert';
import { createUniversalBarcodeEngine } from '../functions/_shared/universalBarcode.ts';
import { mergeBarcodeLeads, type BarcodeMergeLead } from '../functions/_shared/barcodeIdentification.ts';
const gtin='5014503238124',title='Doctor Who – Series 3, Volume 1';
const product:BarcodeMergeLead={id:'ebay:1',gtin,title,brand:'BBC',model:'',categoryId:'617',categoryName:'DVDs & Blu-rays',specifics:{Publisher:'BBC',Format:'DVD'},source:'eBay Browse',verificationStatus:'catalogue_verified',confidence:0.85,url:'https://www.ebay.co.uk/itm/123',sourceUrls:['https://www.ebay.co.uk/itm/123']};
const ai=(async()=>Response.json({choices:[{message:{content:JSON.stringify({status:'matched',products:[{barcode:gtin,title,publisher:'BBC',format:'DVD',releaseYear:'2007',attributes:{},confidence:0.9}]})}}]})) as typeof fetch;
const dependencies=()=>({ai:{apiKey:'key',baseUrl:'https://ai.example'},catalogue:async()=>({products:[product],status:'candidates'}),reserveAI:async()=>true,requestFetch:ai});
Deno.test('catalogue and AI matching results merge; AI supplements keep their field provenance',async()=>{
 const result=await createUniversalBarcodeEngine()('user:tenant:tech',gtin,dependencies());
 assertEquals(result.products.length,1);assertEquals(result.products[0].verificationStatus,'catalogue_verified');
 assertEquals(result.products[0].releaseYear,'2007');assertEquals(result.products[0].fieldSources?.releaseYear,'OnSpace AI');
 assertEquals(result.products[0].fieldSources?.['Release Year'],'OnSpace AI');
 assertEquals(result.products[0].confidence,0.85); // agreement does not manufacture extra confidence
});
Deno.test('catalogue miss/outage does not prevent Doctor Who AI-only suggestion',async()=>{
 for(const status of ['no_match','unavailable']){
  const deps={...dependencies(),catalogue:async()=>({products:[],status,message:'eBay offline'})};
  const result=await createUniversalBarcodeEngine()('user:tenant:collectibles',gtin,deps);
  assertEquals(result.status,'candidates');assertEquals(result.products[0].title,title);assertEquals(result.products[0].verificationStatus,'ai_suggested');assertEquals(result.products[0].sourceUrls,[]);
 }
});
Deno.test('malformed catalogue data does not erase a usable AI suggestion',async()=>{
 const result=await createUniversalBarcodeEngine()('malformed',gtin,{...dependencies(),catalogue:async()=>({status:'no_match'} as any)});
 assertEquals(result.status,'candidates');assertEquals(result.products[0].title,title);assertEquals(result.products[0].verificationStatus,'ai_suggested');
});
Deno.test('AI outage and exhausted cost budget preserve successful catalogue matches',async()=>{
 let calls=0;const deps={...dependencies(),reserveAI:async()=>false,requestFetch:(async()=>{calls++;throw new Error('should not call');}) as typeof fetch};
 const result=await createUniversalBarcodeEngine()('scope',gtin,deps);assertEquals(result.status,'candidates');assertEquals(calls,0);assertEquals(result.products[0].verificationStatus,'catalogue_verified');assertStringIncludes(result.warnings[0],'budget');
});
Deno.test('incorrect AI suggestions and conflicting regions stay alternatives rather than erasing the catalogue',()=>{
 const wrong={...product,id:'ai:1',source:'OnSpace AI' as const,verificationStatus:'ai_suggested' as const,title:'Doctor Who Series 4 Volume 2',confidence:0.79};
 const rows=mergeBarcodeLeads([[product],[wrong]]);assertEquals(rows.length,2);assertEquals(rows[0].id,product.id);assertEquals(Boolean(rows[0].conflicts?.length),true);
 assertEquals(mergeBarcodeLeads([[{...product,region:'2'}],[{...product,id:'other',region:'1'}]]).length,2);
});
Deno.test('duplicate concurrent scans and warm cache make one AI request; scopes/providers stay isolated',async()=>{
 const lookup=createUniversalBarcodeEngine();let calls=0,reservations=0;const deps={...dependencies(),reserveAI:async()=>{reservations++;return true;},requestFetch:(async(input:RequestInfo|URL,init?:RequestInit)=>{calls++;return ai(input,init);}) as typeof fetch};
 const [a,b]=await Promise.all([lookup('u:t:tech',gtin,deps),lookup('u:t:tech',gtin,deps)]);assertEquals(a,b);assertEquals(calls,1);assertEquals(reservations,1);
 assertEquals((await lookup('u:t:tech',gtin,deps)).cached,true);assertEquals(calls,1);
 await lookup('u:t:trading_cards',gtin,deps);assertEquals(calls,2);
 await lookup('u:t:tech',gtin,{...deps,ai:{...deps.ai,provider:'openai'}});assertEquals(calls,3);
});
Deno.test('all unknowns, all outages and invalid barcodes remain distinct; failures are not cached',async()=>{
 const lookup=createUniversalBarcodeEngine();let calls=0;const deps={...dependencies(),catalogue:async()=>({products:[],status:'no_match'}),requestFetch:(async()=>{calls++;return Response.json({choices:[{message:{content:'{"status":"no_match","products":[]}'}}]});}) as typeof fetch};
 assertEquals((await lookup('scope',gtin,deps)).status,'no_match');assertEquals((await lookup('scope','5014503238123',deps)).status,'invalid');assertEquals(calls,1);
 const failure={...deps,catalogue:async()=>({products:[],status:'unavailable'}),requestFetch:(async()=>{calls++;throw new Error('offline');}) as typeof fetch};
 assertEquals((await lookup('failure',gtin,failure)).status,'unavailable');assertEquals((await lookup('failure',gtin,failure)).cached,false);assertEquals(calls,3);
});
