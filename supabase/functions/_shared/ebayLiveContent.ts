import { XMLParser, XMLValidator } from 'npm:fast-xml-parser@4.5.3';
import type { LiveListingContent } from './ebayRevisionContract.ts';
const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false, trimValues: false, processEntities: true });
const scalar = (value: any): string => typeof value === 'object' && value !== null ? String(value['#text'] ?? '') : String(value ?? '');
/** GetItem seller snapshot, never Browse/public buyer-inclusive prices. */
export function parseLiveContent(xml: string, expectedId: string): LiveListingContent {
  if (xml.length > 1_000_000 || XMLValidator.validate(xml) !== true) throw new Error('eBay returned an invalid live snapshot.');
  const root = parser.parse(xml).GetItemResponse;
  if (!root || !['Success', 'Warning'].includes(scalar(root.Ack))) throw new Error('eBay did not confirm live listing details.');
  const item = root.Item;
  if (!item || scalar(item.ItemID).trim() !== expectedId) throw new Error('eBay returned a different listing identity.');
  const listingType = scalar(item.ListingType).trim();
  // StartPrice is the seller's asking/start price; CurrentPrice for an auction
  // may be a bid, and public Browse prices may include buyer-only fees.
  const amount = item.StartPrice ?? (listingType === 'FixedPriceItem' ? item.SellingStatus?.CurrentPrice : undefined);
  const sellerPrice = Number(scalar(amount));
  const currency = scalar(amount?.['@_currencyID']).trim();
  const description = scalar(item.Description);
  const title = scalar(item.Title);
  // Oversize descriptions are a failed read, never a silently truncated DB write.
  if (new TextEncoder().encode(description).byteLength > 100_000) throw new Error('eBay description exceeds safe inline storage size. Saved edits were preserved.');
  if (!amount || !Number.isFinite(sellerPrice) || sellerPrice < 0 || !currency || !title.trim() || item.Description === undefined) throw new Error('eBay live price or description evidence is incomplete.');
  return { externalListingId: expectedId, title, description, sellerPrice, currency, listingType, checkedAt: new Date().toISOString() };
}
