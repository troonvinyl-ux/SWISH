import { Redirect } from 'expo-router';
import { useNicheEntry } from '@/hooks/useNicheEntry';
export default function AntiquesEntryRoute() { useNicheEntry('antiques'); return <Redirect href="/(tabs)" />; }
