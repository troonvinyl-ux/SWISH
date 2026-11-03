// SWISH eBay Messages Edge Function
//
// Handles all eBay message operations server-side.
// The client NEVER receives credential_ref, accessToken, clientSecret, or refreshToken.
//
// Routes (via POST body.route):
//   sync_messages   — fetch recent messages from eBay Trading API GetMyMessages
//   send_reply      — send reply via AddMemberMessageAAQToPartner
//
// Security: JWT + tenant membership verified before any eBay operation.

import { withEdgeFunctionLogging } from '../_shared/edgeFunctionLogging.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encryptCredentials, decryptCredentials } from '../_shared/credentialCrypto.ts';

import { corsHeaders } from '../_shared/cors.ts';
import { buildGetEbayMessageBodyRequest, buildGetEbayMessagesRequest, extractEbayMessageBlocks, extractEbayMessageBody, extractEbayXmlTag, getEbayMessagePagePlan } from '../_shared/ebayMessagePagination.ts';

const EBAY_TRADING_API_URL = 'https://api.ebay.com/ws/api.dll';
const EBAY_TOKEN_URL       = 'https://api.ebay.com/identity/v1/oauth2/token';

function adminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ── JWT + tenant membership verification ─────────────────────────────────────

async function verifyTenantAccess(
  supabase: ReturnType<typeof adminClient>,
  authHeader: string | null,
  tenantId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!authHeader) {
    return { ok: false, error: 'Authentication required. Please sign in to SWISH.' };
  }
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token || token === Deno.env.get('SUPABASE_ANON_KEY')) {
    return { ok: false, error: 'Authentication required. Please sign in to SWISH.' };
  }

  try {
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return { ok: false, error: 'Invalid or expired authentication token. Please sign in again.' };
    }

    const { data: membership } = await supabase
      .from('tenant_memberships')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!membership) {
      console.warn(`[SWISH Security] swish-ebay-messages: User ${user.id} attempted tenant ${tenantId} — not a member`);
      return { ok: false, error: 'Access denied: you are not a member of this organisation.' };
    }
    return { ok: true };
  } catch (e: any) {
    console.error(`[SWISH Security] JWT verification error: ${e.message}`);
    return { ok: false, error: 'Authentication verification failed. Please sign in again.' };
  }
}

// ── Load eBay credentials server-side with optional token refresh ────────────

