// Deno parser regression tests only. No HTTP, secrets, database or seller writes.
import { parseLiveContent } from '../functions/_shared/ebayLiveContent.ts';
import { descriptionXml, verifyRevisionContent } from '../functions/_shared/ebayRevisionContract.ts';
function equal(actual: unknown, expected: unknown) { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`); }
function rejects(fn: () => unknown) { let rejected = false; try { fn(); } catch { rejected = true; } if (!rejected) throw new Error('Expected rejection'); }
const expected = { externalListingId: '800878483330', title: 'Nicholas Bear', description: '<div>Harrods &#39;Nicholas&#39; & intact tags ]]> £35.</div>', price: 35 };
const response = (description: string, price = '35.00', currency = 'GBP') => `<GetItemResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack><Item><ItemID>800878483330</ItemID><Title>Nicholas Bear</Title><ListingType>FixedPriceItem</ListingType>${description}<StartPrice currencyID="${currency}">${price}</StartPrice><SellingStatus><CurrentPrice currencyID="GBP">42.00</CurrentPrice></SellingStatus></Item></GetItemResponse>`;
Deno.test('full escaped HTML round-trips with entities and CDATA terminators', () => {
  const live = parseLiveContent(response(descriptionXml(expected.description)), expected.externalListingId);
  equal(live.description, expected.description); equal(live.sellerPrice, 35); equal(verifyRevisionContent(live, expected), []);
});
Deno.test('existing CDATA GetItem descriptions are preserved in full', () => {
  const description = '<p>Harrods &amp; Bear</p>';
  const live = parseLiveContent(response(`<Description><![CDATA[${description}]]></Description>`), expected.externalListingId);
  equal(live.description, description);
});
Deno.test('does not use current auction/buyer-inclusive price as seller StartPrice', () => {
  equal(parseLiveContent(response(descriptionXml(expected.description)), expected.externalListingId).sellerPrice, 35);
});
Deno.test('wrong listing, missing description, missing currency and Failure Ack are rejected', () => {
  rejects(() => parseLiveContent(response(descriptionXml(expected.description)), 'other'));
  rejects(() => parseLiveContent(response(''), expected.externalListingId));
  rejects(() => parseLiveContent(response(descriptionXml(expected.description), '35', ''), expected.externalListingId));
  rejects(() => parseLiveContent(response(descriptionXml(expected.description)).replace('<Ack>Success</Ack>', '<Ack>Failure</Ack>'), expected.externalListingId));
});
Deno.test('£42 seller price and unchanged description cannot be a verified revision', () => {
  const live = parseLiveContent(response(descriptionXml('Condition: good · Keep as identified.'), '42'), expected.externalListingId);
  equal(verifyRevisionContent(live, expected).length, 2);
});
