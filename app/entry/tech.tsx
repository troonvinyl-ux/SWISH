// SWISH Entry Route — Tech
// Enforce this subscriber's niche and open the shared SWISH app shell.

import { useEffect } from 'react';
import { Redirect } from 'expo-router';
import { useApp } from '@/hooks/useApp';

export default function TechEntryRoute() {
  const { setActiveNiche, activeNicheId } = useApp();
  useEffect(() => {
    if (activeNicheId !== 'tech') setActiveNiche('tech');
  }, []);
  return <Redirect href="/(tabs)" />;
}
