import {
  buildGetEbayMessageBodyRequest,
  buildGetEbayMessagesRequest,
  extractEbayMessageBlocks,
  extractEbayMessageBody,
  extractEbayXmlTag,
  getEbayMessagePagePlan,
  MAX_EBAY_MESSAGE_PAGES,
} from '../../shared/ebayMessagePagination';

describe('eBay GetMyMessages API helpers', () => {
  test('builds ReturnHeaders request with pagination and escaped token', () => {
    const request = buildGetEbayMessagesRequest('token<&', '2026-11-01T00:00:00.000Z', '2026-11-02T00:00:00.000Z', 2);
    expect(request).toContain('<DetailLevel>ReturnHeaders</DetailLevel>');
    expect(request).toContain('<eBayAuthToken>token&lt;&amp;</eBayAuthToken>');
    expect(request).toContain('<EntriesPerPage>50</EntriesPerPage><PageNumber>2</PageNumber>');
  });

  test('parses documented Message elements and pagination from default-namespace XML', () => {
    const xml = '<GetMyMessagesResponse><PaginationResult><TotalNumberOfPages>3</TotalNumberOfPages></PaginationResult><Messages><Message><MessageID>A</MessageID><Sender>Buyer A</Sender></Message><Message><MessageID>B</MessageID><Sender>Buyer B</Sender></Message></Messages></GetMyMessagesResponse>';
    expect(extractEbayXmlTag(xml, 'TotalNumberOfPages')).toBe('3');
    expect(extractEbayMessageBlocks(xml)).toHaveLength(2);
    expect(extractEbayXmlTag(extractEbayMessageBlocks(xml)[0], 'MessageID')).toBe('A');
    expect(getEbayMessagePagePlan(xml)).toEqual({ reportedPages: 3, pagesToFetch: 3, truncated: false });
  });

  test('accepts namespace-prefixed Message XML and caps unexpectedly large page counts', () => {
    const xml = '<e:GetMyMessagesResponse><e:PaginationResult><e:TotalNumberOfPages>99</e:TotalNumberOfPages></e:PaginationResult><e:Messages><e:Message><e:MessageID>C</e:MessageID></e:Message></e:Messages></e:GetMyMessagesResponse>';
    const plan = getEbayMessagePagePlan(xml);
    expect(plan.reportedPages).toBe(99);
    expect(plan.pagesToFetch).toBe(MAX_EBAY_MESSAGE_PAGES);
    expect(plan.truncated).toBe(true);
    expect(extractEbayMessageBlocks(xml)).toHaveLength(1);
  });

  test('builds a ReturnMessages request for one on-demand message body', () => {
    const request = buildGetEbayMessageBodyRequest('token<&', 'message<&1');
    expect(request).toContain('<DetailLevel>ReturnMessages</DetailLevel>');
    expect(request).toContain('<MessageIDs><MessageID>message&lt;&amp;1</MessageID></MessageIDs>');
    expect(request).toContain('<eBayAuthToken>token&lt;&amp;</eBayAuthToken>');
    expect(() => buildGetEbayMessageBodyRequest('token', '')).toThrow(RangeError);
  });

  test('extracts and safely converts a CDATA HTML message body to readable text', () => {
    const xml = '<GetMyMessagesResponse><Messages><Message><MessageID>m1</MessageID><Text><![CDATA[<p>Hello &amp; welcome</p><br/>Buyer]]></Text></Message></Messages></GetMyMessagesResponse>';
    expect(extractEbayMessageBody(xml)).toBe('Hello & welcome\nBuyer');
  });

  test('falls back to Content when Text is absent', () => {
    const xml = '<GetMyMessagesResponse><Messages><Message><Content>Thanks&nbsp;for&nbsp;your&nbsp;message.</Content></Message></Messages></GetMyMessagesResponse>';
    expect(extractEbayMessageBody(xml)).toBe('Thanks for your message.');
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
