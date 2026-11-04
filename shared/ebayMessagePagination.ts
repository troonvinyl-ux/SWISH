/**
 * Pure helpers for bounded eBay Trading API GetMyMessages pagination.
 * Kept outside the Edge Function so request construction and XML page parsing
 * can be covered by the shared Jest regression suite.
 */
export const MAX_EBAY_MESSAGE_PAGES = 10;
export const EBAY_MESSAGE_PAGE_SIZE = 50;

export function extractEbayXmlTag(xml: string, tag: string): string {
  const safeTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `<(?:[A-Za-z0-9_.-]+:)?${safeTag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_.-]+:)?${safeTag}\\s*>`,
    'i',
  );
  return xml.match(pattern)?.[1]?.trim() ?? '';
}

export function extractEbayMessageSummaryBlocks(xml: string): string[] {
  const pattern = /<(?:[A-Za-z0-9_.-]+:)?MessageSummary\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_.-]+:)?MessageSummary\\s*>/gi;
  return Array.from(xml.matchAll(pattern), match => match[1]);
}

export function extractEbayMessageBlocks(xml: string): string[] {
  const pattern = /<(?:[A-Za-z0-9_.-]+:)?Message\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?Message\s*>/gi;
  return Array.from(xml.matchAll(pattern), match => match[1]);
}

function decodeEbayMessageText(value: string): string {
  const cdata = value.trim().match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  const decoded = (cdata?.[1] ?? value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
  return decoded
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div|li|tr)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractEbayMessageBody(xml: string): string {
  const message = extractEbayMessageBlocks(xml)[0] ?? xml;
  const raw = extractEbayXmlTag(message, 'Content') || extractEbayXmlTag(message, 'Text');
  return raw ? decodeEbayMessageText(raw) : '';
}

export function getEbayMessagePagePlan(xml: string): {
  reportedPages: number;
  pagesToFetch: number;
  truncated: boolean;
} {
  const parsed = Number.parseInt(extractEbayXmlTag(xml, 'TotalNumberOfPages'), 10);
  const reportedPages = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  return {
    reportedPages,
    pagesToFetch: Math.min(reportedPages, MAX_EBAY_MESSAGE_PAGES),
    truncated: reportedPages > MAX_EBAY_MESSAGE_PAGES,
  };
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function buildGetEbayMessagesRequest(
  accessToken: string,
  startTime: string,
  endTime: string,
  pageNumber: number,
): string {
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > MAX_EBAY_MESSAGE_PAGES) {
    throw new RangeError('Invalid eBay messages page number.');
  }
  return `<?xml version="1.0" encoding="utf-8"?>
<GetMyMessagesRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${xmlEscape(accessToken)}</eBayAuthToken></RequesterCredentials>
  <DetailLevel>ReturnHeaders</DetailLevel>
  <FolderID>0</FolderID>
  <StartCreationTime>${xmlEscape(startTime)}</StartCreationTime>
  <EndCreationTime>${xmlEscape(endTime)}</EndCreationTime>
  <Pagination><EntriesPerPage>${EBAY_MESSAGE_PAGE_SIZE}</EntriesPerPage><PageNumber>${pageNumber}</PageNumber></Pagination>
</GetMyMessagesRequest>`;
}


export function buildGetEbayMessageBodyRequest(accessToken: string, messageId: string): string {
  if (!messageId.trim() || messageId.length > 200) throw new RangeError('Invalid eBay message ID.');
  return `<?xml version="1.0" encoding="utf-8"?>
<GetMyMessagesRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <DetailLevel>ReturnMessages</DetailLevel>
  <RequesterCredentials><eBayAuthToken>${xmlEscape(accessToken)}</eBayAuthToken></RequesterCredentials>
  <MessageIDs><MessageID>${xmlEscape(messageId)}</MessageID></MessageIDs>
</GetMyMessagesRequest>`;
}
