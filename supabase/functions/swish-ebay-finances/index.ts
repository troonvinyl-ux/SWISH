// SWISH — eBay Finances API Sync Edge Function
// Syncs real financial transaction data from eBay Managed Payments API.
// Routes: sync_transactions | get_payouts | get_summary
// POST body: { tenantId, route?, daysBack? }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encryptCredentials, decryptCredentials } from '../_shared/credentialCrypto.ts';
import { ebayFinancesSignatureHeaders } from '../_shared/ebayDigitalSignature.ts';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const EBAY_FINANCES_API = 'https://apiz.ebay.com/sell/finances/v1';
const EBAY_TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';

function adminClient() { return createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''); }
function jr(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }

async function getToken(supabase: ReturnType<typeof adminClient>, tenantId: string): Promise<{ accessToken: string } | { error: string }> {
  const { data: conn } = await supabase.from('marketplace_connectors').select('credential_ref, status').eq('tenant_id', tenantId).eq('marketplace_id', 'ebay').maybeSingle();
  if (!conn?.credential_ref || conn.status !== 'connected') return { error: 'eBay not connected' };
  let creds: any;
  try { creds = await decryptCredentials(conn.credential_ref); } catch (e: any) { return { error: e.message }; }
  if (!creds.accessToken) return { error: 'No access token' };
  const shouldRefresh = creds.expiresAt ? Date.now() + 5 * 60_000 >= new Date(creds.expiresAt).getTime() : false;
  if (shouldRefresh && creds.refreshToken) {
    try {
      const resp = await fetch(EBAY_TOKEN_URL, { method: 'POST', headers: { Authorization: `Basic ${btoa(`${creds.clientId}:${creds.clientSecret}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: creds.refreshToken }).toString(), signal: AbortSignal.timeout(12000) });
      const data = await resp.json();
      if (data.access_token) {
        creds = { ...creds, accessToken: data.access_token, expiresAt: new Date(Date.now() + (data.expires_in ?? 7200) * 1000).toISOString() };
        const ref = await encryptCredentials(creds);
        await supabase.from('marketplace_connectors').update({ credential_ref: ref, access_token_expires_at: creds.expiresAt, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('marketplace_id', 'ebay');
      }
    } catch {}
  }
  return { accessToken: creds.accessToken };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jr({ error: 'Method not allowed' }, 405);
  let body: any;
  try { body = await req.json(); } catch { return jr({ error: 'Invalid JSON' }, 400); }
  const { tenantId, route = 'sync_transactions', daysBack = 90 } = body;
  if (!tenantId) return jr({ error: 'tenantId required' }, 400);

  const supabase = adminClient();
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jr({ error: 'Authentication required.' }, 401);
  const tok = authHeader.replace('Bearer ', '').trim();
  if (!tok || tok === Deno.env.get('SUPABASE_ANON_KEY')) return jr({ error: 'Authentication required.' }, 401);
  try {
    const uc = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: uErr } = await uc.auth.getUser();
    if (uErr || !user) return jr({ error: 'Invalid token.' }, 401);
    const { data: m } = await supabase.from('tenant_memberships').select('id').eq('tenant_id', tenantId).eq('user_id', user.id).maybeSingle();
    if (!m) return jr({ error: 'Access denied.' }, 403);
  } catch (e: any) { return jr({ error: e.message }, 401); }

  const tr = await getToken(supabase, tenantId);
  if ('error' in tr) return jr({ error: tr.error, requiresReauth: true, financesApiAvailable: false }, 400);
  const { accessToken } = tr;
  const hdrs = { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB' };
  const fromDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
  const feeTypeMap: Record<string, string> = {
    SALE: 'sale', FINAL_VALUE_FEE: 'final_value_fee', FINAL_VALUE_FEE_FIXED_PER_ORDER: 'final_value_fee',
    SHIPPING_LABEL: 'shipping_label', REFUND: 'refund', CREDIT: 'credit',
    DISPUTE: 'dispute', PAYOUT: 'payout', CANCELLATION: 'cancellation', TRANSFER: 'transfer',
  };

  try {
    if (route === 'sync_transactions') {
      const allTx: any[] = []; let offset = 0, hasMore = true, fetchErr: string | undefined;
      while (hasMore) {
        const url = new URL(`${EBAY_FINANCES_API}/transaction`);
        url.searchParams.set('filter', `transactionDate:[${fromDate}..]`);
        url.searchParams.set('limit', '200'); url.searchParams.set('offset', String(offset));
        const signatureHeaders = await ebayFinancesSignatureHeaders(url, 'GET');
        const resp = await fetch(url.toString(), { headers: { ...hdrs, ...signatureHeaders }, signal: AbortSignal.timeout(20000) });
        if (!resp.ok) {
          const et = await resp.text().catch(() => '');
          if (resp.status === 403 || resp.status === 401) fetchErr = `eBay Finances API requires Managed Payments and sell.finances scope (HTTP ${resp.status}). Re-authorise eBay to enable exact fee data.`;
          else fetchErr = `Finances API HTTP ${resp.status}: ${et.slice(0, 200)}`;
          hasMore = false; break;
        }
        const data = await resp.json();
        const page: any[] = data.transactions ?? [];
        allTx.push(...page);
        offset += 200; hasMore = offset < (data.total ?? 0) && page.length > 0;
        if (hasMore) await new Promise(r => setTimeout(r, 100));
      }
      if (fetchErr && allTx.length === 0) return jr({ success: false, error: fetchErr, financesApiAvailable: false }, 403);

      let inserted = 0, updated = 0; const errors: string[] = [];
      for (const tx of allTx) {
        try {
          const txId = String(tx.transactionId ?? ''); if (!txId) continue;
          const txType = String(tx.transactionType ?? 'UNKNOWN');
          const amount = parseFloat(tx.amount?.value ?? '0') || 0;
          const currency = (tx.amount?.currency ?? 'GBP').toUpperCase();
          const ebayOrderId = tx.orderId ?? tx.legacyOrderId ?? null;
          let swishOrderId: string | null = null;
          if (ebayOrderId) {
            const { data: ord } = await supabase.from('orders').select('id').eq('tenant_id', tenantId).eq('external_order_id', ebayOrderId).maybeSingle();
            swishOrderId = ord?.id ?? null;
          }
          const { error: ue } = await supabase.from('ebay_financials').upsert({
            tenant_id: tenantId, ebay_transaction_id: txId, transaction_type: txType,
            order_id: swishOrderId, ebay_order_id: ebayOrderId, amount,
            fee_type: feeTypeMap[txType] ?? txType.toLowerCase(),
            currency, description: tx.feeType ?? txType,
            booking_entry: amount >= 0 ? 'CREDIT' : 'DEBIT',
            payout_id: tx.payoutId ?? null, payout_status: tx.payoutStatus ?? null,
            transaction_date: tx.transactionDate ?? new Date().toISOString(),
          }, { onConflict: 'ebay_transaction_id,tenant_id', ignoreDuplicates: false });
          if (ue) { if (ue.code === '23505') updated++; else errors.push(`TX ${txId}: ${ue.message}`); } else inserted++;

          // Update actual fees on orders with real eBay data
          if ((txType === 'FINAL_VALUE_FEE' || txType === 'FINAL_VALUE_FEE_FIXED_PER_ORDER') && swishOrderId && amount < 0) {
            const actualFee = Math.abs(amount);
            const { data: ord } = await supabase.from('orders').select('sale_price, shipping_cost').eq('id', swishOrderId).maybeSingle();
            if (ord) {
              const netRev = Math.round((Number(ord.sale_price) - actualFee - Number(ord.shipping_cost)) * 100) / 100;
              await supabase.from('orders').update({ marketplace_fee: actualFee, net_revenue: netRev, notes: 'fee_note:ACTUAL_EBAY', updated_at: new Date().toISOString() }).eq('id', swishOrderId);
              if (ebayOrderId) await supabase.from('sales').update({ marketplace_fee: actualFee, net_revenue: netRev }).eq('tenant_id', tenantId).eq('external_order_id', ebayOrderId);
            }
          }
        } catch (e: any) { errors.push(e.message); }
      }
      return jr({ success: true, financesApiAvailable: true, fetched: allTx.length, inserted, updated, errors: errors.slice(0, 10), partialError: fetchErr ?? null });
    }

    if (route === 'get_funds_summary') {
      const url = new URL(`${EBAY_FINANCES_API}/seller_funds_summary`);
      const signatureHeaders = await ebayFinancesSignatureHeaders(url, 'GET');
      const resp = await fetch(url.toString(), { headers: { ...hdrs, ...signatureHeaders }, signal: AbortSignal.timeout(15000) });
      if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        return jr({ success: false, error: `Seller funds summary API ${resp.status}: ${t.slice(0, 200)}`, financesApiAvailable: false }, 400);
      }
      const data = await resp.json();
      return jr({ success: true, fundsSummary: data, financesApiAvailable: true });
    }

    if (route === 'get_payouts') {
      const url = new URL(`${EBAY_FINANCES_API}/payout`);
      url.searchParams.set('filter', `lastAttemptedPayoutDate:[${fromDate}..]`); url.searchParams.set('limit', '100');
      const signatureHeaders = await ebayFinancesSignatureHeaders(url, 'GET');
      const resp = await fetch(url.toString(), { headers: { ...hdrs, ...signatureHeaders }, signal: AbortSignal.timeout(15000) });
      if (!resp.ok) { const t = await resp.text(); return jr({ success: false, error: `Payouts API ${resp.status}: ${t.slice(0, 200)}`, financesApiAvailable: false }, 400); }
      const data = await resp.json();
      return jr({ success: true, payouts: data.payouts ?? [], financesApiAvailable: true });
    }

    if (route === 'get_summary') {
      const { data: txData } = await supabase.from('ebay_financials').select('transaction_type, amount').eq('tenant_id', tenantId).gte('transaction_date', fromDate);
      const rows = txData ?? [];
      const s = (f: (r: any) => boolean, abs = false) => rows.filter(f).reduce((t: number, r: any) => t + (abs ? Math.abs(Number(r.amount)) : Number(r.amount)), 0);
      return jr({ success: true, financesApiAvailable: true, summary: {
        grossSales: Math.round(s(r => r.transaction_type === 'SALE' && r.amount > 0) * 100) / 100,
        actualFees: Math.round(s(r => r.transaction_type?.includes('FINAL_VALUE_FEE') && r.amount < 0, true) * 100) / 100,
        refunds: Math.round(s(r => r.transaction_type === 'REFUND') * 100) / 100,
        payouts: Math.round(s(r => r.transaction_type === 'PAYOUT', true) * 100) / 100,
        credits: Math.round(s(r => r.transaction_type === 'CREDIT' && r.amount > 0) * 100) / 100,
        shippingLabels: Math.round(s(r => r.transaction_type === 'SHIPPING_LABEL' && r.amount < 0, true) * 100) / 100,
        netAfterFees: Math.round((s(r => r.transaction_type === 'SALE' && r.amount > 0) - s(r => r.transaction_type?.includes('FINAL_VALUE_FEE') && r.amount < 0, true) + s(r => r.transaction_type === 'REFUND') + s(r => r.transaction_type === 'CREDIT' && r.amount > 0)) * 100) / 100,
        transactionCount: rows.length, daysBack,
      }});
    }

    return jr({ error: `Unknown route: ${route}` }, 400);
  } catch (err: any) {
    console.error(`[SWISH Finances] Error:`, err.message);
    return jr({ error: err.message ?? 'Internal error' }, 500);
  }
});
