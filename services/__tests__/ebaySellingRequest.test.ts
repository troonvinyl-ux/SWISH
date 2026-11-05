// Pure XML contracts, no eBay calls, secrets or inventory mutations.
import fs from 'node:fs';
import {buildSellingRequest,sellingSectionXml,sellingPagination,tradingDiagnostic} from '@/shared/ebaySellingRequest';
describe('GetMyeBaySelling request repair',()=>{
 test.each(['ActiveList','SoldList','UnsoldList'] as const)('%s excludes other sections and unsupported inputs',section=>{
  const request=buildSellingRequest(section,2);
  expect(request).toContain(`<${section}><Include>true</Include>`);
  expect(request).toContain('<PageNumber>2</PageNumber>');
  expect(request).not.toContain('IncludeItemSpecifics');expect(request).not.toContain('TimeLeft');expect(request).not.toContain('ReturnAll');expect(request).not.toContain('RequesterCredentials');
  expect(request).toContain('<ScheduledList><Include>false</Include>');
 });
 test('reads the requested section, not an earlier unrelated total',()=>{
  const xml='<Response><ActiveList><TotalNumberOfPages>9</TotalNumberOfPages></ActiveList><SoldList><PaginationResult><TotalNumberOfPages>2</TotalNumberOfPages><TotalNumberOfEntries>150</TotalNumberOfEntries></PaginationResult></SoldList></Response>';
  expect(sellingPagination(xml,'SoldList')).toEqual({pages:2,entries:150});expect(sellingSectionXml(xml,'SoldList')).not.toContain('>9<');
 });
 test('diagnostics expose numeric codes only, not OAuth-bearing XML',()=>{expect(tradingDiagnostic('<Errors><ErrorCode>518</ErrorCode><LongMessage>secret-token</LongMessage></Errors>',200)).toBe('eBay Trading HTTP 200; error codes 518');});
 test('cannot silently truncate unexpected pagination',()=>{expect(()=>sellingPagination('<ActiveList><TotalNumberOfPages>999</TotalNumberOfPages></ActiveList>','ActiveList')).toThrow();});
 test('backend policy is a byte-identical deployment asset',()=>{expect(fs.readFileSync('shared/ebaySellingRequest.ts','utf8')).toBe(fs.readFileSync('supabase/functions/_shared/ebaySellingRequest.ts','utf8'));});
 test('sync uses supported GetItem, OAuth header, canonical status RPC and independent readback',()=>{const code=fs.readFileSync('supabase/functions/swish-ebay-sync/index.ts','utf8');expect(code).toContain('<GetItemRequest');expect(code).not.toContain('<GetItemsRequest');expect(code).toContain("'X-EBAY-API-IAF-TOKEN':token");expect(code).toContain("rpc('swish_apply_ebay_listing_status'");expect(code).toContain('SWISH sync persisted readback failed');});
});
