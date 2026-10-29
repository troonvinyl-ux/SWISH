// SWISH Entry Route — Antiques
// Enforce this subscriber's niche and open the shared SWISH app shell.

import { useEffect } from 'react';
import { Redirect } from 'expo-router';
import { useApp } from '@/hooks/useApp';

export default function AntiquesEntryRoute() {
  const { setActiveNiche, activeNicheId } = useApp();
  useEffect(() => {
    if (activeNicheId !== 'antiques') setActiveNiche('antiques');
  }, []);
  return <Redirect href="/(tabs)" />;
}
