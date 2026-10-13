// SWISH Entry Route — Coin Flipper (Coins niche)
//
// This is the explicit entry point for subscribers registered to the Coins niche.
// Deep-linking to /entry/coins sets activeNicheId='coins' and redirects to /(tabs).
// The niche is persisted to AsyncStorage so returning subscribers always land here.
//
// Route: /entry/coins

import { useEffect } from 'react';
import { Redirect } from 'expo-router';
import { useApp } from '@/hooks/useApp';

export default function CoinEntryRoute() {
  const { setActiveNiche, activeNicheId } = useApp();

  useEffect(() => {
    // Always enforce the coins niche when this entry route is loaded
    if (activeNicheId !== 'coins') {
      setActiveNiche('coins');
    }
  }, []);

  return <Redirect href="/(tabs)" />;
}
