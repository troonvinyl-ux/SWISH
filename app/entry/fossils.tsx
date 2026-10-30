import { Redirect } from 'expo-router';
import { useNicheEntry } from '@/hooks/useNicheEntry';
export default function FossilsEntryRoute() { useNicheEntry('fossils'); return <Redirect href="/(tabs)" />; }
