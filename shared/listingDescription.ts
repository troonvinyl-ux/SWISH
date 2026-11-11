/** Static eBay description layout. Shared by generation and explicit formatting repair. */
export interface DescriptionLayoutInput { description: string; item_specifics?: Record<string, string> }
export const LISTING_DESCRIPTION_NOTE = 'Please examine all photographs carefully as they form part of the description. Any condition details or limitations known to the seller are described above. If you need further information, please ask before purchasing.';
const nicheLabels: Record<string, string> = {
  stamps: 'STAMP FLIP', coins: 'COIN FLIP', antiques: 'ANTIQUE FLIP', fossils: 'FOSSIL FLIP',
  motocross: 'MX FLIP', bicycles: 'BIKE FLIP', clothing: 'THREADS FLIP', trading_cards: 'CARD FLIP',
  beauty: 'BEAUTY FLIP', tech: 'TECH FLIP', surplus_flip: 'SURPLUS FLIP',
};
export function escapeListingHtml(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
export function buildEbayDescriptionHtml(listing: DescriptionLayoutInput, nicheId?: string, repair?: { details?: Array<{ name: string; value: string }>; note?: string; credit?: string }): string {
  const description = escapeListingHtml(listing.description).replace(/\r\n|\r|\n/g, '<br />');
  const label = nicheLabels[nicheId ?? ''] ?? 'SWISH LISTING';
  const divider = repair?.credit?.indexOf('|') ?? -1;
  const credit = repair?.credit
    ? divider < 0 ? escapeListingHtml(repair.credit) : '<strong>' + escapeListingHtml(repair.credit.slice(0, divider).trim()) + '</strong><span style="color:#ffffff;">&nbsp; | &nbsp;' + escapeListingHtml(repair.credit.slice(divider + 1).trim()) + '</span>'
    : '<strong>' + label + '</strong><span style="color:#ffffff;">&nbsp; | &nbsp;POWERED BY SWISHFLIP</span>';
  const providerCredit = '<div style="margin-top:18px;padding:6px 10px;background:#202329;color:#f3c928;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:10px;line-height:1.3;letter-spacing:0.5px;">' + credit + '</div>';
  const specifics = repair?.details ?? Object.entries(listing.item_specifics ?? {})
    .filter(([name, value]) => String(name).trim() && String(value).trim()).slice(0, 20).map(([name, value]) => ({ name, value }));
  const rows = specifics.map(({ name, value }) => name
    ? '<tr><td style="padding:8px;border:1px solid #dddddd;font-weight:bold;width:38%;">' + escapeListingHtml(name) + '</td><td style="padding:8px;border:1px solid #dddddd;">' + escapeListingHtml(value) + '</td></tr>'
    : '<tr><td colspan="2" style="padding:8px;border:1px solid #dddddd;">' + escapeListingHtml(value) + '</td></tr>').join('');
  return [
    '<div style="font-family:Arial,Helvetica,sans-serif;color:#222222;font-size:14px;line-height:1.55;max-width:100%;">',
    '<h2 style="font-size:18px;margin:0 0 12px;">Item description</h2>',
    '<div style="padding:12px;border:1px solid #dddddd;">' + description + '</div>',
    rows ? '<h3 style="font-size:15px;margin:18px 0 8px;">Item details</h3><table style="border-collapse:collapse;width:100%;"><tbody>' + rows + '</tbody></table>' : '',
    '<h3 style="font-size:15px;margin:18px 0 8px;">Please note</h3>',
    '<p style="margin:0;">' + escapeListingHtml(repair?.note ?? LISTING_DESCRIPTION_NOTE) + '</p>', providerCredit, '</div>',
  ].join('');
}
