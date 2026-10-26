// SWISH — eBay Finances API Sync Edge Function
// Syncs real financial transaction data from eBay Managed Payments API.
// Routes: sync_transactions | get_payouts | get_funds_summary | get_summary
// POST body: { tenantId, route?, daysBack? }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encryptCredentials, decryptCredentials, isEncrypted } from '../_shared/credentialCrypto.ts';
import { ebayFinancesSignatureHeaders } from '../_shared/ebayDigitalSignature.ts';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const EBAY_FINANCES_API = 'https://apiz.ebay.com/sell/finances/v1';
const EBAY_TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';

function adminClient() { return createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''); }
function jr(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }

async function checkManagedPayments(accessToken: string): Promise<{ status?: string; error?: string }> {
  try {
    const url = 'https://api.ebay.com/sell/account/v1/payments_program/EBAY_GB/EBAY_PAYMENTS';
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    const body = await resp.text();
    if (!resp.ok) return { error: `Account API HTTP ${resp.status}` };
    const data = body ? JSON.parse(body) : {};
    return { status: String(data.status ?? 'UNKNOWN') };
  } catch {
    return { error: 'Account API check unavailable' };
  }
}

async function getToken(
  supabase: ReturnType<typeof adminClient>,
  tenantId: string,
  refreshForFinances = false,
): Promise<{ accessToken: string } | { error: string; requiresReauth?: boolean }> {
  const { data: conn, error: connectorError } = await supabase
    .from('marketplace_connectors')
    .select('credential_ref, status, access_token_expires_at')
    .eq('tenant_id', tenantId)
    .eq('marketplace_id', 'ebay')
    .maybeSingle();

  if (connectorError) return { error: 'Unable to read the eBay connector. Please retry.' };
  if (!conn?.credential_ref || conn.status !== 'connected') return { error: 'eBay not connected', requiresReauth: true };

  let creds: Record<string, unknown> & {
    accessToken?: string;
    refreshToken?: string;
    clientId?: string;
    clientSecret?: string;
    expiresAt?: string;
    financeScopeRefreshedAt?: string;
  };
  try {
    creds = await decryptCredentials(conn.credential_ref) as typeof creds;
  } catch {
    return { error: 'Stored eBay credentials could not be decrypted. Reconnect eBay or contact support.', requiresReauth: true };
  }

  if (!creds.accessToken) return { error: 'No eBay access token. Reconnect eBay.', requiresReauth: true };
  const storedExpiry = creds.expiresAt ?? (conn.access_token_expires_at as string | null | undefined) ?? undefined;
  const expiresAtMs = storedExpiry ? Date.parse(storedExpiry) : Number.NaN;
  const needsRefresh = !Number.isFinite(expiresAtMs) || Date.now() + 5 * 60_000 >= expiresAtMs;

  // swish-ebay-sync refreshes using a restricted scope set. Finance routes therefore
  // need one no-scope refresh after that event, not on every request. The marker lives
  // inside the already-encrypted credential payload and is cleared by the scoped refresher.
  const financeRefreshAt = creds.financeScopeRefreshedAt ? Date.parse(creds.financeScopeRefreshedAt) : Number.NaN;
  const needsFinanceScopeRefresh = refreshForFinances && (!isEncrypted(conn.credential_ref) || !Number.isFinite(financeRefreshAt));
  const hasRefreshCredentials = Boolean(creds.refreshToken && creds.clientId && creds.clientSecret);
  if (needsRefresh && !hasRefreshCredentials) {
    return { error: 'eBay authorisation has expired or is incomplete. Reconnect eBay.', requiresReauth: true };
  }
  if (needsRefresh || (needsFinanceScopeRefresh && hasRefreshCredentials)) {

    let refreshResponse: Response;
    try {
      refreshResponse = await fetch(EBAY_TOKEN_URL, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${creds.clientId}:${creds.clientSecret}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: creds.refreshToken,
        }).toString(),
        signal: AbortSignal.timeout(12000),
      });
    } catch {
      return { error: 'Unable to reach eBay token service. Please retry.' };
    }

    let data: { access_token?: string; expires_in?: number };
    try {
      data = await refreshResponse.json();
    } catch {
      return { error: 'eBay token service returned an invalid response. Please retry or reconnect eBay.' };
    }
    if (!refreshResponse.ok || !data.access_token) {
      if ([400, 401, 403].includes(refreshResponse.status)) {
        return { error: 'eBay authorisation is no longer valid. Reconnect eBay and retry.', requiresReauth: true };
      }
      return { error: 'eBay token refresh failed. Please retry.' };
    }

    const expiresIn = Number(data.expires_in);
    const nextExpiry = new Date(Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 7200) * 1000).toISOString();
    const nextCredentials = {
      ...creds,
      accessToken: data.access_token,
      expiresAt: nextExpiry,
      // This endpoint deliberately omits the OAuth scope parameter, preserving the consented scopes.
      financeScopeRefreshedAt: new Date().toISOString(),
    };
    const encryptedRef = await encryptCredentials(nextCredentials);
    const { error: updateError } = await supabase
      .from('marketplace_connectors')
      .update({ credential_ref: encryptedRef, access_token_expires_at: nextExpiry, updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .eq('marketplace_id', 'ebay');

    if (updateError) return { error: 'eBay token refreshed but could not be saved securely. Please retry.' };
    return { accessToken: data.access_token };
  }

  return { accessToken: creds.accessToken };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jr({ error: 'Method not allowed' }, 405);
  let body: unknown;
  try { body = await req.json(); } catch { return jr({ error: 'Invalid JSON' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return jr({ error: 'Request body must be a JSON object.' }, 400);
  }
  const { tenantId, route = 'sync_transactions', daysBack: requestedDaysBack = 90 } = body as Record<string, unknown>;
  if (typeof tenantId !== 'string' || tenantId.trim().length === 0 || tenantId.length > 200) {
    return jr({ error: 'A valid tenantId is required.' }, 400);
  }
  const allowedRoutes = new Set(['sync_transactions', 'get_payouts', 'get_funds_summary', 'get_summary']);
  if (typeof route !== 'string' || !allowedRoutes.has(route)) {
    return jr({ error: 'Unsupported finances route.' }, 400);
  }
  const daysBack = Number(requestedDaysBack);
  if (!Number.isInteger(daysBack) || daysBack < 1 || daysBack > 365) {
    return jr({ error: 'daysBack must be a whole number between 1 and 365.' }, 400);
  }

  const supabase = adminClient();
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return jr({ error: 'Authentication required.' }, 401);
  const tok = authHeader.slice('Bearer '.length).trim();
  if (!tok || tok === Deno.env.get('SUPABASE_ANON_KEY')) return jr({ error: 'Authentication required.' }, 401);
  try {
    const uc = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: uErr } = await uc.auth.getUser();
    if (uErr || !user) return jr({ error: 'Invalid token.' }, 401);
    const { data: m } = await supabase.from('tenant_memberships').select('id').eq('tenant_id', tenantId).eq('user_id', user.id).maybeSingle();
    if (!m) return jr({ error: 'Access denied.' }, 403);
  } catch {
    return jr({ error: 'Unable to verify authentication. Please sign in again.' }, 401);
  }

  const refreshForFinances = route === 'sync_transactions' || route === 'get_funds_summary' || route === 'get_payouts';
  let tr: Awaited<ReturnType<typeof getToken>>;
  try {
    tr = await getToken(supabase, tenantId, refreshForFinances);
  } catch {
    // Encryption/secret configuration errors must not escape as raw runtime exceptions.
    console.error('[SWISH Finances] Could not prepare a secure eBay token.');
    return jr({ error: 'Unable to prepare eBay authorisation securely. Check server configuration or contact support.' }, 500);
  }
  if ('error' in tr) {
    const reauth = tr.requiresReauth === true;
    return jr({ error: tr.error, requiresReauth: reauth, financesApiAvailable: false }, reauth ? 400 : 503);
  }
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
          if (resp.status === 403 || resp.status === 401) {
            const payments = await checkManagedPayments(accessToken);
            const diagnosis = payments.status === 'OPTED_IN'
              ? 'eBay reports Managed Payments is enabled; this points to a missing sell.finances grant or an eBay app-key permission issue. Re-authorise eBay in SWISH, then retry. If it still fails, verify sell.finances is assigned to the Production keyset in eBay Developer Portal.'
              : payments.status
                ? `eBay Managed Payments status: ${payments.status}. Check seller payments onboarding and re-authorise eBay in SWISH.`
                : 'SWISH could not verify Managed Payments status. Re-authorise eBay in SWISH and check the Production keyset scopes.';
            fetchErr = `eBay Finances API HTTP ${resp.status}. ${diagnosis}`;
          } else fetchErr = `Finances API HTTP ${resp.status}: ${et.slice(0, 200)}`;
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
          const { data: existingTx, error: existingTxError } = await supabase
            .from('ebay_financials')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('ebay_transaction_id', txId)
            .maybeSingle();
          if (existingTxError) {
            errors.push(`TX ${txId}: unable to check existing transaction state.`);
            continue;
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
          if (ue) {
            // A remaining constraint error means the write failed; do not apply downstream
            // order fee side effects when the source transaction was not persisted.
            errors.push(`TX ${txId}: transaction could not be persisted (database constraint).`);
            continue;
          } else if (existingTx) {
            updated++;
          } else {
            inserted++;
          }

          // Update actual fees on orders with real eBay data
          if ((txType === 'FINAL_VALUE_FEE' || txType === 'FINAL_VALUE_FEE_FIXED_PER_ORDER') && swishOrderId && amount < 0) {
            const actualFee = Math.abs(amount);
            const { data: ord } = await supabase.from('orders').select('sale_price, shipping_cost').eq('id', swishOrderId).eq('tenant_id', tenantId).maybeSingle();
            if (ord) {
              const netRev = Math.round((Number(ord.sale_price) - actualFee - Number(ord.shipping_cost)) * 100) / 100;
              await supabase.from('orders').update({ marketplace_fee: actualFee, net_revenue: netRev, notes: 'fee_note:ACTUAL_EBAY', updated_at: new Date().toISOString() }).eq('id', swishOrderId).eq('tenant_id', tenantId);
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
      // eBay returns 204 when there are no pending, processing, or held funds.
      if (resp.status === 204) {
        return jr({ success: true, fundsSummary: { availableFunds: { value: '0', currency: 'GBP' }, processingFunds: { value: '0', currency: 'GBP' }, fundsOnHold: { value: '0', currency: 'GBP' }, totalFunds: { value: '0', currency: 'GBP' } }, financesApiAvailable: true, noPendingFunds: true });
      }
      if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        if (resp.status === 401 || resp.status === 403) {
          const payments = await checkManagedPayments(accessToken);
          const diagnosis = payments.status === 'OPTED_IN'
            ? 'eBay reports Managed Payments is enabled; this points to a missing sell.finances grant or an eBay app-key permission issue. Re-authorise eBay in SWISH, then retry. If it still fails, verify sell.finances is assigned to the Production keyset in eBay Developer Portal.'
            : payments.status
              ? `eBay Managed Payments status: ${payments.status}. Check seller payments onboarding and re-authorise eBay in SWISH.`
              : 'SWISH could not verify Managed Payments status. Re-authorise eBay in SWISH and check the Production keyset scopes.';
          return jr({ success: false, error: `Seller funds summary API HTTP ${resp.status}. ${diagnosis}`, financesApiAvailable: false, managedPaymentsStatus: payments.status ?? null, diagnostic: payments.error ?? null }, 400);
        }
        return jr({ success: false, error: `Seller funds summary API returned HTTP ${resp.status}.`, financesApiAvailable: false }, 400);
      }
      const data = await resp.json();
      return jr({ success: true, fundsSummary: data, financesApiAvailable: true });
    }

    if (route === 'get_payouts') {
      const url = new URL(`${EBAY_FINANCES_API}/payout`);
      url.searchParams.set('filter', `lastAttemptedPayoutDate:[${fromDate}..]`); url.searchParams.set('limit', '100');
      const signatureHeaders = await ebayFinancesSignatureHeaders(url, 'GET');
      const resp = await fetch(url.toString(), { headers: { ...hdrs, ...signatureHeaders }, signal: AbortSignal.timeout(15000) });
      if (!resp.ok) return jr({ success: false, error: `Payouts API returned HTTP ${resp.status}.`, financesApiAvailable: false }, 400);
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
    // Log the server-side failure for operators without returning internal details.
    console.error('[SWISH Finances] Request failed:', err instanceof Error ? err.message : 'unknown error');
    return jr({ error: 'Financial request failed. Please retry; contact support if the issue continues.' }, 500);
  }
});
