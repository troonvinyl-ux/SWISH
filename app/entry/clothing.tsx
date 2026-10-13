// SWISH Entry Route — Threads Flip (Clothing niche)
//
// This is the explicit entry point for subscribers registered to the Clothing niche.
// Deep-linking to /entry/clothing sets activeNicheId='clothing' and redirects to /(tabs).
// The niche is persisted to AsyncStorage so returning subscribers always land here.
//
// Route: /entry/clothing

import { useEffect } from 'react';
import { Redirect } from 'expo-router';
import { useApp } from '@/hooks/useApp';

export default function ClothingEntryRoute() {
  const { setActiveNiche, activeNicheId } = useApp();

  useEffect(() => {
    // Always enforce the clothing niche when this entry route is loaded
    if (activeNicheId !== 'clothing') {
      setActiveNiche('clothing');
    }
  }, []);

  return <Redirect href="/(tabs)" />;
}
