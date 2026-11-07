// Pure/injected provider tests: no paid AI calls, source fetching or live device verification.
import { assertEquals, assertStringIncludes } from 'jsr:@std/assert';
import { lookupAIBarcode, parseAIBarcodeResult } from '../functions/_shared/aiBarcodeLookup.ts';
const gtin = '5024866335279';
const title = 'Colin McRae DiRT Xbox 360';
const quote = `${gtin} Colin McRae DiRT Xbox 360, publisher Codemasters, released 2007.`;
const sourceUrl = 'https://catalogue.example/games/dirt-xbox-360';
function payload(overrides: Record<string, unknown> = {}, annotations: unknown[] = [{ type: 'url_citation', url_citation: { url: sourceUrl, content: quote } }]) {
  return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ status: 'matched', product: { gtin, title, brand: 'Codemasters', model: '', confidence: 0.9, specifics: { Platform: 'Microsoft Xbox 360', Publisher: 'Codemasters', 'Release Year': '2007', Condition: 'New', Price: '99', 'Country/Region of Manufacture': 'United Kingdom' }, sources: [{ url: sourceUrl, quote }], ...overrides } }), annotations } }] };
}
Deno.test('AI-first lookup uses the injected OnSpace endpoint and makes only one provider call', async () => {
  let calls = 0;
  const fake = (async (input: RequestInfo | URL, options?: RequestInit) => {
    calls++;
    assertEquals(String(input), 'https://ai.example/chat/completions');
    assertEquals(new Headers(options?.headers).get('Authorization'), 'Bearer test-key');
    const body = JSON.parse(String(options?.body));
    assertEquals(body.model, 'google/gemini-3-flash-preview');
    assertEquals(body.plugins[0].id, 'web');
    assertStringIncludes(body.messages[1].content, gtin);
    assertStringIncludes(body.messages[0].content, 'does not establish country of manufacture');
    return Response.json(payload());
  }) as typeof fetch;
  const result = await lookupAIBarcode(gtin, { apiKey: 'test-key', baseUrl: 'https://ai.example/' }, fake);
  assertEquals(calls, 1); assertEquals(result.status, 'candidates');
  assertEquals(result.products[0].title, title); assertEquals(result.products[0].source, 'OnSpace AI');
  assertEquals(result.products[0].specifics.Platform, 'Microsoft Xbox 360');
  assertEquals(result.products[0].sourceUrls, [sourceUrl]);
  assertEquals(result.products[0].categoryId, '');
  assertEquals(result.products[0].specifics.Condition, undefined);
  assertEquals(result.products[0].specifics.Price, undefined);
  assertEquals(result.products[0].specifics['Country/Region of Manufacture'], undefined);
  assertEquals('image' in result.products[0], false);
});
Deno.test('invalid checksum and missing AI configuration do not contact a provider', async () => {
  let calls = 0; const fake = (async () => { calls++; return Response.json(payload()); }) as typeof fetch;
  assertEquals((await lookupAIBarcode('5024866335278', { apiKey: 'test', baseUrl: 'https://ai.example' }, fake)).status, 'invalid');
  assertEquals((await lookupAIBarcode(gtin, {}, fake)).status, 'unavailable');
  assertEquals(calls, 0);
});
Deno.test('a fabricated or absent citation never becomes an established barcode match', () => {
  assertEquals(parseAIBarcodeResult(payload({}, []), gtin).status, 'no_match');
  assertEquals(parseAIBarcodeResult(payload({ sources: [{ url: 'https://invented.example/product', quote }] }), gtin).products, []);
  assertEquals(parseAIBarcodeResult(payload({ sources: [{ url: sourceUrl, quote: 'A racing game, no product barcode' }] }), gtin).products, []);
});
Deno.test('provider source extracts must contain the matching product and exact barcode when available', () => {
  const wrong = [{ type: 'url_citation', url_citation: { url: sourceUrl, content: '5051892055116 LEGO Harry Potter Xbox 360' } }];
  assertEquals(parseAIBarcodeResult(payload({}, wrong), gtin).status, 'no_match');
  assertEquals(parseAIBarcodeResult(payload({ gtin: '5051892055116' }), gtin).status, 'no_match');
  assertEquals(parseAIBarcodeResult(payload({ confidence: 0.4 }), gtin).status, 'no_match');
});
Deno.test('source URLs cannot be scripts, non-HTTPS, credentials or local/IP addresses', () => {
  for (const url of ['javascript:alert(1)', 'http://catalogue.example/item', 'https://127.0.0.1/item', 'https://user:pass@catalogue.example/item', 'https://host.local/item']) {
    const annotations = [{ type: 'url_citation', url_citation: { url, content: quote } }];
    assertEquals(parseAIBarcodeResult(payload({ sources: [{ url, quote }] }, annotations), gtin).products, []);
  }
});
Deno.test('unknown, malformed and truncated AI responses remain distinct outcomes', () => {
  const unknown = { choices: [{ message: { content: JSON.stringify({ status: 'no_match' }) } }] };
  assertEquals(parseAIBarcodeResult(unknown, gtin).status, 'no_match');
  assertEquals(parseAIBarcodeResult({}, gtin).status, 'unavailable');
  assertEquals(parseAIBarcodeResult({ choices: [{ message: { content: 'not JSON' } }] }, gtin).status, 'unavailable');
  assertEquals(parseAIBarcodeResult({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] }, gtin).status, 'unavailable');
});
Deno.test('network and provider failures never leak provider bodies or retry the paid request', async () => {
  for (const status of [429, 500]) {
    let calls = 0;
    const result = await lookupAIBarcode(gtin, { apiKey: 'test', baseUrl: 'https://ai.example' }, (async () => { calls++; return new Response('private provider body', { status }); }) as typeof fetch);
    assertEquals(result.status, 'unavailable'); assertEquals(calls, 1);
    assertEquals(result.message.includes('private provider body'), false);
  }
  const network = await lookupAIBarcode(gtin, { apiKey: 'test', baseUrl: 'https://ai.example' }, (async () => { throw new Error('private transport data'); }) as typeof fetch);
  assertEquals(network.status, 'unavailable'); assertEquals(network.message.includes('private transport data'), false);
});
