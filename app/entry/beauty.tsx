import { Redirect } from 'expo-router';
import { useNicheEntry } from '@/hooks/useNicheEntry';
export default function BeautyEntryRoute() { useNicheEntry('beauty'); return <Redirect href="/(tabs)" />; }
