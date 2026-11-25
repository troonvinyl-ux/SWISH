/** Pure eBay GetItem status parsing. No title/price heuristics or default-live fallback. */
export interface EbayStatusObservation {
  externalId: string; status: 'active' | 'sold' | 'ended'; quantity: number; quantitySold: number; endedAt: string | null;
}
function tag(xml: string, name: string): string {
  return xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1]?.trim() ?? '';
}
export function parseEbayListingStatus(xml: string, expectedId: string): EbayStatusObservation {
  if (!['Success','Warning'].includes(tag(xml,'Ack'))) throw new Error('eBay did not confirm the listing status');
  const item = tag(xml,'Item');
  const externalId = tag(item,'ItemID');
  if (!externalId || externalId !== expectedId) throw new Error('eBay returned a different listing identity');
  const selling = tag(item,'SellingStatus');
  const listingStatus = tag(selling,'ListingStatus').toLowerCase();
  const q = tag(item,'Quantity'); const sold = tag(selling,'QuantitySold');
  if (!/^\d+$/.test(q) || !/^\d+$/.test(sold)) throw new Error('eBay quantity evidence is incomplete');
  const quantity = Number(q); const quantitySold = Number(sold);
  if (quantity < 1 || !Number.isSafeInteger(quantity) || !Number.isSafeInteger(quantitySold)) throw new Error('Invalid eBay quantity evidence');
  if (!['active','completed','ended'].includes(listingStatus)) throw new Error('eBay returned an unrecognized listing status');
  const status = quantitySold >= quantity ? 'sold' : listingStatus === 'active' ? 'active' : 'ended';
  const end = tag(tag(item,'ListingDetails'),'EndTime');
  const endedAt = status !== 'active' && end && Number.isFinite(Date.parse(end)) && Date.parse(end) <= Date.now() ? end : null;
  return { externalId, status, quantity, quantitySold, endedAt };
}

/** A seller-entered item number is only a candidate. Require seller and stock evidence. */
export function verifyPendingEbayItem(xml: string, expectedId: string, seller: string, escapedSku: string) {
  const observation = parseEbayListingStatus(xml, expectedId);
  const item = tag(xml, 'Item');
  const observedSeller = tag(tag(item, 'Seller'), 'UserID');
  const startedAt = tag(tag(item, 'ListingDetails'), 'StartTime');
  if (!seller || observedSeller.toLowerCase() !== seller.toLowerCase() ||
    !escapedSku || tag(item, 'SKU') !== escapedSku || !Number.isFinite(Date.parse(startedAt))) {
    throw new Error('eBay could not verify the seller, stock SKU and start time for this pending listing.');
  }
  return { ...observation, startedAt };
}
