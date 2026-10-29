// SWISH Entry Route — Beauty
// Enforce this subscriber's niche and open the shared SWISH app shell.

import { useEffect } from 'react';
import { Redirect } from 'expo-router';
import { useApp } from '@/hooks/useApp';

export default function BeautyEntryRoute() {
  const { setActiveNiche, activeNicheId } = useApp();
  useEffect(() => {
    if (activeNicheId !== 'beauty') setActiveNiche('beauty');
  }, []);
  return <Redirect href="/(tabs)" />;
}
