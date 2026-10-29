// SWISH Entry Route — Cards
// Enforce this subscriber's niche and open the shared SWISH app shell.

import { useEffect } from 'react';
import { Redirect } from 'expo-router';
import { useApp } from '@/hooks/useApp';

export default function CardsEntryRoute() {
  const { setActiveNiche, activeNicheId } = useApp();
  useEffect(() => {
    if (activeNicheId !== 'trading_cards') setActiveNiche('trading_cards');
  }, []);
  return <Redirect href="/(tabs)" />;
}
