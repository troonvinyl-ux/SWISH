// hooks/useSubscription.ts
// Thin hook that exposes subscription state from AppContext.
// The actual Stripe check is fired from AppContext after auth.

import { useApp } from '@/hooks/useApp';
import { isPremiumSubscriber } from '@/services/subscriptionService';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';

export function useSubscription() {
  const { subscriptionStatus, subscriptionLoading, subscriptionTier, refreshSubscription } = useApp();
  const router = useRouter();

  // isPremiumSubscriber now checks both tenant tier (lifetime) and Stripe subscription
  const isPremium = isPremiumSubscriber(subscriptionStatus, subscriptionTier);

  /** Navigate to the subscription screen to show the upgrade CTA. */
  const promptUpgrade = useCallback(() => {
    router.push('/subscription' as any);
  }, [router]);

  return {
    status: subscriptionStatus,
    tier: subscriptionTier,
    loading: subscriptionLoading,
    isPremium,
    refresh: refreshSubscription,
    promptUpgrade,
  };
}
