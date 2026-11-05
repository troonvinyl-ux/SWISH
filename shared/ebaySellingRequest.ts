/** Pure Trading request/response contract. Never include credentials in diagnostics. */
export type SellingSection = 'ActiveList' | 'SoldList' | 'UnsoldList';
export function buildSellingRequest(section: SellingSection, page: number, perPage = 100): string {
  if (!['ActiveList','SoldList','UnsoldList'].includes(section) || !Number.isInteger(page) || page < 1 || page > 125) throw new Error('Invalid selling pagination');
  const sections = ['ActiveList','SoldList','UnsoldList','ScheduledList','SellingSummary'];
  const containers = sections.map(name => name === section
    ? `<${name}><Include>true</Include>${name === 'ActiveList' ? '' : '<DurationInDays>60</DurationInDays>'}<Pagination><EntriesPerPage>${Math.max(1,Math.min(200,perPage))}</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination></${name}>`
    : `<${name}><Include>false</Include></${name}>`).join('');
  return `<?xml version="1.0" encoding="utf-8"?><GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">${containers}</GetMyeBaySellingRequest>`;
}
export function sellingSectionXml(xml: string, section: SellingSection): string {
  return xml.match(new RegExp(`<${section}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${section}>`, 'i'))?.[1] ?? '';
}
export function tradingErrorCodes(xml: string): string[] {
  return [...new Set([...xml.matchAll(/<ErrorCode>\s*(\d+)\s*<\/ErrorCode>/gi)].map(match=>match[1]))].slice(0,8);
}
export function tradingDiagnostic(xml: string, status: number): string {
  const codes = tradingErrorCodes(xml);
  // Only numeric codes/status are returned; never raw XML, tokens or provider payloads.
  return `eBay Trading HTTP ${status}${codes.length ? `; error codes ${codes.join(', ')}` : '; response not verified'}`;
}
export function sellingPagination(xml: string, section: SellingSection): { pages: number; entries: number | null } {
  const body = sellingSectionXml(xml,section);
  const pagesText = body.match(/<TotalNumberOfPages>(\d+)<\/TotalNumberOfPages>/)?.[1];
  const entriesText = body.match(/<TotalNumberOfEntries>(\d+)<\/TotalNumberOfEntries>/)?.[1];
  if (!body) return { pages:1,entries:null }; // An omitted container is a valid empty section.
  const pages = Number(pagesText ?? 1);
  if (!Number.isInteger(pages) || pages < 0 || pages > 125) throw new Error('Selling page count is incomplete or exceeds supported limit');
  return { pages:Math.max(1,pages),entries:entriesText === undefined ? null : Number(entriesText) };
}
