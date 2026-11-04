import { FunctionsHttpError } from '@supabase/supabase-js';
import { getSupabaseClient } from '@/template';
export interface EbayMessage {
  id: string; ebayMessageId?: string; conversationId?: string; ebayItemId?: string; ebayOrderId?: string;
  buyerUsername: string; subject: string; body: string; isRead: boolean; isReplied: boolean; isArchived: boolean;
  direction: 'inbound' | 'outbound'; aiDraft?: string; listingId?: string; receivedAt: string; repliedAt?: string;
}
export interface EbayReplyInput { messageId: string; replyText: string; buyerUsername: string; ebayItemId?: string; conversationId?: string }
export interface EbayReplyResult { ebaySuccess: boolean; localSyncPending: boolean; message: string; error?: string }
async function invoke(route: string, tenantId: string, input: Record<string, unknown> = {}) {
  if (!tenantId.trim()) return { data: null, error: 'Business account is required.' };
  try {
    const { data, error } = await getSupabaseClient().functions.invoke('swish-ebay-messages', { body: { ...input, route, tenantId } });
    if (error) {
      let message = error.message;
      if (error instanceof FunctionsHttpError) {
        try {
          const text = await error.context.text();
          const parsed = JSON.parse(text);
          message = parsed?.error ?? parsed?.message ?? 'eBay messages request failed.';
        } catch { message = 'eBay messages request failed. Check the connection and retry.'; }
      }
      return { data: null, error: message };
    }
    return { data, error: null };
  } catch { return { data: null, error: 'Unable to reach eBay messaging. Check the connection and retry.' }; }
}
export async function listEbayMessages(tenantId: string): Promise<{ messages: EbayMessage[]; error: string | null }> {
  if (!tenantId.trim()) return { messages: [], error: 'Business account is required.' };
  const { data, error } = await getSupabaseClient().from('ebay_messages').select('*').eq('tenant_id', tenantId).order('received_at', { ascending: false }).limit(200);
  if (error) return { messages: [], error: error.message };
  return { messages: (data ?? []).map(row => ({
    id: row.id, ebayMessageId: row.ebay_message_id ?? undefined, conversationId: row.conversation_id ?? undefined,
    ebayItemId: row.item_id ?? undefined, ebayOrderId: row.order_id ?? undefined, buyerUsername: row.buyer_username ?? '',
    subject: row.subject ?? '', body: row.body || 'Message body was not returned by eBay. Open the conversation on eBay to review it.',
    isRead: row.is_read ?? false, isReplied: row.is_replied ?? false, isArchived: row.is_archived ?? false,
    direction: row.direction === 'outbound' ? 'outbound' as const : 'inbound' as const,
    aiDraft: row.ai_draft ?? undefined, listingId: row.listing_id ?? undefined, receivedAt: row.received_at ?? row.created_at, repliedAt: row.replied_at ?? undefined,
  })), error: null };
}
export async function syncEbayMessages(tenantId: string): Promise<{ synced: number; error: string | null }> {
  const result = await invoke('sync_messages', tenantId, { daysBack: 30 });
  if (result.error) return { synced: 0, error: result.error };
  if (result.data?.success !== true || !Number.isInteger(result.data?.synced)) return { synced: Number(result.data?.synced ?? 0), error: result.data?.error ?? 'Message sync was incomplete or not confirmed.' };
  return { synced: result.data.synced, error: null };
}
export async function sendEbayReply(tenantId: string, params: EbayReplyInput): Promise<EbayReplyResult> {
  const { data, error } = await invoke('send_reply', tenantId, { ...params });
  if (error || data?.success !== true || data?.ebaySuccess !== true) return { ebaySuccess: false, localSyncPending: false, message: '', error: error ?? data?.error ?? 'eBay did not confirm this reply. Check the conversation before retrying.' };
  return { ebaySuccess: true, localSyncPending: data.localSyncPending === true, message: data.message ?? 'eBay confirmed the reply.' };
}
export async function updateEbayMessageFlag(tenantId: string, id: string, flag: 'is_read' | 'is_archived'): Promise<{ error: string | null }> {
  if (!tenantId.trim() || !id.trim()) return { error: 'Message and business account are required.' };
  const { data, error } = await getSupabaseClient().from('ebay_messages').update({ [flag]: true }).eq('id', id).eq('tenant_id', tenantId).select('id').maybeSingle();
  return { error: error?.message ?? (data ? null : 'Message change was not confirmed.') };
}
