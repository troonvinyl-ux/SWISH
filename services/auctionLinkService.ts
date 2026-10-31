// Validation only: opening belongs to the platform hook, never the data layer.
export function normaliseAuctionUrl(value: string | null | undefined): string {
  if (value == null || value.trim() === '') return '';
  const text = value.trim();
  if (text.length > 2048 || !/^https:\/\//i.test(text) || /[\s\\\u0000-\u001f\u007f]/.test(text) || /%(?![a-f0-9]{2})/i.test(text)) {
    throw new Error('Use a full https:// auction-page link.');
  }
  const match = text.match(/^https:\/\/([^/?#]+)([/?#].*)?$/i);
  if (!match || match[1].includes('@')) throw new Error('Use a public HTTPS auction-page link without sign-in details.');
  const authority = match[1].split(':');
  const host = authority[0].toLowerCase();
  const port = authority[1];
  const labels = host.split('.');
  if (authority.length > 2 || labels.length < 2 || !labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
    || !/^[a-z]{2,63}$/i.test(labels[labels.length - 1]) || host.endsWith('.local') || host.endsWith('.localhost')
    || (port !== undefined && (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535))) {
    throw new Error('Use a valid public HTTPS auction-page link.');
  }
  return `https://${host}${port ? ':' + port : ''}${match[2] ?? ''}`;
}
export function validAuctionUrl(value: string | null | undefined): boolean {
  try { return normaliseAuctionUrl(value).length > 0; } catch { return false; }
}
export function ebaySoldSearchUrl(query: string): string {
  return `https://www.ebay.co.uk/sch/i.html?_nkw=${encodeURIComponent(query.slice(0,100))}&LH_Sold=1&LH_Complete=1`;
}
