export const ebayMismatchMessage = 'Different eBay account detected. For your security, please sign in with your linked eBay account or choose to change your linked account.';
export interface EbayIdentity { userId: string; username: string }
export function parseEbayIdentity(value: unknown): EbayIdentity {
 const row = value as Record<string, unknown> | null;
 if (!row || typeof row.userId !== 'string' || !row.userId.trim() || row.userId.length > 256 || typeof row.username !== 'string' || !row.username.trim() || row.username.length > 256) throw new Error('eBay account identity could not be verified.');
 return { userId: row.userId.trim(), username: row.username.trim() };
}
export function identityMatches(saved: string | null, next: string, purpose: string) { return !saved || saved === next || purpose === 'switch'; }
/** No caller-provided account name may silently replace the identity proved
 * by the actual encrypted OAuth token and eBay's identity endpoint. */
export function assertVerifiedLegacySeller(identity: EbayIdentity, savedSeller: unknown, savedUserId: unknown): void {
 const existingSeller=typeof savedSeller==='string'?savedSeller.trim():'';
 const existingUserId=typeof savedUserId==='string'?savedUserId.trim():'';
 if((existingUserId&&existingUserId!==identity.userId) ||
    (existingSeller&&existingSeller!==identity.username&&existingSeller!==identity.userId))throw new Error(ebayMismatchMessage);
}

export function requiresSellerBinding(operation: string, route: unknown): boolean {
 if (operation === 'swish-ebay-browse' && route === 'barcode_lookup') return false;
 if (operation === 'swish-ebay-category') return false;
 if (operation === 'swish-ebay-list' && ['get_api_usage','get_category_children','get_category_suggestions','get_category_aspects','get_condition_policies'].includes(String(route))) return false;
 return ['swish-ebay-list','swish-ebay-sync','swish-ebay-orders','swish-ebay-finances','swish-ebay-messages','swish-ebay-post-order','swish-ebay-listing-status','swish-ebay-browse','swish-ebay-draft-sync-test','swish-image-download','swish-market-value'].includes(operation);
}
export function assertCredentialScope(creds: Record<string,unknown>, binding: {id:string;user_id:string;tenant_id:string;ebay_account_id:string}) {
 if (creds.bindingId !== binding.id || creds.userId !== binding.user_id || creds.tenantId !== binding.tenant_id || creds.ebayUserId !== binding.ebay_account_id) throw new Error('Verified member eBay binding required. Reconnect eBay in Marketplaces.');
}
