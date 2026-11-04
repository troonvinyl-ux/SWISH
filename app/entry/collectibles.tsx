import { Redirect } from 'expo-router';
import { useNicheEntry } from '@/hooks/useNicheEntry';

/** Canonical Collectibles entry: establish the verified niche scope before opening tabs. */
export default function CollectiblesEntryRoute() {
  useNicheEntry('collectibles');
  return <Redirect href="/(tabs)" />;
}
