import { corsHeaders } from './cors.ts';
import modules from '../../../niche-modules.json' with { type: 'json' };
import { LEGACY_PREMIUM_TIERS, verifiedSubscriptionNiches, type StripeSubscriptionEvidence } from '../../../shared/nicheAuthorization.ts';

// Structural contract accepts the existing unique Supabase admin client, not a second auth system.
type AdminClient = { from: (table: string) => any; rpc: (name: string, args: Record<string, unknown>) => any };
type Account = { id: string; email?: string };
export class NicheAccessError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function nicheAccessResponse(error: unknown): Response | null {
  if (!(error instanceof NicheAccessError)) return null;
  return new Response(JSON.stringify({ error: error.code, message: error.message, upgradeRequired: error.status === 402 }), { status: error.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
export async function requireTenantMembership(admin: AdminClient, userId: string, tenantId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) throw new NicheAccessError(400, 'INVALID_TENANT', 'A valid business account is required.');
  const { data, error } = await admin.from('tenant_memberships').select('id').eq('user_id', userId).eq('tenant_id', tenantId).maybeSingle();
  if (error) throw new NicheAccessError(503, 'AUTHORIZATION_UNAVAILABLE', 'Account authorization is temporarily unavailable. Retry shortly.');
  if (!data) throw new NicheAccessError(403, 'TENANT_ACCESS_DENIED', 'Access denied for this business account.');
}
async function stripeList(path: string, key: string): Promise<any[]> {
  const rows: any[] = []; let cursor = '';
  for (let page = 0; page < 10; page++) {
    const url = `https://api.stripe.com/v1/${path}&limit=100${cursor ? '&starting_after=' + encodeURIComponent(cursor) : ''}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(6000) });
    if (!response.ok) throw new Error('Stripe verification unavailable');
    const body = await response.json();
    if (!Array.isArray(body.data)) throw new Error('Invalid Stripe response');
    rows.push(...body.data);
    if (!body.has_more) return rows;
    cursor = body.data[body.data.length - 1]?.id;
    if (!cursor) throw new Error('Incomplete Stripe response');
  }
  throw new Error('Stripe verification exceeded pagination limit');
}
export async function refreshVerifiedNiches(admin: AdminClient, account: Account): Promise<string[]> {
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key || !account.email) throw new NicheAccessError(503, 'BILLING_UNAVAILABLE', 'Billing verification is temporarily unavailable. Existing lifetime access is unaffected.');
  const checkedAt = new Date();
  try {
    const customers = await stripeList(`customers?email=${encodeURIComponent(account.email)}`, key);
    // Email equality alone never grants access; only server-owned customer metadata binds the user.
    const owned = customers.filter(customer => customer.metadata?.user_id === account.id);
    const subscriptions: StripeSubscriptionEvidence[] = [];
    for (const customer of owned) subscriptions.push(...await stripeList(`subscriptions?customer=${encodeURIComponent(customer.id)}&status=all`, key));
    const verified = verifiedSubscriptionNiches(subscriptions, account.id, Object.keys(modules.products), checkedAt.getTime() / 1000);
    const expires = checkedAt.getTime() + 5 * 60 * 1000;
    const grants = [...verified].map(([niche_id, periodEnd]) => ({ niche_id, expires_at: new Date(Math.min(expires, periodEnd * 1000)).toISOString() }));
    // Atomic server-only snapshot: cancellation revokes the old cache, old racing responses cannot resurrect it.
    const { data, error } = await admin.rpc('swish_cache_verified_niches', { p_user_id: account.id, p_checked_at: checkedAt.toISOString(), p_grants: grants });
    if (error || data !== true) throw new Error('Entitlement cache unavailable');
    return [...verified.keys()];
  } catch {
    throw new NicheAccessError(503, 'BILLING_UNAVAILABLE', 'Unable to verify subscription access. Retry shortly; no new access was granted.');
  }
}
export async function requirePaidNiche(admin: AdminClient, account: Account, tenantId: string, nicheId: string | null) {
  await requireTenantMembership(admin, account.id, tenantId);
  const { data: tenant, error: tenantError } = await admin.from('tenants').select('subscription_tier').eq('id', tenantId).maybeSingle();
  if (tenantError || !tenant) throw new NicheAccessError(503, 'AUTHORIZATION_UNAVAILABLE', 'Business authorization is temporarily unavailable.');
  // These existing tiers are immutable to clients; preserve all established tenant-wide rights, including lifetime.
  if ((LEGACY_PREMIUM_TIERS as readonly string[]).includes(tenant.subscription_tier)) return { source: 'tenant_tier', tier: tenant.subscription_tier, isPremium: true };
  if (!nicheId || !Object.hasOwn(modules.products, nicheId)) throw new NicheAccessError(403, 'UNREGISTERED_PAID_NICHE', 'This specialist has no registered paid-niche entitlement.');
  const { data: grant, error } = await admin.from('niche_entitlements').select('expires_at').eq('user_id', account.id).eq('niche_id', nicheId).gt('expires_at', new Date().toISOString()).maybeSingle();
  if (error) throw new NicheAccessError(503, 'AUTHORIZATION_UNAVAILABLE', 'Entitlement verification is temporarily unavailable.');
  if (grant) return { source: 'verified_stripe_cache', tier: tenant.subscription_tier, isPremium: true };
  await refreshVerifiedNiches(admin, account);
  // Re-read after snapshot reconciliation: an older racing response cannot authorize over a newer revocation.
  const { data: refreshed, error: refreshError } = await admin.from('niche_entitlements').select('expires_at').eq('user_id', account.id).eq('niche_id', nicheId).gt('expires_at', new Date().toISOString()).maybeSingle();
  if (refreshError) throw new NicheAccessError(503, 'AUTHORIZATION_UNAVAILABLE', 'Entitlement verification is temporarily unavailable.');
  if (!refreshed) throw new NicheAccessError(402, 'PAID_NICHE_REQUIRED', 'A verified subscription for this niche is required. Review your subscription or refresh after checkout.');
  return { source: 'verified_stripe', tier: tenant.subscription_tier, isPremium: true };
}
