import fs from 'node:fs';
import {
  boundedSellerRepairChunks,
  SellerRepairPageError,
  verifiedSellerSectionPage,
} from '../../supabase/functions/_shared/verifiedSellerRepairPage';

const item = (id: string) => `<Item><ItemID>${id}</ItemID></Item>`;
const ids = (start: number, amount: number) =>
  Array.from({ length: amount }, (_, index) => String(start + index).padStart(12, '0'));
const section = (
  name: string, itemIds: string[], pages = 2, total = 215,
) => `<${name}><ItemArray>${itemIds.map(item).join('')}</ItemArray><PaginationResult>
  <TotalNumberOfPages>${pages}</TotalNumberOfPages>
  <TotalNumberOfEntries>${total}</TotalNumberOfEntries>
  </PaginationResult></${name}>`;

test('repair counts only the requested eBay list, not 300 items across ReturnAll containers', () => {
  const active = ids(100000000001, 100);
  const sold = ids(200000000001, 100);
  const ended = ids(300000000001, 100);
  const xml = `<GetMyeBaySellingResponse><Ack>Success</Ack>
    ${section('SoldList', sold, 4, 390)}
    ${section('ActiveList', active, 2, 160)}
    ${section('UnsoldList', ended, 7, 650)}
  </GetMyeBaySellingResponse>`;
  const first = verifiedSellerSectionPage(xml, 'ActiveList', 1);
  expect(first).toEqual({ ids: active, totalPages: 2 });
  expect(verifiedSellerSectionPage(xml, 'SoldList', 1)).toEqual({ ids: sold, totalPages: 4 });
  expect(verifiedSellerSectionPage(xml, 'UnsoldList', 1)).toEqual({ ids: ended, totalPages: 7 });
  expect(boundedSellerRepairChunks(first.ids)).toEqual([active]);
});

test('oversized verified seller page uses 100-ID RPC chunks without losing a record', () => {
  const all = ids(400000000001, 157);
  const parsed = verifiedSellerSectionPage(section('ActiveList', all, 2, 220), 'ActiveList', 1);
  const chunks = boundedSellerRepairChunks(parsed.ids);
  expect(chunks.map(batch => batch.length)).toEqual([100, 57]);
  expect(chunks.flat()).toEqual(all);
  expect(new Set(chunks.flat()).size).toBe(157);
});

test('sold transaction duplicates repair the same exact eBay listing at most once', () => {
  const transaction = (id: string) => `<OrderTransaction><Transaction>${item(id)}</Transaction></OrderTransaction>`;
  const body = `<SoldList><OrderTransactionArray>
    ${transaction('123456789012')}${transaction('123456789012')}${transaction('123456789013')}
    </OrderTransactionArray><PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages>
    <TotalNumberOfEntries>3</TotalNumberOfEntries></PaginationResult></SoldList>`;
  expect(verifiedSellerSectionPage(body, 'SoldList', 1).ids).toEqual(['123456789012', '123456789013']);
});

test('seller page rejects malformed identity evidence, mismatched pagination and unsafe breadth', () => {
  expect(() => verifiedSellerSectionPage(section('ActiveList', ['invalid']), 'ActiveList', 1))
    .toThrow(SellerRepairPageError);
  expect(() => verifiedSellerSectionPage(section('ActiveList', ids(100000000001, 1), 2), 'ActiveList', 3))
    .toThrow(/pagination changed/);
  expect(() => verifiedSellerSectionPage(section('ActiveList', ids(100000000001, 1), 51), 'ActiveList', 1))
    .toThrow(/50-page safety limit/);
  expect(() => verifiedSellerSectionPage(section('ActiveList', ids(100000000001, 201)), 'ActiveList', 1))
    .toThrow(/200-ID response limit/);
  expect(verifiedSellerSectionPage('<UnsoldList/>', 'UnsoldList', 1))
    .toEqual({ ids: [], totalPages: 0 });
  expect(() => verifiedSellerSectionPage('<ActiveList/>', 'SoldList', 1))
    .toThrow(/requested seller section/);
  expect(() => verifiedSellerSectionPage('<ActiveList><ItemArray/></ActiveList>', 'ActiveList', 1))
    .toThrow(/pagination was not confirmed/);
});

test('browse repair only uses verified seller pages and existing service-role ownership RPC', () => {
  const worker = fs.readFileSync('supabase/functions/swish-ebay-browse/index.ts', 'utf8');
  const scoped = worker.split('async function repairSellerImportBindings(')[1]
    .split('serveModule(withEdgeFunctionLogging')[0];
  const sql = fs.readFileSync('supabase/migrations/20261123_verified_ebay_reimport_binding_repair.sql', 'utf8');
  expect(scoped).toContain('prepareMemberBinding(userId,tenantId)');
  expect(scoped).toContain('readEbayIdentity(token)');
  expect(scoped).toContain('const requested=verifiedSellerSectionPage(xml,section as VerifiedSellerSection,page)');
  expect(scoped).toContain('const groups=boundedSellerRepairChunks(ids)');
  expect(scoped).toContain("p_external_ids:batchIds");
  expect(scoped).toContain('excludedSections');
  expect(scoped).toContain('Number(done.processed)!==batchIds.length');
  expect(scoped).toContain(String.raw`xml.match(/<ItemID>(\d+)<\/ItemID>/)`);
  expect(scoped).not.toMatch(/xml\.matchAll\(\/<Item/);
  expect(scoped).not.toMatch(/AddFixedPriceItem|EndFixedPriceItem|ReviseFixedPriceItem/);
  expect(sql).toContain("auth.role() is distinct from 'service_role'");
  expect(sql).toContain("cardinality(p_external_ids)>100");
  expect(sql).not.toMatch(/update public\.(items|listings) set (status|price|media|published_at)/i);
});
