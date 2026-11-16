import { ebayAuthorizationTimeouts } from './ebayAuthorization.ts';
/** Bound DB/auth requests, without ever replaying an OAuth or credential write. */
export const ebayAuthorizationDatabaseFetch: typeof fetch = (input, init) => fetch(input, {
 ...init,
 signal: AbortSignal.any([AbortSignal.timeout(ebayAuthorizationTimeouts.database), ...(init?.signal ? [init.signal] : [])]),
});
