// SWISH Entry Route — Fossils
// Enforce this subscriber's niche and open the shared SWISH app shell.

import { useEffect } from 'react';
import { Redirect } from 'expo-router';
import { useApp } from '@/hooks/useApp';

export default function FossilsEntryRoute() {
  const { setActiveNiche, activeNicheId } = useApp();
  useEffect(() => {
    if (activeNicheId !== 'fossils') setActiveNiche('fossils');
  }, []);
  return <Redirect href="/(tabs)" />;
}
