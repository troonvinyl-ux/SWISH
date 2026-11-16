/** Safe error contract shared by the eBay OAuth endpoint and its clients. */
export const ebayAuthorizationTimeouts = { database: 8000, client: 25000 } as const;
export interface EbayAuthorizationFailure { error: string; code: string; retryable: boolean; outcomeUnconfirmed: boolean }
export function ebayAuthorizationFailure(cause: unknown, action = ''): EbayAuthorizationFailure {
 const value = cause as { message?: unknown; error?: unknown; code?: unknown; status?: unknown; name?: unknown } | null;
 const text = String(value?.error ?? value?.message ?? '');
 const code = String(value?.code ?? '');
 const timeout = [408,499,502,503,504].includes(Number(value?.status)) || ['57014','EBAY_AUTHORIZATION_TIMEOUT'].includes(code) || /timeout|timed out|gateway|abort/i.test(`${value?.name ?? ''} ${text}`);
 const busy = ['55P03','EBAY_AUTHORIZATION_BUSY'].includes(code) || /connection is busy|selling operation is pending/i.test(text);
 if (timeout || busy) return {
  error: busy ? 'An eBay account operation is still running. Check authorization status before trying again.' : action === 'confirm_account' ? 'Account confirmation timed out. Check authorization status before confirming again; the result may already be saved.' : 'The secure eBay connection service timed out. Your saved account is unchanged by this check. Try again shortly.',
  code: busy ? 'EBAY_AUTHORIZATION_BUSY' : 'EBAY_AUTHORIZATION_TIMEOUT', retryable: true, outcomeUnconfirmed: action === 'confirm_account',
 };
 const controlled = /^(Sign in to SWISH|Valid business account|Verified SWISH session|Business membership required|The initiating SWISH session|Initiating authorization session required|Explicit account confirmation required|Fresh verified account confirmation required|Recent SWISH reauthentication required|Different eBay account detected|This eBay account is already linked|Re-enter your SWISH password|SWISH reauthentication failed|Connect your first eBay account|Connection changed\.|No idle member connection|eBay integration credentials are not configured|Fresh authorization session could not be created|Cancellation could not be confirmed|Owner\/admin permission required|Unknown action)/.test(text);
 return { error: controlled && text.length <= 500 && !/[<>]/.test(text) ? text : 'Secure eBay authorization could not be completed. Check its saved status before retrying.', code: 'EBAY_AUTHORIZATION_FAILED', retryable: false, outcomeUnconfirmed: false };
}
