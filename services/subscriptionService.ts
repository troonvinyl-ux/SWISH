// SWISH Subscription Service
// Handles Stripe subscription check, checkout, and portal via Edge Functions.
// All Stripe calls are server-side — this module is pure client orchestration.

import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { Linking } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

export const STRIPE_PRODUCT_ID = 'prod_VQ0JxUCL29SZPQ';
export const STRIPE_PRICE_ID   = 'price_1UPAIlI5Y99su2PXUrM192qL';

// ── Subscription status returned by check-subscription ───────────────────────

export interface SubscriptionStatus {
  subscribed: boolean;
  productId: string | null;
  priceId: string | null;
  subscriptionEnd: string | null;
  // null means an older check-subscription response without niche entitlements.
  nicheEntitlements: string[] | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function invokeEdgeFunction<T = any>(
  name: string,
  body: Record<string, any> = {},
): Promise<{ data: T | null; error: string | null }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.functions.invoke(name, { body });

  if (error) {
    let msg = error.message;
    if (error instanceof FunctionsHttpError) {
      try {
        const text = await error.context?.text();
        msg = `[${error.context?.status ?? 500}] ${text || error.message}`;
      } catch {
        msg = error.message;
      }
    }
    return { data: null, error: msg };
  }

  return { data: data as T, error: null };
}

// ── Check subscription status ─────────────────────────────────────────────────

export async function checkSubscription(): Promise<{
  status: SubscriptionStatus | null;
  error: string | null;
}> {
  const { data, error } = await invokeEdgeFunction<{
    subscribed: boolean;
    product_id: string | null;
    price_id: string | null;
    subscription_end: string | null;
    niche_entitlements?: string[];
  }>('swish-check-subscription');

  if (error || !data) {
    return { status: null, error: error ?? 'Subscription check failed' };
  }

  return {
    status: {
      subscribed: data.subscribed,
      productId: data.product_id,
      priceId: data.price_id,
      subscriptionEnd: data.subscription_end,
      nicheEntitlements: Array.isArray(data.niche_entitlements) ? data.niche_entitlements : null,
    },
    error: null,
  };
}

// ── Determine if the user has an active premium subscription ──────────────────

/** Subscription tiers that grant full premium access (including lifetime admin tier). */
export const PREMIUM_TIERS = ['professional', 'business', 'enterprise', 'lifetime'];

export function isPremiumSubscriber(
  status: SubscriptionStatus | null,
  subscriptionTier?: string | null,
  activeNicheId = 'coins',
): boolean {
  // Existing tenant-level premium tiers intentionally remain global.
  if (subscriptionTier && PREMIUM_TIERS.includes(subscriptionTier)) return true;
  if (!status?.subscribed || status.productId !== STRIPE_PRODUCT_ID) return false;

  // New endpoint responses explicitly scope access to the purchased niche(s).
  if (status.nicheEntitlements !== null) {
    return status.nicheEntitlements.includes(activeNicheId);
  }

  // Backward compatibility while an older deployed Edge Function is still live:
  // an unscoped legacy response may unlock Coins only, never another niche.
  return activeNicheId === 'coins';
}

// ── Start Stripe Checkout ─────────────────────────────────────────────────────

export async function startCheckout(nicheId = 'coins'): Promise<{
  opened: boolean;
  error: string | null;
}> {
  const { data, error } = await invokeEdgeFunction<{ url: string }>(
    'swish-create-checkout',
    { nicheId },
  );

  if (error || !data?.url) {
    return { opened: false, error: error ?? 'Failed to create checkout session' };
  }

  try {
    const result = await WebBrowser.openBrowserAsync(data.url);
    return { opened: result.type === 'opened' || result.type === 'dismiss', error: null };
  } catch {
    // Fallback to system browser
    await Linking.openURL(data.url);
    return { opened: true, error: null };
  }
}

// ── Open Stripe Customer Portal ───────────────────────────────────────────────

export async function openCustomerPortal(): Promise<{
  opened: boolean;
  error: string | null;
}> {
  const { data, error } = await invokeEdgeFunction<{ url: string }>('swish-customer-portal');

  if (error || !data?.url) {
    return { opened: false, error: error ?? 'Failed to open subscription portal' };
  }

  try {
    const result = await WebBrowser.openBrowserAsync(data.url);
    return { opened: result.type === 'opened' || result.type === 'dismiss', error: null };
  } catch {
    await Linking.openURL(data.url);
    return { opened: true, error: null };
  }
}

// ── Get current monthly AI usage quota ───────────────────────────────────────
// Reads the ai_usage table AND checks tenant tier for accurate premium status.
// isPremium is true for lifetime/professional/business/enterprise tiers.
export async function getMonthlyQuota(
  tenantId: string,
  userId: string,
): Promise<{ used: number; limit: number; remaining: number; isPremium: boolean } | null> {
  const supabase = getSupabaseClient();

  const monthKey = new Date().toISOString().slice(0, 7); // 'YYYY-MM'

  // Read usage and tenant tier in parallel
  const [usageResult, tenantResult] = await Promise.all([
    supabase
      .from('ai_usage')
      .select('count')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .eq('feature', 'identify')
      .eq('month_key', monthKey)
      .maybeSingle(),
    supabase
      .from('tenants')
      .select('subscription_tier')
      .eq('id', tenantId)
      .maybeSingle(),
  ]);

  const used = Number(usageResult.data?.count ?? 0);
  const limit = 5; // FREE_MONTHLY_QUOTA — keep in sync with edge function

  // Check tenant tier for premium access (mirrors server-side PREMIUM_TIERS)
  const tier = tenantResult.data?.subscription_tier ?? null;
  const isPremium = PREMIUM_TIERS.includes(tier ?? '');

  if (isPremium) {
    return { used, limit: 0, remaining: 0, isPremium: true }; // unlimited
  }

  return { used, limit, remaining: Math.max(0, limit - used), isPremium: false };
}

// ── Format subscription end date ──────────────────────────────────────────────

export function formatSubscriptionEnd(isoDate: string | null): string {
  if (!isoDate) return '';
  try {
    return new Date(isoDate).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return isoDate;
  }
}
