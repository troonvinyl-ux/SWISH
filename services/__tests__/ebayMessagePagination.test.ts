import {
  buildGetEbayMessagesRequest,
  extractEbayMessageSummaryBlocks,
  extractEbayXmlTag,
  getEbayMessagePagePlan,
  MAX_EBAY_MESSAGE_PAGES,
} from '../../shared/ebayMessagePagination';

describe('eBay message pagination helpers', () => {
  test('builds a requested page and escapes token XML characters', () => {
    const request = buildGetEbayMessagesRequest('token<&', '2026-11-01T00:00:00.000Z', '2026-11-02T00:00:00.000Z', 2);
    expect(request).toContain('<eBayAuthToken>token&lt;&amp;</eBayAuthToken>');
    expect(request).toContain('<EntriesPerPage>50</EntriesPerPage><PageNumber>2</PageNumber>');
  });

  test('extracts total pages and message summaries from default-namespace XML', () => {
    const xml = '<GetMyMessagesResponse><PaginationResult><TotalNumberOfPages>3</TotalNumberOfPages></PaginationResult><Messages><MessageSummary><MessageID>A</MessageID></MessageSummary><MessageSummary><MessageID>B</MessageID></MessageSummary></Messages></GetMyMessagesResponse>';
    expect(extractEbayXmlTag(xml, 'TotalNumberOfPages')).toBe('3');
    expect(extractEbayMessageSummaryBlocks(xml)).toHaveLength(2);
    expect(getEbayMessagePagePlan(xml)).toEqual({ reportedPages: 3, pagesToFetch: 3, truncated: false });
  });

  test('accepts prefixed XML and caps unexpectedly large page counts', () => {
    const xml = '<e:GetMyMessagesResponse><e:PaginationResult><e:TotalNumberOfPages>99</e:TotalNumberOfPages></e:PaginationResult><e:MessageSummary><e:MessageID>C</e:MessageID></e:MessageSummary></e:GetMyMessagesResponse>';
    const plan = getEbayMessagePagePlan(xml);
    expect(plan.reportedPages).toBe(99);
    expect(plan.pagesToFetch).toBe(MAX_EBAY_MESSAGE_PAGES);
    expect(plan.truncated).toBe(true);
    expect(extractEbayMessageSummaryBlocks(xml)).toHaveLength(1);
  });

  test('falls back to one page when pagination metadata is absent or invalid', () => {
    expect(getEbayMessagePagePlan('<Response/>')).toEqual({ reportedPages: 1, pagesToFetch: 1, truncated: false });
    expect(getEbayMessagePagePlan('<Response><TotalNumberOfPages>0</TotalNumberOfPages></Response>').pagesToFetch).toBe(1);
  });

  test('rejects invalid page numbers rather than emitting malformed requests', () => {
    expect(() => buildGetEbayMessagesRequest('token', 'start', 'end', 0)).toThrow(RangeError);
    expect(() => buildGetEbayMessagesRequest('token', 'start', 'end', MAX_EBAY_MESSAGE_PAGES + 1)).toThrow(RangeError);
  });
});
