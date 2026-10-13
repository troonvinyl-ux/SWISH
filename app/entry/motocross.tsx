// SWISH Entry Route — Flipper MX (Motocross niche)
//
// This is the explicit entry point for subscribers registered to the Motocross niche.
// Deep-linking to /entry/motocross sets activeNicheId='motocross' and redirects to /(tabs).
// The niche is persisted to AsyncStorage so returning subscribers always land here.
//
// Route: /entry/motocross

import { useEffect } from 'react';
import { Redirect } from 'expo-router';
import { useApp } from '@/hooks/useApp';

export default function MotocrossEntryRoute() {
  const { setActiveNiche, activeNicheId } = useApp();

  useEffect(() => {
    // Always enforce the motocross niche when this entry route is loaded
    if (activeNicheId !== 'motocross') {
      setActiveNiche('motocross');
    }
  }, []);

  return <Redirect href="/(tabs)" />;
}
