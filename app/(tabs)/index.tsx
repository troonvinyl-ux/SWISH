// SWISH — Niche Home Router
//
// SWISH is the invisible platform engine. Subscribers only ever see their niche.
// This screen renders the active niche's full experience as the app home tab.
// No "SWISH" branding shown to subscribers — they see Coin Flipper, Flipper MX, etc.
//
// Branded APKs must use their build-time niche identity before persisted account
// state has finished synchronising. Otherwise a Clothing APK can briefly render
// Coin Flipper when AsyncStorage still contains the last active niche.

import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useApp } from '@/hooks/useApp';
import { Colors } from '@/constants/theme';
import { Redirect } from 'expo-router';
import { resolveProductionNiche } from '@/services/nicheRouting';
import CoinFlipperScreen from '@/app/coin-flipper';
import FlipperMXScreen from '@/app/flipper-mx';
import BikeFlipperScreen from '@/app/bike-flipper';
import ThreadsFlipScreen from '@/app/threads-flip';
import SurplusFlipScreen from '@/app/surplus-flip';

export default function NicheHomeScreen() {
  const { activeNicheId, fixedNicheId, tenant, tenantLoading } = useApp();

  // Build-time identity wins over persisted/account-selected state in branded APKs.
  const effectiveNicheId = fixedNicheId ?? activeNicheId;
  const product = resolveProductionNiche(effectiveNicheId);

  // Show a brief spinner while AppContext is initialising
  if (tenantLoading && !tenant) {
    return (
      <View style={s.loading}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  // Render only the product compiled for this branded APK. Unknown values must
  // never fall through to Coin Flipper, even temporarily during account switching.
  if (product === 'coins') return <CoinFlipperScreen key={effectiveNicheId} isHomeTab />;
  if (product === 'motocross') return <FlipperMXScreen key={effectiveNicheId} isHomeTab />;
  if (product === 'bicycles') return <BikeFlipperScreen key={effectiveNicheId} isHomeTab />;
  if (product === 'clothing') return <ThreadsFlipScreen key={effectiveNicheId} isHomeTab />;
  if (product === 'surplus_flip') return <SurplusFlipScreen key={effectiveNicheId} />;
  return <Redirect href={"/niche-select" as any} />;
}

const s = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
});
