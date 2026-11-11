// Injected provider regressions. No real paid AI request or claim of live-device accuracy.
import { assertEquals, assertStringIncludes } from 'jsr:@std/assert';
import { lookupAIBarcode, parseAIBarcodeResult } from '../functions/_shared/aiBarcodeLookup.ts';
const gtin = '5014503238124';
const title = 'Doctor Who – Series 3, Volume 1';
function payload(overrides: Record<string, unknown> = {}) {
  return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ status: 'matched', products: [{ barcode: gtin, title, manufacturer: null, publisher: 'BBC', releaseYear: '2007', releaseDate: null, format: 'DVD', edition: null, region: null, category: 'DVD', attributes: { Series: '3', Volume: '1', Price: '99', Condition: 'New' }, suggestedEbayCategory: 'DVDs & Blu-rays', sourceUrls: ['https://invented.example/item'], verificationStatus: 'verified', confidence: 0.9, ...overrides }] }) } }] };
}
Deno.test('EAN 5014503238124 becomes an AI suggestion without requiring photos or a citation', async () => {
  let calls = 0;
  const fake = (async (input: RequestInfo | URL, options?: RequestInit) => {
    calls++; assertEquals(String(input), 'https://ai.example/chat/completions');
    assertEquals(new Headers(options?.headers).get('Authorization'), 'Bearer test-key');
    const body = JSON.parse(String(options?.body)); assertEquals(body.model, 'google/gemini-3-flash-preview');
    assertEquals(body.plugins, undefined); assertEquals(body.max_tokens, 1600);
    assertEquals(body.response_format.type, 'json_schema'); assertStringIncludes(body.messages[1].content, gtin);
    return Response.json(payload());
  }) as typeof fetch;
  const result = await lookupAIBarcode(gtin, { apiKey: 'test-key', baseUrl: 'https://ai.example/' }, fake);
  assertEquals(calls, 1); assertEquals(result.status, 'candidates'); assertEquals(result.products[0].title, title);
  assertEquals(result.products[0].verificationStatus, 'ai_suggested'); assertEquals(result.products[0].confidence, 0.79);
  assertEquals(result.products[0].sourceUrls, []); assertEquals(result.products[0].url, '');
  assertEquals(result.products[0].specifics.Price, undefined); assertEquals(result.products[0].specifics.Condition, undefined);
  assertEquals(result.products[0].releaseDate, ''); assertEquals(result.products[0].region, '');
  assertEquals(result.products[0].categoryId, ''); assertEquals('image' in result.products[0], false);
});
Deno.test('configured OpenAI model uses the same server credential without provider fallback/replay', async () => {
  let calls=0;
  const result=await lookupAIBarcode(gtin,{apiKey:'key',baseUrl:'https://ai.example',provider:'openai'},(async(_input,init)=>{calls++;assertEquals(JSON.parse(String(init?.body)).model,'openai/gpt-5-mini');return Response.json(payload());}) as typeof fetch);
  assertEquals(result.status,'candidates');assertEquals(calls,1);
});
Deno.test('invalid check digit and missing credentials do not contact AI', async () => {
  let calls=0;const fake=(async()=>{calls++;return Response.json(payload());}) as typeof fetch;
  assertEquals((await lookupAIBarcode('5014503238123',{apiKey:'key',baseUrl:'https://ai.example'},fake)).status,'invalid');
  assertEquals((await lookupAIBarcode(gtin,{},fake)).status,'unavailable');assertEquals(calls,0);
});
Deno.test('wrong identifiers, low confidence and unknown outcomes never become product matches',()=>{
  assertEquals(parseAIBarcodeResult(payload({barcode:'5051892055116'}),gtin).products,[]);
  assertEquals(parseAIBarcodeResult(payload({confidence:0.4}),gtin).status,'no_match');
  assertEquals(parseAIBarcodeResult({choices:[{message:{content:'{"status":"no_match","products":[]}'}}]},gtin).status,'no_match');
  assertEquals(parseAIBarcodeResult({},gtin).status,'unavailable');
  assertEquals(parseAIBarcodeResult({choices:[{message:{content:'invalid'}}]},gtin).status,'unavailable');
  assertEquals(parseAIBarcodeResult({choices:[{finish_reason:'length',message:{content:'{}'}}]},gtin).status,'unavailable');
});
Deno.test('only independent provider extracts retain URLs; citations never upgrade AI verification',()=>{
  const response=payload();
  (response.choices[0].message as any).annotations=[{type:'url_citation',url_citation:{url:'https://catalogue.example/product',content:`${gtin} Doctor Who Series 3 Volume 1 DVD`}}];
  const result=parseAIBarcodeResult(response,gtin);assertEquals(result.products[0].sourceUrls,['https://catalogue.example/product']);assertEquals(result.products[0].verificationStatus,'ai_suggested');
  for(const url of ['javascript:alert(1)','http://catalogue.example/item','https://127.0.0.1/item','https://user:pass@catalogue.example/item','https://host.local/item']){
    (response.choices[0].message as any).annotations=[{type:'url_citation',url_citation:{url,content:`${gtin} Doctor Who Series 3 Volume 1 DVD`}}];
    assertEquals(parseAIBarcodeResult(response,gtin).products[0].sourceUrls,[]);
  }
});
Deno.test('network and provider failures never leak response bodies or retry paid calls',async()=>{
  for(const status of [429,500]){let calls=0;const result=await lookupAIBarcode(gtin,{apiKey:'key',baseUrl:'https://ai.example'},(async()=>{calls++;return new Response('private response',{status});}) as typeof fetch);assertEquals(result.status,'unavailable');assertEquals(calls,1);assertEquals(result.message.includes('private'),false);}
  const result=await lookupAIBarcode(gtin,{apiKey:'key',baseUrl:'https://ai.example'},(async()=>{throw new Error('private transport');}) as typeof fetch);assertEquals(result.status,'unavailable');assertEquals(result.message.includes('private'),false);
});
