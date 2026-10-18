// SWISH Subscription Screen
// Shows current subscription status, plan details, and handles upgrade/management.

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { useSubscription } from '@/hooks/useSubscription';
import { useApp } from '@/hooks/useApp';
import { startCheckout, openCustomerPortal, formatSubscriptionEnd } from '@/services/subscriptionService';
import { useAlert } from '@/template';

// ── Plan features ─────────────────────────────────────────────────────────────

const FREE_FEATURES = [
  'Basic inventory management',
  'Manual item records',
  'Up to 50 items in stock',
  '5 AI identifications per month',
  'Basic photo capture',
];

const PREMIUM_FEATURES_BY_NICHE: Record<string, Array<{ label: string; icon: string }>> = {
  coins: [
    { label: 'Advanced coin identification', icon: 'toll' },
    { label: 'Numista and specialist references', icon: 'menu-book' },
    { label: 'Evidence-led market valuations', icon: 'analytics' },
    { label: 'eBay listing tools', icon: 'storefront' },
    { label: 'Collection and profit insights', icon: 'trending-up' },
  ],
  motocross: [
    { label: 'Motocross and enduro identification', icon: 'two-wheeler' },
    { label: 'Condition and repair assessment', icon: 'build' },
    { label: 'Evidence-led market valuations', icon: 'analytics' },
    { label: 'Buying and resale analysis', icon: 'price-check' },
    { label: 'Listing tools and profit tracking', icon: 'trending-up' },
  ],
  bicycles: [
    { label: 'Bicycle model identification', icon: 'pedal-bike' },
    { label: 'Component and upgrade compatibility', icon: 'settings' },
    { label: 'Condition and repair assessment', icon: 'build' },
    { label: 'Evidence-led market valuations', icon: 'analytics' },
    { label: 'Listing tools and profit tracking', icon: 'trending-up' },
  ],
  clothing: [
    { label: 'Brand, garment and era identification', icon: 'checkroom' },
    { label: 'Authenticity and condition assessment', icon: 'verified' },
    { label: 'Evidence-led market valuations', icon: 'analytics' },
    { label: 'eBay listing tools', icon: 'storefront' },
    { label: 'Resale and profit insights', icon: 'trending-up' },
  ],
};
const PRODUCT_LABELS: Record<string, string> = {
  coins: 'Coin Flipper',
  motocross: 'Flipper MX',
  bicycles: 'Bike Flipper',
  clothing: 'Threads Flip',
};

// ── Components ────────────────────────────────────────────────────────────────

function PremiumFeatureRow({ label, icon }: { label: string; icon: string }) {
  return (
    <View style={fc.row}>
      <View style={fc.iconWrap}>
        <MaterialIcons name={icon as any} size={15} color={Colors.primary} />
      </View>
      <Text style={fc.label}>{label}</Text>
      <MaterialIcons name="check" size={14} color={Colors.success} />
    </View>
  );
}

const fc = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingVertical: 8,
  },
  iconWrap: {
    width: 28, height: 28, borderRadius: Radius.sm,
    backgroundColor: Colors.primaryDim,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  label: { flex: 1, fontSize: Typography.size.sm, color: Colors.textPrimary },
});

// ── Main screen ───────────────────────────────────────────────────────────────

