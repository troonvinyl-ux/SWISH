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

interface PendingListingDetails {
  title: string;
  categoryId: string;
  startingPrice: number;
  decode: (value: string) => string;
}

/** A seller-entered item number is a candidate until eBay confirms its identity. */
export function verifyPendingEbayItem(xml: string, expectedId: string, seller: string, escapedSku: string, details?: PendingListingDetails) {
  const observation = parseEbayListingStatus(xml, expectedId);
  const item = tag(xml, 'Item');
  const observedSeller = tag(tag(item, 'Seller'), 'UserID');
  const startedAt = tag(tag(item, 'ListingDetails'), 'StartTime');
  const observedSku = tag(item, 'SKU');
  const startPrice = tag(item, 'StartPrice');
  const exactDetails = details && details.title && details.categoryId &&
    details.decode(tag(item, 'Title')) === details.title &&
    tag(tag(item, 'PrimaryCategory'), 'CategoryID') === details.categoryId &&
    /^\d+(?:\.\d{1,2})?$/.test(startPrice) &&
    details.startingPrice > 0 && Number(startPrice) === details.startingPrice &&
    tag(item, 'Currency') === 'GBP';
  // A conflicting SKU is stronger evidence than an otherwise identical title.
  const sameItem = escapedSku && observedSku ? escapedSku === observedSku : exactDetails;
  if (!seller || observedSeller.toLowerCase() !== seller.toLowerCase() ||
    !sameItem || !Number.isFinite(Date.parse(startedAt))) {
    throw new Error('eBay could not verify the seller, listing details and start time for this pending listing.');
  }
  return { ...observation, startedAt };
}
