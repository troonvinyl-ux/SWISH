// SWISH Entry Route — Bike Flipper (Bicycles niche)
//
// This is the explicit entry point for subscribers registered to the Bicycles niche.
// Deep-linking to /entry/bicycles sets activeNicheId='bicycles' and redirects to /(tabs).
// The niche is persisted to AsyncStorage so returning subscribers always land here.
//
// Route: /entry/bicycles

import { useEffect } from 'react';
import { Redirect } from 'expo-router';
import { useApp } from '@/hooks/useApp';

export default function BicyclesEntryRoute() {
  const { setActiveNiche, activeNicheId } = useApp();

  useEffect(() => {
    // Always enforce the bicycles niche when this entry route is loaded
    if (activeNicheId !== 'bicycles') {
      setActiveNiche('bicycles');
    }
  }, []);

  return <Redirect href="/(tabs)" />;
}
