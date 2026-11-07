import { assertEquals } from 'jsr:@std/assert';
import { lookupBarcodeProducts } from '../functions/_shared/quickListBarcode.ts';
Deno.test('exact GTIN product leads only; seller photos and physical condition are never copied',async()=>{
 const calls:string[]=[];const fakeFetch=(async(input:RequestInfo|URL)=>{const url=String(input);calls.push(url);if(url.includes('item_summary/search'))return Response.json({itemSummaries:[{itemId:'v1|1|0'},{itemId:'v1|2|0'}]});return Response.json(url.includes('v1%7C1%7C0')?{itemId:'v1|1|0',gtin:'4006381333931',title:'Verified GTIN lead',brand:'Example',categoryId:'123',condition:'New',image:{imageUrl:'https://seller.example/photo.jpg'},localizedAspects:[{name:'Model',value:'A'},{name:'Condition',value:'New'}]}:{itemId:'v1|2|0',gtin:'4006381333932',title:'Wrong variant'});}) as typeof fetch;
 const result=await lookupBarcodeProducts('fake-token-not-a-secret','4006381333931',fakeFetch);assertEquals(result.status,'candidates');assertEquals(result.products.length,1);assertEquals(result.products[0].specifics.Condition,undefined);assertEquals('image' in result.products[0],false);assertEquals(calls.length,3);
});
Deno.test('catalogue denial is a usable visual-identification fallback, not a fabricated product',async()=>{const result=await lookupBarcodeProducts('fake','4006381333931',(async()=>new Response('',{status:403})) as typeof fetch);assertEquals(result.status,'unavailable');assertEquals(result.products,[]);});

Deno.test('valid game EAN without model or MPN still returns a barcode lead', async () => {
 const fake = (async (input: RequestInfo | URL) => String(input).includes('item_summary/search')
  ? Response.json({itemSummaries:[{itemId:'v1|336601445604|0'}]})
  : Response.json({itemId:'v1|336601445604|0',gtin:'5051892055116',title:'LEGO Harry Potter Years 1-4',localizedAspects:[{name:'Platform',value:'Microsoft Xbox 360'}]})) as typeof fetch;
 const result=await lookupBarcodeProducts('fake','5051892055116',fake);
 assertEquals(result.status,'candidates'); assertEquals(result.products.length,1); assertEquals(result.products[0].model,'');
});

Deno.test('numeric fallback finds seller EAN aspects but still requires the exact barcode', async () => {
 const calls:string[]=[];
 const fake=(async (input:RequestInfo|URL)=>{const url=String(input);calls.push(url);
  if(url.includes('search?gtin='))return Response.json({itemSummaries:[]});
  if(url.includes('search?q='))return Response.json({itemSummaries:[{itemId:'v1|1|0'},{itemId:'v1|2|0'}]});
  return Response.json({itemId:url.includes('v1%7C1%7C0')?'v1|1|0':'v1|2|0',title:'Teddy bear',localizedAspects:[{name:'EAN',value:url.includes('v1%7C1%7C0')?'4006381333931':'5051892055116'}]});
 }) as typeof fetch;
 const result=await lookupBarcodeProducts('fake','4006381333931',fake);
 assertEquals(result.status,'candidates'); assertEquals(result.products.length,1); assertEquals(result.products[0].gtin,'4006381333931'); assertEquals(calls.length,4);
});

Deno.test('ISBN-10 catalogue aspects match the normalized EAN-13 without a model',async()=>{
 const fake=(async(input:RequestInfo|URL)=>String(input).includes('item_summary/search')?Response.json({itemSummaries:[{itemId:'v1|1|0'}]}):Response.json({itemId:'v1|1|0',title:'Physics book',localizedAspects:[{name:'ISBN-10',value:'0306406152'}]})) as typeof fetch;
 const result=await lookupBarcodeProducts('fake','9780306406157',fake);
 assertEquals(result.status,'candidates');assertEquals(result.products[0].gtin,'9780306406157');
});

Deno.test('contradictory identifiers and title-only keyword hits do not identify a product',async()=>{
 const fake=(async(input:RequestInfo|URL)=>{
  const url=String(input);if(url.includes('item_summary/search'))return Response.json({itemSummaries:[{itemId:'v1|1|0'},{itemId:'v1|2|0'}]});
  return Response.json(url.includes('v1%7C1%7C0')?{itemId:'v1|1|0',title:'Conflicting variant',gtin:'5051892055116',localizedAspects:[{name:'EAN',value:'4006381333931'}]}:{itemId:'v1|2|0',title:'4006381333931 in title only'});
 }) as typeof fetch;
 const result=await lookupBarcodeProducts('fake','4006381333931',fake);assertEquals(result.status,'no_match');assertEquals(result.products,[]);
});

Deno.test('detail failures are unavailable rather than successful empty catalogue results',async()=>{
 const fake=(async(input:RequestInfo|URL)=>String(input).includes('item_summary/search')?Response.json({itemSummaries:[{itemId:'v1|1|0'}]}):new Response('',{status:503})) as typeof fetch;
 const result=await lookupBarcodeProducts('fake','4006381333931',fake);assertEquals(result.status,'unavailable');assertEquals(result.products,[]);
});

Deno.test('network timeout has a handled fallback and does not leak provider bodies',async()=>{
 const result=await lookupBarcodeProducts('fake','4006381333931',(async()=>{throw new Error('request transport details');}) as typeof fetch);
 assertEquals(result.status,'unavailable');assertEquals(result.message.includes('request transport details'),false);
});

Deno.test('invalid check digits never contact eBay',async()=>{
 let calls=0;const result=await lookupBarcodeProducts('fake','4006381333932',(async()=>{calls++;return Response.json({});}) as typeof fetch);
 assertEquals(result.status,'invalid');assertEquals(calls,0);
});

Deno.test('a successful empty GTIN and numeric search is a genuine no_match',async()=>{
 let calls=0;const result=await lookupBarcodeProducts('fake','4006381333931',(async()=>{calls++;return Response.json({itemSummaries:[]});}) as typeof fetch);
 assertEquals(result.status,'no_match');assertEquals(result.products,[]);assertEquals(calls,2);
});
