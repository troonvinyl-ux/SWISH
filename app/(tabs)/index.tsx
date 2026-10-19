// SWISH — Niche Home Router
//
// SWISH is the invisible platform engine. Subscribers only ever see their niche.
// This screen renders the active niche's full experience as the app home tab.
// No "SWISH" branding shown to subscribers — they see Coin Flipper, Flipper MX, etc.
//
// Routing:
//   coins / coins_uk / coins_currency / coins_world → CoinFlipperScreen
//   motocross                                        → FlipperMXScreen
//   bicycles / cycling                               → BikeFlipperScreen
//   clothing / trainers_sneakers / fashion           → ThreadsFlipScreen
//   surplus_flip / catalog_flip / catalog_surplus   → SurplusFlipScreen
//   (no active niche / first launch)                 → NicheSelect

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
  const { activeNicheId, tenant, tenantLoading } = useApp();

  // Map the active niche to a product
  const product = resolveProductionNiche(activeNicheId);

  // Show a brief spinner while AppContext is initialising
  if (tenantLoading && !tenant) {
    return (
      <View style={s.loading}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  // Render only a recognised production product. Unknown values must never
  // fall through to Coin Flipper, even temporarily during account switching.
  if (product === 'coins') return <CoinFlipperScreen key={activeNicheId} isHomeTab />;
  if (product === 'motocross') return <FlipperMXScreen key={activeNicheId} isHomeTab />;
  if (product === 'bicycles') return <BikeFlipperScreen key={activeNicheId} isHomeTab />;
  if (product === 'clothing') return <ThreadsFlipScreen key={activeNicheId} isHomeTab />;
  if (product === 'surplus_flip') return <SurplusFlipScreen key={activeNicheId} />;
  return <Redirect href="/niche-select" />;
}

const s = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
});
