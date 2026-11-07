import type { EbayStatusObservation } from './listingStatus.ts';
export interface SellerEndTransport {
 read: () => Promise<EbayStatusObservation>;
 end: () => Promise<void>;
}
/** Read before writing: repeat taps after a timeout never blindly resend an End request. */
export async function confirmSellerListingEnd(externalId: string, transport: SellerEndTransport): Promise<EbayStatusObservation> {
 const validate = (value: EbayStatusObservation) => {
  if (value.externalId !== externalId) throw new Error('eBay returned a different listing identity');
  if (!Number.isSafeInteger(value.quantity) || value.quantity < 1 || !Number.isSafeInteger(value.quantitySold) || value.quantitySold < 0 || value.quantitySold > value.quantity) throw new Error('eBay quantity evidence is incomplete');
  if (value.status === 'sold') throw new Error('This listing has sold. Keep the item and its sale history.');
  if (!['active','ended'].includes(value.status)) throw new Error('eBay listing status is unconfirmed');
  return value;
 };
 const initial = validate(await transport.read());
 if (initial.status === 'ended') return initial;
 await transport.end();
 const checked = validate(await transport.read());
 if (checked.status !== 'ended') throw new Error('eBay has not confirmed the listing ended. Inventory was retained.');
 return checked;
}
