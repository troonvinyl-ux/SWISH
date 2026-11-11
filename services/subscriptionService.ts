// SWISH Subscription Service
// Handles Stripe subscription check, checkout, and portal via Edge Functions.
// All Stripe calls are server-side — this module is pure client orchestration.

import { getSupabaseClient } from '@/template';
import { backendRead } from './backendRequestService';
import { isAuthenticationFailure, recoverAuthenticatedSession, signInRequiredMessage } from './authSessionRecoveryService';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { Linking } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';
import { isProductionNiche, ProductionNicheId } from '@/constants/niches';

export const STRIPE_PRODUCT_ID = 'prod_VQ0JxUCL29SZPQ';
export const STRIPE_PRICE_ID   = 'price_1UPAIlI5Y99su2PXUrM192qL';

// ── Subscription status returned by check-subscription ───────────────────────

export interface SubscriptionStatus {
  subscribed: boolean;
  /** Trusted role supplied by the existing server-side owner helper. Never user metadata. */
  platformOwner?: boolean;
  productId: string | null;
  priceId: string | null;
  subscriptionEnd: string | null;
  /** Server-computed set of niches covered by verified active Stripe subscriptions. */
  nicheEntitlements: ProductionNicheId[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function invokeEdgeFunction<T = any>(
  name: string,
  body: Record<string, any> = {},
): Promise<{ data: T | null; error: string | null }> {
  const supabase = getSupabaseClient();
  // Only this read-only membership check may retry after a rejected JWT.
  // Checkout, portal and all other mutations retain their single-request behavior.
  let response;
  try {
    if (name === 'swish-check-subscription') {
      const sessionResult = await supabase.auth.getSession();
      if (sessionResult.error) throw new Error(sessionResult.error.message);
      const token = sessionResult.data.session?.access_token;
      if (!token) throw new Error(signInRequiredMessage);
      const readVerification = (accessToken: string) => backendRead(`subscription:${JSON.stringify(body)}`, async signal => {
        const current = await supabase.auth.getSession();
        if (current.error) throw new Error(current.error.message);
        if (current.data.session?.access_token !== accessToken) throw new Error('Authenticated session changed before verification. Retry with your current sign-in.');
        // Explicitly send the user JWT, never an anonymous fallback or the rejected token.
        return supabase.functions.invoke(name, { body, signal, headers: { Authorization: `Bearer ${accessToken}` } });
      }, 'access', 20000);
      try {
        response = await readVerification(token);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : '';
        if (!isAuthenticationFailure(message)) throw cause;
        const recovered = await recoverAuthenticatedSession(token);
        if (recovered.error || !recovered.accessToken) throw new Error(recovered.error ?? signInRequiredMessage);
        try { response = await readVerification(recovered.accessToken); }
        catch (retryCause) {
          if (isAuthenticationFailure(retryCause instanceof Error ? retryCause.message : '')) throw new Error(signInRequiredMessage);
          throw retryCause;
        }
      }
    } else response = await supabase.functions.invoke(name, { body });
  } catch (cause) { return { data: null, error: cause instanceof Error ? cause.message : 'Subscription verification unavailable' }; }
  const { data, error } = response;

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

export async function checkSubscription(tenantId?: string): Promise<{
  status: SubscriptionStatus | null;
  error: string | null;
}> {
  const { data, error } = await invokeEdgeFunction<{
    subscribed: boolean;
    product_id: string | null;
    price_id: string | null;
    subscription_end: string | null;
    niche_entitlements?: unknown;
    is_platform_owner?: boolean;
  }>('swish-check-subscription', tenantId ? { tenantId } : {});

  if (error || !data) {
    return { status: null, error: error ?? 'Subscription check failed' };
  }

  return {
    status: {
      subscribed: data.subscribed,
      platformOwner: typeof data.is_platform_owner === 'boolean' ? data.is_platform_owner : undefined,
      productId: data.product_id,
      priceId: data.price_id,
      subscriptionEnd: data.subscription_end,
      // Treat the Edge Function response as untrusted input. Only canonical
      // production niches may be represented as Stripe entitlements.
      nicheEntitlements: Array.isArray(data.niche_entitlements)
        ? data.niche_entitlements.filter(
            (id): id is ProductionNicheId => typeof id === 'string' && isProductionNiche(id),
          )
        : [],
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
  activeNicheId?: string | null,
): boolean {
  // Existing tenant-wide lifetime/business/enterprise tiers retain their
  // established semantics. Stripe subscriptions are scoped to a single niche.
  if (subscriptionTier && PREMIUM_TIERS.includes(subscriptionTier)) return true;
  if (!status?.subscribed || status.productId !== STRIPE_PRODUCT_ID) return false;
  if (!activeNicheId || !isProductionNiche(activeNicheId)) return false;
  return status.nicheEntitlements.includes(activeNicheId);
}

// ── Start Stripe Checkout ─────────────────────────────────────────────────────

export async function startCheckout(nicheId = 'coins', appScheme?: string): Promise<{
  opened: boolean;
  error: string | null;
}> {
  const resolvedScheme = appScheme ?? Constants.expoConfig?.extra?.swishAppScheme;
  const { data, error } = await invokeEdgeFunction<{ url: string }>(
    'swish-create-checkout',
    { nicheId, appScheme: resolvedScheme },
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
