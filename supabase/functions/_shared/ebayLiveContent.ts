import { XMLParser, XMLValidator } from 'npm:fast-xml-parser@4.5.3';
import type { LiveListingContent } from './ebayRevisionContract.ts';
const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false, trimValues: false, processEntities: true });
const scalar = (value: any): string => typeof value === 'object' && value !== null ? String(value['#text'] ?? '') : String(value ?? '');
/** GetItem seller snapshot, never a Browse price, draft or acknowledgement-only publication. */
export function parseLiveContent(xml: string, expectedId: string): LiveListingContent & {listingStatus:string;availableQuantity:number} {
  if (xml.length > 1_000_000 || XMLValidator.validate(xml) !== true) throw new Error('eBay returned an invalid live snapshot.');
  const root = parser.parse(xml).GetItemResponse;
  if (!root || !['Success', 'Warning'].includes(scalar(root.Ack))) throw new Error('eBay did not confirm live listing details.');
  const item = root.Item;
  if (!item || scalar(item.ItemID).trim() !== expectedId) throw new Error('eBay returned a different listing identity.');
  const listingType = scalar(item.ListingType).trim();
  // Fixed-price listings expose the currently advertised seller price in
  // SellingStatus.CurrentPrice. StartPrice may retain the original value after
  // a seller changes the price, which would leave SWISH stale after a sync.
  // For auctions, CurrentPrice is a buyer bid, so retain StartPrice instead.
  const amount = ['FixedPriceItem', 'StoresFixedPrice'].includes(listingType)
    ? item.SellingStatus?.CurrentPrice ?? item.StartPrice ?? item.BuyItNowPrice
    : item.StartPrice ?? item.SellingStatus?.CurrentPrice;
  const sellerPrice = Number(scalar(amount));
  const currency = scalar(amount?.['@_currencyID']).trim();
  const description = scalar(item.Description);
  const title = scalar(item.Title);
  if (new TextEncoder().encode(description).byteLength > 100_000) throw new Error('eBay description exceeds safe inline storage size. Saved edits were preserved.');
  if (!amount || !Number.isFinite(sellerPrice) || sellerPrice < 0 || !currency || !title.trim() || item.Description === undefined) throw new Error('eBay live price or description evidence is incomplete.');
  const listingStatus=scalar(item.SellingStatus?.ListingStatus).trim();
  const quantityText=scalar(item.Quantity).trim(),soldText=scalar(item.SellingStatus?.QuantitySold).trim();
  const quantity=quantityText?Number(quantityText):NaN;
  const quantitySold=soldText?Number(soldText):0;
  const availableQuantity=quantity-quantitySold;
  // NaN <= 0 is false: reject missing/malformed quantity explicitly before a client can count Active as T7.
  if(listingStatus==='Active'&&(!Number.isSafeInteger(quantity)||!Number.isSafeInteger(quantitySold)||quantitySold<0||!Number.isSafeInteger(availableQuantity)||availableQuantity<0)) throw new Error('eBay active listing quantity could not be confirmed.');
  return { externalListingId: expectedId, title, description, sellerPrice, currency, listingType, listingStatus, availableQuantity, checkedAt: new Date().toISOString() };
}
