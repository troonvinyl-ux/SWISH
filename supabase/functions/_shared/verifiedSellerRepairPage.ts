/**
 * Read identity evidence only from the seller container that we requested.
 * GetMyeBaySelling can return other selling containers when DetailLevel is
 * ReturnAll; a global <Item> search must never count (or repair) their IDs.
 *
 * No user-supplied ID is accepted as proof of seller ownership. This parser
 * operates only on XML returned by a successful, verified eBay Trading call.
 */
export type VerifiedSellerSection = 'ActiveList' | 'SoldList' | 'UnsoldList';
export class SellerRepairPageError extends Error {
  constructor(message: string, readonly statusCode: number = 503) {
    super(message);
    this.name = 'SellerRepairPageError';
  }
}

export function verifiedSellerSectionPage(
  xml: string, section: VerifiedSellerSection, page: number,
): { ids: string[]; totalPages: number } {
  if (!Number.isSafeInteger(page) || page < 1 || page > 50) {
    throw new SellerRepairPageError('Invalid bounded seller page.', 400);
  }
  const match = xml.match(new RegExp('<' + section + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + section + '>'));
  const emptyElement = new RegExp('<' + section + '\\s*/>').test(xml);
  if (!match) {
    if (emptyElement && page === 1) return { ids: [], totalPages: 0 };
    throw new SellerRepairPageError('eBay did not return the requested seller section. No bindings changed.');
  }

  const body = match[1];
  const countText = body.match(/<TotalNumberOfEntries>(\d+)<\/TotalNumberOfEntries>/)?.[1];
  const reportedCount = countText === undefined ? null : Number(countText);
  const pagesText = body.match(/<TotalNumberOfPages>(\d+)<\/TotalNumberOfPages>/)?.[1];
  if (pagesText === undefined && reportedCount !== 0) {
    throw new SellerRepairPageError('Requested eBay seller section pagination was not confirmed. No bindings changed.');
  }
  const totalPages = pagesText === undefined ? 0 : Number(pagesText);
  if (!Number.isSafeInteger(totalPages) || totalPages < 0) {
    throw new SellerRepairPageError('Invalid eBay seller page count; no records changed.');
  }
  if (totalPages > 50) {
    throw new SellerRepairPageError('This eBay section exceeds the 50-page safety limit. Existing records remain untouched; use a bounded seller date range before repair.', 409);
  }
  if (totalPages > 0 && page > totalPages) {
    throw new SellerRepairPageError('eBay seller pagination changed while importing. Earlier confirmed pages remain saved.', 409);
  }
  if (totalPages === 0 && page !== 1) {
    throw new SellerRepairPageError('Empty eBay seller section cannot contain later pages.', 409);
  }
  // SoldList may contain transactions nested in OrderTransaction elements.
  // Item IDs must be gathered from the requested section only, not the full
  // response. Never infer an ID from a title, SKU or seller input.
  const matches = [...body.matchAll(/<Item(?:\s[^>]*)?>([\s\S]*?)<\/Item>/g)];
  const ids = matches.map(item => item[1].match(/<ItemID>(\d+)<\/ItemID>/)?.[1] ?? '');
  if (ids.some(id => !/^\d{6,20}$/.test(id))) {
    throw new SellerRepairPageError('Some eBay seller item identities were incomplete; this page was not applied.');
  }
  const unique = [...new Set(ids)];
  // Trading pages are normally 100 or fewer because EntriesPerPage=100.
  // Tolerate an eBay response of up to 200, but apply it in safe <=100 RPC
  // chunks. Beyond that, reject the entire page rather than silently truncate.
  if (unique.length > 200) {
    throw new SellerRepairPageError('Requested eBay seller section exceeded the 200-ID response limit. Nothing from this page was applied.', 409);
  }
  if (unique.length === 0 && totalPages > 0 && reportedCount !== 0) {
    throw new SellerRepairPageError('eBay returned an empty seller page before pagination completed. No bindings changed.');
  }
  if (totalPages === 0 && unique.length > 0) {
    throw new SellerRepairPageError('eBay returned item identities without confirmed pagination. No bindings changed.');
  }
  return { ids: unique, totalPages };
}

/** Existing verified seller page must be written in chunks accepted by the
 * service-role-only RPC; no caller can arbitrarily broaden its scope. */
export function boundedSellerRepairChunks(ids: string[]): string[][] {
  if (ids.length > 200) throw new SellerRepairPageError('Seller page exceeds the bounded identity limit.', 409);
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
  return chunks;
}
