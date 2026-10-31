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

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encryptCredentials, decryptCredentials } from '../_shared/credentialCrypto.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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
        await supabase.from('marketplace_connectors')
          .update({ credential_ref: updatedRef, access_token_expires_at: newExpiry, updated_at: new Date().toISOString() })
          .eq('tenant_id', tenantId).eq('marketplace_id', 'ebay');
        creds = { ...creds, accessToken: data.access_token, expiresAt: newExpiry };
      }
    } catch (e: any) {
      console.log(`[SWISH] Token refresh failed for messages: ${e.message}`);
      // Continue with existing token — it may still be valid
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
  const endTime   = new Date().toISOString();

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<GetMyMessagesRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${accessToken}</eBayAuthToken></RequesterCredentials>
  <FolderID>0</FolderID>
  <StartCreationTime>${startTime}</StartCreationTime>
  <EndCreationTime>${endTime}</EndCreationTime>
  <Pagination><EntriesPerPage>50</EntriesPerPage><PageNumber>1</PageNumber></Pagination>
</GetMyMessagesRequest>`;

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
      body: xml,
      signal: AbortSignal.timeout(20000),
    });
    responseXml = await resp.text();
  } catch (e: any) {
    return jsonResponse({ error: 'Unable to complete the eBay messages request.' }, 503);
  }

  const ack = parseAck(responseXml);
  if (ack === 'Failure') {
    const errMsg = responseXml.match(/<LongMessage>([\s\S]*?)<\/LongMessage>/)?.[1] ?? 'eBay API error';
    return jsonResponse({ error: 'eBay could not complete the messages request. Please retry.' }, 502);
  }

  const msgMatches = Array.from(responseXml.matchAll(/<MessageSummary>([\s\S]*?)<\/MessageSummary>/g));
  let synced = 0;

  for (const match of msgMatches) {
    const msgXml = match[1];
    const msgId        = msgXml.match(/<MessageID>([^<]+)<\/MessageID>/)?.[1];
    const sender       = msgXml.match(/<Sender>([^<]+)<\/Sender>/)?.[1] ?? '';
    const subject      = msgXml.match(/<Subject>([^<]+)<\/Subject>/)?.[1] ?? '(no subject)';
    const isRead       = msgXml.match(/<Read>(.*?)<\/Read>/)?.[1] === 'true';
    const creationDate = msgXml.match(/<CreationDate>([^<]+)<\/CreationDate>/)?.[1] ?? new Date().toISOString();
    const itemId       = msgXml.match(/<ItemID>([^<]+)<\/ItemID>/)?.[1] ?? '';

    if (!msgId) continue;

    const { error } = await supabase
      .from('ebay_messages')
      .upsert({
        tenant_id:       tenantId,
        ebay_message_id: msgId,
        buyer_username:  sender,
        subject,
        body: '(tap to view full message)',
        is_read:         isRead,
        is_replied:      false,
        direction:       'inbound',
        ebay_item_id:    itemId || null,
        received_at:     creationDate,
      }, { onConflict: 'ebay_message_id', ignoreDuplicates: false });

    if (!error) synced++;
  }

  console.log(`[SWISH] Messages synced: ${synced} for tenant ${tenantId}`);
  return jsonResponse({ success: true, synced });
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
  const { messageId, replyText, buyerUsername, ebayItemId, conversationId } = params;

  if (!replyText?.trim()) return jsonResponse({ error: 'Reply text is required.' }, 400);
  if (!buyerUsername) return jsonResponse({ error: 'Buyer username is required.' }, 400);

  const { data: msgRow } = await supabase
    .from('ebay_messages')
    .select('id, tenant_id')
    .eq('id', messageId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (!msgRow) {
    return jsonResponse({ error: 'Message not found or does not belong to your account.' }, 404);
  }

  const credsResult = await getEbayAccessToken(supabase, tenantId);
  if ('error' in credsResult) return jsonResponse({ error: credsResult.error }, 400);
  const { accessToken, clientId } = credsResult;

  let ebaySuccess = false;

  if (ebayItemId) {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<AddMemberMessageAAQToPartnerRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${accessToken}</eBayAuthToken></RequesterCredentials>
  <ItemID>${xmlEscape(ebayItemId)}</ItemID>
  <MemberMessage>
    <Body>${xmlEscape(replyText)}</Body>
    <RecipientID>${xmlEscape(buyerUsername)}</RecipientID>
  </MemberMessage>
</AddMemberMessageAAQToPartnerRequest>`;

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
      const responseXml = await resp.text();
      const ack = parseAck(responseXml);
      ebaySuccess = ack === 'Success' || ack === 'Warning';
      if (!ebaySuccess) {
        const errMsg = responseXml.match(/<LongMessage>([\s\S]*?)<\/LongMessage>/)?.[1] ?? 'eBay API error';
        console.log(`[SWISH] eBay send reply failed for message ${messageId}: ${errMsg}`);
      }
    } catch (e: any) {
      console.log(`[SWISH] eBay send reply network error: ${e.message}`);
    }
  }

  await supabase.from('ebay_messages')
    .update({ is_replied: true, replied_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', messageId).eq('tenant_id', tenantId);

  await supabase.from('ebay_messages').insert({
    tenant_id: tenantId, conversation_id: conversationId ?? null,
    buyer_username: buyerUsername, subject: '(outbound reply)', body: replyText,
    direction: 'outbound', is_read: true, is_replied: true, ebay_item_id: ebayItemId ?? null,
  });

  const message = ebaySuccess
    ? 'Reply sent via eBay successfully.'
    : (ebayItemId
      ? 'Reply saved locally. Note: eBay send requires an active item ID and connected account.'
      : 'Reply saved locally. No eBay item ID was available to send via eBay messaging.');

  return jsonResponse({ success: true, ebaySuccess, message });
}

// ── Entry point ───────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  let body: any;
  try { body = await req.json(); } catch {
    return jsonResponse({ error: 'Invalid JSON request body' }, 400);
  }

  const { route, tenantId } = body;
  if (!tenantId) return jsonResponse({ error: 'tenantId is required' }, 400);
  if (!route)    return jsonResponse({ error: 'route is required (sync_messages | send_reply)' }, 400);

  const supabase = adminClient();
  const authHeader = req.headers.get('Authorization');

  const sec = await verifyTenantAccess(supabase, authHeader, tenantId);
  if (!sec.ok) {
    return jsonResponse({ error: sec.error }, authHeader ? 403 : 401);
  }

  try {
    if (route === 'sync_messages') {
      return await handleSyncMessages(supabase, tenantId, Number(body.daysBack ?? 30));
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
    console.error(`[SWISH] swish-ebay-messages unhandled error (route=${route}):`, e.message);
    return jsonResponse({ error: 'Unable to complete the eBay messages request. Please retry or contact support.' }, 500);
  }
});