export default function SubscriptionScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showAlert } = useAlert();
  const { status, loading, isPremium, refresh } = useSubscription();
  const { activeNicheId } = useApp();
  const productLabel = PRODUCT_LABELS[activeNicheId] ?? 'SWISH';
  const premiumFeatures = PREMIUM_FEATURES_BY_NICHE[activeNicheId] ?? PREMIUM_FEATURES_BY_NICHE.coins;

  const [checkingOut, setCheckingOut] = useState(false);
  const [openingPortal, setOpeningPortal] = useState(false);

  // Handle deep link return from Stripe
  useEffect(() => {
    const handleUrl = ({ url }: { url: string }) => {
      if (url.includes('subscription/success')) {
        setTimeout(() => refresh(), 2000);
        showAlert('Subscription activated!', 'Welcome to SWISH Premium. Your specialist tools are now unlocked.');
      } else if (url.includes('subscription/cancel')) {
        showAlert('Checkout cancelled', 'Your subscription was not changed.');
      }
    };
    const sub = Linking.addEventListener('url', handleUrl);
    return () => sub.remove();
  }, [refresh, showAlert]);

  const handleSubscribe = useCallback(async () => {
    setCheckingOut(true);
    // Checkout metadata must identify the niche the subscriber is viewing.
    // This does not replace server-side entitlement enforcement; it prevents
    // every niche's upgrade button from incorrectly purchasing the coins niche.
    const { opened, error } = await startCheckout(activeNicheId);
    setCheckingOut(false);
    if (error) {
      showAlert('Checkout Failed', error);
    } else if (opened) {
      // Will refresh subscription state when user returns via deep link
      setTimeout(() => refresh(), 4000);
    }
  }, [refresh, showAlert]);

  const handleManage = useCallback(async () => {
    setOpeningPortal(true);
    const { opened, error } = await openCustomerPortal();
    setOpeningPortal(false);
    if (error) {
      showAlert('Portal Error', error);
    } else if (opened) {
      setTimeout(() => refresh(), 3000);
    }
  }, [refresh, showAlert]);

  const renewalDate = formatSubscriptionEnd(status?.subscriptionEnd ?? null);

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + Spacing.base }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={20} color={Colors.textSecondary} />
        </Pressable>
        <View style={s.flex}>
          <Text style={s.title}>Subscription</Text>
          <Text style={s.subtitle}>{productLabel} Premium</Text>
        </View>
        <Pressable
          onPress={refresh}
          style={s.refreshBtn}
          hitSlop={8}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator size="small" color={Colors.textTertiary} />
            : <MaterialIcons name="refresh" size={18} color={Colors.textTertiary} />}
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Current plan card */}
        <View style={[s.planCard, isPremium ? s.planCardPremium : s.planCardFree]}>
          <View style={s.planTop}>
            <View style={[s.planBadge, isPremium ? s.planBadgePremium : s.planBadgeFree]}>
              <MaterialIcons
                name={isPremium ? 'workspace-premium' : 'lock-open'}
                size={18}
                color={isPremium ? Colors.gold : Colors.textSecondary}
              />
              <Text style={[s.planBadgeText, isPremium ? s.planBadgeTextPremium : {}]}>
                {isPremium ? 'PREMIUM' : 'FREE'}
              </Text>
            </View>
            <View style={s.flex} />
            {loading ? (
              <ActivityIndicator size="small" color={Colors.textTertiary} />
            ) : (
              <View style={[s.statusDot, { backgroundColor: isPremium ? Colors.success : Colors.textTertiary }]} />
            )}
          </View>

          <Text style={s.planName}>
            {isPremium ? `${productLabel} Premium` : `${productLabel} Free`}
          </Text>
          <Text style={s.planPrice}>
            {isPremium ? '£9.99 / month' : 'Free forever'}
          </Text>

          {isPremium && renewalDate ? (
            <View style={s.renewalRow}>
              <MaterialIcons name="event" size={13} color={Colors.textTertiary} />
              <Text style={s.renewalText}>Renews {renewalDate}</Text>
            </View>
          ) : null}

          {!isPremium ? (
            <Text style={s.planFreeNote}>
              5 AI identifications per month · Basic inventory
            </Text>
          ) : null}
        </View>

        {/* CTA button */}
        {isPremium ? (
          <Pressable
            onPress={handleManage}
            disabled={openingPortal}
            style={({ pressed }) => [s.manageBtn, pressed && { opacity: 0.85 }]}
          >
            {openingPortal ? (
              <ActivityIndicator size="small" color={Colors.primary} />
            ) : (
              <MaterialIcons name="manage-accounts" size={18} color={Colors.primary} />
            )}
            <Text style={s.manageBtnText}>
              {openingPortal ? 'Opening portal…' : 'Manage Subscription'}
            </Text>
            <MaterialIcons name="open-in-new" size={14} color={Colors.primary} />
          </Pressable>
        ) : (
          <Pressable
            onPress={handleSubscribe}
            disabled={checkingOut}
            style={({ pressed }) => [s.upgradeBtn, pressed && { opacity: 0.88 }, checkingOut && { opacity: 0.7 }]}
          >
            {checkingOut ? (
              <ActivityIndicator size="small" color={Colors.background} />
            ) : (
              <MaterialIcons name="workspace-premium" size={20} color={Colors.background} />
            )}
            <View>
              <Text style={s.upgradeBtnText}>
                {checkingOut ? 'Opening checkout…' : 'Upgrade to Premium'}
              </Text>
              <Text style={s.upgradeBtnSub}>£9.99 / month · Cancel any time</Text>
            </View>
          </Pressable>
        )}

        {/* Premium features */}
        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>PREMIUM FEATURES</Text>
        </View>
        <View style={s.featuresCard}>
          {premiumFeatures.map((f, i) => (
            <View key={f.label}>
              {i > 0 ? <View style={s.featureDivider} /> : null}
              <PremiumFeatureRow label={f.label} icon={f.icon} />
            </View>
          ))}
        </View>

        {/* Free tier */}
        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>FREE PLAN INCLUDES</Text>
        </View>
        <View style={s.freeCard}>
          {FREE_FEATURES.map((f, i) => (
            <View key={f} style={[s.freeRow, i > 0 && { borderTopWidth: 1, borderTopColor: Colors.surfaceBorder }]}>
              <MaterialIcons name="check" size={13} color={Colors.textSecondary} />
              <Text style={s.freeLabel}>{f}</Text>
            </View>
          ))}
        </View>

        {/* Note */}
        <View style={s.noteCard}>
          <MaterialIcons name="lock" size={12} color={Colors.textTertiary} />
          <Text style={s.noteText}>
            Payments are processed securely by Stripe. Cancel at any time from the Manage Subscription portal — you keep access until the end of the billing period.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.base, paddingBottom: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: Radius.md,
    backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  title: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  subtitle: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  refreshBtn: {
    width: 36, height: 36, borderRadius: Radius.md,
    backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },

  content: { padding: Spacing.base, gap: Spacing.lg },

  // Plan card
  planCard: {
    borderRadius: Radius.xxl, padding: Spacing.xl, gap: 6,
    borderWidth: 1, ...Shadow.md,
  },
  planCardPremium: {
    backgroundColor: '#12100A',
    borderColor: Colors.gold + '50',
  },
  planCardFree: {
    backgroundColor: Colors.surface,
    borderColor: Colors.surfaceBorder,
  },
  planTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  planBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: Radius.pill, borderWidth: 1,
  },
  planBadgePremium: { backgroundColor: '#2A2000', borderColor: Colors.gold + '60' },
  planBadgeFree:    { backgroundColor: Colors.surfaceHighlight, borderColor: Colors.surfaceBorder },
  planBadgeText: { fontSize: 10, fontWeight: Typography.weight.extrabold, color: Colors.textSecondary, letterSpacing: 0.8 },
  planBadgeTextPremium: { color: Colors.gold },
  statusDot: { width: 8, height: 8, borderRadius: 4 },

  planName: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  planPrice: { fontSize: Typography.size.lg, fontWeight: Typography.weight.extrabold, color: Colors.gold },
  renewalRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  renewalText: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  planFreeNote: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 4 },

  // Upgrade CTA
  upgradeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.sm, backgroundColor: Colors.primary,
    borderRadius: Radius.xxl, paddingVertical: Spacing.xl, paddingHorizontal: Spacing.xl,
    ...Shadow.md,
  },
  upgradeBtnText: { fontSize: Typography.size.lg, fontWeight: Typography.weight.extrabold, color: Colors.background },
  upgradeBtnSub: { fontSize: Typography.size.xs, color: Colors.background + 'BB', textAlign: 'center' },

  // Manage CTA
  manageBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.sm, backgroundColor: Colors.surface,
    borderRadius: Radius.xxl, paddingVertical: Spacing.base, paddingHorizontal: Spacing.xl,
    borderWidth: 1.5, borderColor: Colors.primary + '60',
  },
  manageBtnText: { fontSize: Typography.size.md, fontWeight: Typography.weight.semibold, color: Colors.primary, flex: 1 },

  sectionHeader: { marginBottom: -Spacing.sm },
  sectionTitle: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.textTertiary, letterSpacing: 0.8 },

  featuresCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.xxl,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    ...Shadow.sm,
  },
  featureDivider: { height: 1, backgroundColor: Colors.surfaceBorder },

  freeCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.xxl,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    overflow: 'hidden', ...Shadow.sm,
  },
  freeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingVertical: 11 },
  freeLabel: { flex: 1, fontSize: Typography.size.sm, color: Colors.textSecondary },

  noteCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.xl, padding: Spacing.md,
  },
  noteText: { flex: 1, fontSize: Typography.size.xs, color: Colors.textTertiary, lineHeight: 17 },
});
