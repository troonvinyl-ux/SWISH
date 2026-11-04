import { Redirect } from 'expo-router';
import { useNicheEntry } from '@/hooks/useNicheEntry';
export default function CollectiblesEntryRoute() { useNicheEntry('collectibles'); return <Redirect href="/(tabs)" />; }
