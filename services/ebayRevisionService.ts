import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { revisionFailure, type LiveListingContent } from '@/shared/ebayRevisionContract';
async function invokeContent(route: 'revise' | 'inspect_live', tenantId: string, listingId: string) {
  try {
    const { data, error } = await getSupabaseClient().functions.invoke('swish-ebay-list', { body: { route, tenantId, listingId, useSavedListing: true } });
    if (error) {
      let message = error.message;
      if (error instanceof FunctionsHttpError) {
        try { const text = await error.context.text(); const payload = JSON.parse(text); message = payload.error ?? message; return { data: payload, error: message }; } catch { /* No raw provider HTML or credentials. */ }
      }
      return { data: null, error: message };
    }
    return { data, error: route === 'revise' ? revisionFailure(data) : data?.success ? null : data?.error ?? 'Live eBay check failed.' };
  } catch { return { data: null, error: 'eBay request outcome is unconfirmed. Check live details before retrying.' }; }
}
/** All production push paths send identities only; the server reads saved listing copy. */
export async function reviseSavedListing(tenantId: string, listingId: string) { return invokeContent('revise', tenantId, listingId); }
/** Read-only exact linked GetItem; never changes listing, inventory or seller price. */
export async function inspectLiveListing(tenantId: string, listingId: string): Promise<{ live: LiveListingContent | null; error: string | null }> {
  const result = await invokeContent('inspect_live', tenantId, listingId);
  const live = result.data?.live;
  const valid = live && typeof live.externalListingId === 'string' && typeof live.title === 'string' && typeof live.description === 'string' && typeof live.sellerPrice === 'number' && Number.isFinite(live.sellerPrice) && typeof live.currency === 'string' && typeof live.checkedAt === 'string';
  return { live: valid ? live : null, error: result.error ?? (valid ? null : 'eBay returned incomplete live description or seller-price evidence. Saved edits are unchanged.') };
}
