import { Redirect } from 'expo-router';
import { useNicheEntry } from '@/hooks/useNicheEntry';
export default function CardsEntryRoute() { useNicheEntry('trading_cards'); return <Redirect href="/(tabs)" />; }