async function getEbayAccessToken(
  supabase: ReturnType<typeof adminClient>,
  tenantId: string,
): Promise<{ accessToken: string; clientId: string } | { error: string }> {
  const { data: conn } = await supabase
    .from('marketplace_connectors')
    .select('credential_ref, status, access_token_expires_at')
    .eq('tenant_id', tenantId)
    .eq('marketplace_id', 'ebay')
    .maybeSingle();

  if (!conn?.credential_ref || conn.status !== 'connected') {
    return { error: 'eBay is not connected. Connect eBay in Settings → Marketplaces.' };
  }

  let creds: any;
  try { creds = await decryptCredentials(conn.credential_ref); } catch (e: any) {
    return { error: 'Unable to read eBay connection securely. Please reconnect eBay in Marketplaces.' };
  }
  if (!creds.accessToken) {
    return { error: 'No eBay access token found. Please re-authorise eBay in Marketplaces.' };
  }

  // Auto-refresh if token is expiring within 10 minutes
  const shouldRefresh = creds.expiresAt
    ? Date.now() + 10 * 60_000 >= new Date(creds.expiresAt).getTime()
    : false;

  if (shouldRefresh && creds.refreshToken && creds.clientId && creds.clientSecret) {
    try {
      const basicAuth = btoa(`${creds.clientId}:${creds.clientSecret}`);
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: creds.refreshToken,
      });
      const resp = await fetch(EBAY_TOKEN_URL, {
        method: 'POST',
        headers: { Authorization: `Basic ${basicAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      const data = await resp.json();
      if (data.access_token) {
        const newExpiry = new Date(Date.now() + (data.expires_in ?? 7200) * 1000).toISOString();
        const updatedRef = await encryptCredentials({ ...creds, accessToken: data.access_token, expiresAt: newExpiry });
        const { data: persistedConnector, error: persistError } = await supabase.from('marketplace_connectors')
          .update({ credential_ref: updatedRef, access_token_expires_at: newExpiry, updated_at: new Date().toISOString() })
          .eq('tenant_id', tenantId).eq('marketplace_id', 'ebay').eq('credential_ref', conn.credential_ref).select('id').maybeSingle();
        if (persistError || !persistedConnector) {
          throw new Error('Refreshed eBay credentials could not be persisted securely.');
        }
        creds = { ...creds, accessToken: data.access_token, expiresAt: newExpiry };
      }
    } catch (e: any) {
      // A failed credential write must fail closed; never use a token that was not persisted.
      if (e instanceof Error && e.message === 'Refreshed eBay credentials could not be persisted securely.') throw e;
      // Do not log raw exception text, which may contain provider response details.
      console.warn('[SWISH] eBay token refresh failed for messages; retry or reconnect if expired.');
      // For transient refresh-service failures, the existing token may still be valid.
    }
  }

  return { accessToken: creds.accessToken, clientId: creds.clientId ?? '' };
}

// ── XML helpers ───────────────────────────────────────────────────────────────

function xmlEscape(s: string): string {
  return (s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function parseAck(xml: string): string {
  return xml.match(/<Ack>(.*?)<\/Ack>/)?.[1] ?? 'Failure';
}

// ── Route: sync_messages ─────────────────────────────────────────────────────

async function handleSyncMessages(
  supabase: ReturnType<typeof adminClient>,
  tenantId: string,
  daysBack = 30,
): Promise<Response> {
  const credsResult = await getEbayAccessToken(supabase, tenantId);
  if ('error' in credsResult) {
    return jsonResponse({ error: credsResult.error }, 400);
  }
  const { accessToken, clientId } = credsResult;

  const startTime = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
  const endTime = new Date().toISOString();
  let pagePlan = { reportedPages: 1, pagesToFetch: 1, truncated: false };
  let pagesFetched = 0;
  let pageError: string | null = null;
  const msgBlocks: string[] = [];

  // GetMyMessages is paginated. Fetch pages in order and cap the request count
  // so a busy mailbox cannot exhaust the Edge Function execution window.
  for (let page = 1; page <= pagePlan.pagesToFetch; page++) {
    let responseXml: string;
    try {
      const resp = await fetch(EBAY_TRADING_API_URL, {
        method: 'POST',
        headers: {
          'X-EBAY-API-SITEID': '3',
          'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
          'X-EBAY-API-CALL-NAME': 'GetMyMessages',
          'X-EBAY-API-APP-NAME': clientId,
          'Content-Type': 'text/xml',
        },
        body: buildGetEbayMessagesRequest(accessToken, startTime, endTime, page),
        signal: AbortSignal.timeout(10000),
      });
      responseXml = await resp.text();
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    } catch {
      if (page === 1) return jsonResponse({ error: 'Unable to complete the eBay messages request.' }, 503);
      pageError = 'eBay stopped responding before all message pages were retrieved.';
      break;
    }

    const ack = parseAck(responseXml);
    if (!['Success', 'Warning'].includes(ack)) {
      if (page === 1) return jsonResponse({ error: 'eBay could not complete the messages request. Please retry.' }, 502);
      pageError = 'eBay rejected a later message page; the pages already received were retained.';
      break;
    }

    if (page === 1) pagePlan = getEbayMessagePagePlan(responseXml);
    msgBlocks.push(...extractEbayMessageBlocks(responseXml));
    pagesFetched = page;
  }

  let synced = 0;
  let failed = 0;

  for (const msgXml of msgBlocks) {
    const msgId        = extractEbayXmlTag(msgXml, 'MessageID');
    const sender       = extractEbayXmlTag(msgXml, 'Sender');
    const subject      = extractEbayXmlTag(msgXml, 'Subject') || '(no subject)';
    const isRead       = extractEbayXmlTag(msgXml, 'Read').toLowerCase() === 'true';
    const creationDate = extractEbayXmlTag(msgXml, 'ReceiveDate') || extractEbayXmlTag(msgXml, 'CreationDate') || new Date().toISOString();
    const itemId       = extractEbayXmlTag(msgXml, 'ItemID');

    if (!msgId) continue;

    // Existing schema has item_id, not ebay_item_id, and no unique message-ID constraint.
    // The server-only command serializes tenant/provider ID and preserves operator flags.
    const { data: persisted, error } = await supabase.rpc('swish_ingest_ebay_message', {
      p_tenant_id: tenantId, p_message_id: msgId,
      p_observation: { sender, subject, item_id: itemId || null, is_read: isRead, received_at: creationDate },
    });
    if (!error && persisted) synced++; else failed++;
  }

  console.log(`[SWISH] Messages synced: ${synced} for tenant ${tenantId}; pages ${pagesFetched}/${pagePlan.reportedPages}`);
  const incomplete = Boolean(pageError) || pagePlan.truncated;
  const errors = [
    ...(failed ? ['Some eBay messages could not be saved. Existing messages were retained; retry sync.'] : []),
    ...(pageError ? [pageError] : []),
    ...(pagePlan.truncated ? [`Mailbox has ${pagePlan.reportedPages} pages; this sync is capped at ${pagePlan.pagesToFetch}. The remaining messages were not fetched; contact support to retrieve the remaining date range.`] : []),
  ];
  return jsonResponse({
    success: failed === 0 && !incomplete,
    synced,
    failed,
    pagesFetched,
    pagesTotal: pagePlan.reportedPages,
    truncated: pagePlan.truncated,
    bodyAvailable: false,
    ...(errors.length ? { error: errors.join(' ') } : {}),
  });
}

// ── Route: send_reply ─────────────────────────────────────────────────────────

async function handleSendReply(
  supabase: ReturnType<typeof adminClient>,
  tenantId: string,
  params: {
    messageId: string;
    replyText: string;
    buyerUsername: string;
    ebayItemId?: string;
    conversationId?: string;
  },
): Promise<Response> {
  const { messageId, replyText } = params;
  if (typeof messageId !== 'string' || !messageId.trim()) return jsonResponse({ error: 'Message ID is required.' }, 400);
  if (typeof replyText !== 'string' || !replyText.trim() || replyText.length > 4000) return jsonResponse({ error: 'Reply text must contain 1–4000 characters.' }, 400);

  const { data: msgRow } = await supabase
    .from('ebay_messages')
    .select('id, tenant_id, buyer_username, item_id, conversation_id')
    .eq('id', messageId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (!msgRow) {
    return jsonResponse({ error: 'Message not found or does not belong to your account.' }, 404);
  }

  // Recipient/item identity comes from the persisted tenant-owned message, not client parameters.
  const buyerUsername = msgRow.buyer_username;
  const ebayItemId = msgRow.item_id;
  const conversationId = msgRow.conversation_id;
  if (!buyerUsername) return jsonResponse({ error: 'Buyer username is required.' }, 400);
  if (!ebayItemId) {
    return jsonResponse({ success: false, ebaySuccess: false, error: 'An active eBay item ID is required to send this reply.' }, 422);
  }

  const credsResult = await getEbayAccessToken(supabase, tenantId);
  if ('error' in credsResult) return jsonResponse({ error: credsResult.error }, 400);
  const { accessToken, clientId } = credsResult;

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<AddMemberMessageAAQToPartnerRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${accessToken}</eBayAuthToken></RequesterCredentials>
  <ItemID>${xmlEscape(ebayItemId)}</ItemID>
  <MemberMessage>
    <Body>${xmlEscape(replyText)}</Body>
    <RecipientID>${xmlEscape(buyerUsername)}</RecipientID>
  </MemberMessage>
</AddMemberMessageAAQToPartnerRequest>`;

  let ebaySuccess = false;
  let responseStatus = 0;
  let ack = '';
  try {
    const resp = await fetch(EBAY_TRADING_API_URL, {
      method: 'POST',
      headers: {
        'X-EBAY-API-SITEID': '3',
        'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
        'X-EBAY-API-CALL-NAME': 'AddMemberMessageAAQToPartner',
        'X-EBAY-API-APP-NAME': clientId,
        'Content-Type': 'text/xml',
      },
      body: xml,
      signal: AbortSignal.timeout(20000),
    });
    responseStatus = resp.status;
    const responseXml = await resp.text();
    ack = resp.ok ? parseAck(responseXml) : '';
    ebaySuccess = resp.ok && (ack === 'Success' || ack === 'Warning');
  } catch {
    console.warn('[SWISH] eBay reply request failed before acceptance was confirmed.', { messageId });
  }

  if (!ebaySuccess) {
    console.warn('[SWISH] eBay did not confirm message reply.', { messageId, responseStatus, ack });
    return jsonResponse({ success: false, ebaySuccess: false, error: 'eBay did not confirm the reply. Nothing was marked as sent; check the eBay conversation before retrying because a lost response may hide an accepted send.' }, 502);
  }

  const { error: markError } = await supabase.from('ebay_messages')
    .update({ is_replied: true, replied_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', messageId).eq('tenant_id', tenantId);
  if (markError) {
    return jsonResponse({ success: true, ebaySuccess: true, localSyncPending: true, message: 'eBay accepted the reply, but SWISH could not update its local message status. Refresh messages.' });
  }

  const { error: transcriptError } = await supabase.from('ebay_messages').insert({
    tenant_id: tenantId, conversation_id: conversationId ?? null,
    buyer_username: buyerUsername, subject: '(outbound reply)', body: replyText,
    direction: 'outbound', is_read: true, is_replied: true, item_id: ebayItemId,
  });
  if (transcriptError) {
    return jsonResponse({ success: true, ebaySuccess: true, localSyncPending: true, message: 'eBay accepted the reply, but SWISH could not save the local conversation copy. Refresh messages.' });
  }

  return jsonResponse({ success: true, ebaySuccess: true, message: 'Reply sent via eBay successfully.' });
}

// ── Route: get_message_body ───────────────────────────────────────────────────

async function handleGetMessageBody(
  supabase: ReturnType<typeof adminClient>,
  tenantId: string,
  localMessageId: string,
): Promise<Response> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(localMessageId)) {
    return jsonResponse({ error: 'A valid message ID is required.' }, 400);
  }

  const { data: message, error: loadError } = await supabase
    .from('ebay_messages')
    .select('id, ebay_message_id, body')
    .eq('id', localMessageId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (loadError) return jsonResponse({ error: 'Unable to load this message.' }, 500);
  if (!message) return jsonResponse({ error: 'Message not found in this business account.' }, 404);
  if (typeof message.body === 'string' && message.body.trim()) {
    return jsonResponse({ success: true, body: message.body, cached: true });
  }
  if (typeof message.ebay_message_id !== 'string' || !message.ebay_message_id.trim() || message.ebay_message_id.length > 200) {
    return jsonResponse({ error: 'This message has no valid eBay message reference.' }, 422);
  }

  const credsResult = await getEbayAccessToken(supabase, tenantId);
  if ('error' in credsResult) return jsonResponse({ error: credsResult.error }, 400);
  const { accessToken, clientId } = credsResult;

  let responseXml: string;
  try {
    const response = await fetch(EBAY_TRADING_API_URL, {
      method: 'POST',
      headers: {
        'X-EBAY-API-SITEID': '3',
        'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
        'X-EBAY-API-CALL-NAME': 'GetMyMessages',
        'X-EBAY-API-APP-NAME': clientId,
        'Content-Type': 'text/xml',
      },
      body: buildGetEbayMessageBodyRequest(accessToken, message.ebay_message_id),
      signal: AbortSignal.timeout(10000),
    });
    responseXml = await response.text();
    if (!response.ok) return jsonResponse({ error: 'eBay could not return the message body. Please retry.' }, 502);
  } catch {
    return jsonResponse({ error: 'The eBay message body request timed out or could not connect.' }, 503);
  }

  const ack = parseAck(responseXml);
  if (!['Success', 'Warning'].includes(ack)) {
    return jsonResponse({ error: 'eBay did not return the requested message body.' }, 502);
  }

  const body = extractEbayMessageBody(responseXml);
  if (!body) return jsonResponse({ error: 'eBay returned the message header but no message body.' }, 404);

  const { data: updated, error: saveError } = await supabase
    .from('ebay_messages')
    .update({ body, updated_at: new Date().toISOString() })
    .eq('id', localMessageId)
    .eq('tenant_id', tenantId)
    .select('id')
    .maybeSingle();

  if (saveError || !updated) {
    return jsonResponse({
      success: true,
      body,
      localSyncPending: true,
      message: 'eBay returned the message body, but SWISH could not cache it. The body is available for this view; retry later to retain it.',
    });
  }

  return jsonResponse({ success: true, body, cached: true });
}

// ── Entry point ───────────────────────────────────────────────────────────────

Deno.serve(withEdgeFunctionLogging('swish-ebay-messages', async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  let body: any;
  try { body = await req.json(); } catch {
    return jsonResponse({ error: 'Invalid JSON request body' }, 400);
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonResponse({ error: 'Request body must be an object.' }, 400);
  const { route, tenantId } = body;
  if (typeof tenantId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) return jsonResponse({ error: 'A valid tenantId is required.' }, 400);
  const daysBack = Number(body.daysBack ?? 30);
  if (!Number.isInteger(daysBack) || daysBack < 1 || daysBack > 365) return jsonResponse({ error: 'daysBack must be between 1 and 365.' }, 400);
  if (!tenantId) return jsonResponse({ error: 'tenantId is required' }, 400);
  if (!route)    return jsonResponse({ error: 'route is required (sync_messages | get_message_body | send_reply)' }, 400);

  const supabase = adminClient();
  const authHeader = req.headers.get('Authorization');

  const sec = await verifyTenantAccess(supabase, authHeader, tenantId);
  if (!sec.ok) {
    return jsonResponse({ error: sec.error }, authHeader ? 403 : 401);
  }

  try {
    if (route === 'get_message_body') {
      return await handleGetMessageBody(supabase, tenantId, String(body.messageId ?? ''));
    }
    if (route === 'sync_messages') {
      return await handleSyncMessages(supabase, tenantId, daysBack);
    }
    if (route === 'send_reply') {
      return await handleSendReply(supabase, tenantId, {
        messageId:     body.messageId,
        replyText:     body.replyText,
        buyerUsername: body.buyerUsername,
        ebayItemId:    body.ebayItemId,
        conversationId: body.conversationId,
      });
    }
    return jsonResponse({ error: `Unknown route: ${route}` }, 400);
  } catch (e: any) {
    console.error('[SWISH] swish-ebay-messages request failed.', { route });
    return jsonResponse({ error: 'Unable to complete the eBay messages request. Please retry or contact support.' }, 500);
  }
})))
