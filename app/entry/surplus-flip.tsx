// SWISH Entry Route — Surplus Flip (Surplus Flip niche)
//
// This is the explicit entry point for subscribers registered to the Surplus Flip niche.
// Deep-linking to /entry/surplus-flip sets activeNicheId='surplus_flip' and redirects to /(tabs).
// The niche is persisted to AsyncStorage so returning subscribers always land here.
//
// Route: /entry/surplus-flip

import { useEffect } from 'react';
import { Redirect } from 'expo-router';
import { useApp } from '@/hooks/useApp';

export default function Surplus FlipEntryRoute() {
  const { setActiveNiche, activeNicheId } = useApp();

  useEffect(() => {
    // Always enforce the surplus_flip niche when this entry route is loaded
    if (activeNicheId !== 'surplus_flip') {
      setActiveNiche('surplus_flip');
    }
  }, []);

  return <Redirect href="/(tabs)" />;
}
