import { Redirect } from 'expo-router';
import { useNicheEntry } from '@/hooks/useNicheEntry';
export default function TechEntryRoute() { useNicheEntry('tech'); return <Redirect href="/(tabs)" />; }
