// Pure entitlement rules shared by server guards and regression tests. Never trusts client billing claims.
export const SWISH_SUBSCRIPTION_PRODUCT = 'prod_VQ0JxUCL29SZPQ';
export const LEGACY_PREMIUM_TIERS = ['professional', 'business', 'enterprise', 'lifetime'] as const;
export interface StripeSubscriptionEvidence {
  status?: string; metadata?: Record<string, string>; current_period_end?: number;
  items?: { data?: Array<{ current_period_end?: number; price?: { product?: string | { id?: string } } }> };
}
export function verifiedSubscriptionNiches(subscriptions: StripeSubscriptionEvidence[], userId: string, allowed: readonly string[], nowSeconds: number) {
  const result = new Map<string, number>();
  for (const sub of subscriptions) {
    if (!['active', 'trialing'].includes(sub.status ?? '')) continue;
    // Customer ownership MUST already have been verified server-side. Conflicting sub ownership is rejected.
    if (sub.metadata?.user_id && sub.metadata.user_id !== userId) continue;
    const niche = sub.metadata?.niche_id ?? 'coins'; // Established legacy Stripe subscriptions remain Coins only.
    if (!allowed.includes(niche)) continue;
    for (const item of sub.items?.data ?? []) {
      const product = typeof item.price?.product === 'string' ? item.price.product : item.price?.product?.id;
      const end = item.current_period_end ?? sub.current_period_end;
      if (product !== SWISH_SUBSCRIPTION_PRODUCT || !Number.isFinite(end) || (end ?? 0) <= nowSeconds) continue;
      result.set(niche, Math.max(result.get(niche) ?? 0, end!));
    }
  }
  return result;
}
