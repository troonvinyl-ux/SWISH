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
//   (no active niche / first launch)                 → NicheSelect

import React, { useEffect, useRef } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useApp } from '@/hooks/useApp';
import { Colors } from '@/constants/theme';
import CoinFlipperScreen from '@/app/coin-flipper';
import FlipperMXScreen from '@/app/flipper-mx';
import BikeFlipperScreen from '@/app/bike-flipper';
import ThreadsFlipScreen from '@/app/threads-flip';

// Niche ID → specialist grouping
function nicheToProduct(nicheId: string | null | undefined): 'coins' | 'mx' | 'bikes' | 'clothing' | null {
  if (!nicheId) return null;
  const id = nicheId.toLowerCase();
  if (id === 'coins' || id.includes('coin') || id === 'banknotes' || id === 'gold' || id === 'silver' || id === 'islamic_silver') return 'coins';
  if (id === 'motocross' || id === 'mx' || id === 'flipper_mx') return 'mx';
  if (id === 'bicycles' || id === 'cycling' || id === 'bike_flipper' || id === 'bikes') return 'bikes';
  if (id === 'clothing' || id === 'fashion' || id === 'threads_flip' || id === 'trainers_sneakers' || id === 'trainers') return 'clothing';
  return null;
}

export default function NicheHomeScreen() {
  const { activeNicheId, tenant, loading: appLoading } = useApp();

  // Map the active niche to a product
  const product = nicheToProduct(activeNicheId);

  // Show a brief spinner while AppContext is initialising
  if (appLoading && !tenant) {
    return (
      <View style={s.loading}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  // Render the correct niche product as the home screen
  // Each screen receives isHomeTab={true} to suppress the back button
  if (product === 'coins') return <CoinFlipperScreen isHomeTab />;
  if (product === 'mx')    return <FlipperMXScreen isHomeTab />;
  if (product === 'bikes') return <BikeFlipperScreen isHomeTab />;
  if (product === 'clothing') return <ThreadsFlipScreen isHomeTab />;

  // Default: if no niche set or unrecognised, show Coin Flipper (most common)
  // The niche screens themselves handle the case where a user hasn't subscribed
  return <CoinFlipperScreen isHomeTab />;
}

const s = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
});
