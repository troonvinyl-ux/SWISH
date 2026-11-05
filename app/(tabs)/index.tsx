// One Collectibles-style home template; build identity wins over persisted account state.
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Redirect } from 'expo-router';
import { useApp } from '@/hooks/useApp';
import { Colors } from '@/constants/theme';
import { resolveProductionNiche } from '@/services/nicheRouting';
import { ModuleHome } from '@/components/feature/ModuleHome';

export default function NicheHomeScreen() {
  const { activeNicheId, fixedNicheId, tenant, tenantLoading } = useApp();
  const effectiveNicheId = fixedNicheId ?? activeNicheId;
  const product = resolveProductionNiche(effectiveNicheId);
  if (tenantLoading && !tenant) return <View style={s.loading}><ActivityIndicator size="large" color={Colors.primary} /></View>;
  if (product) return <ModuleHome key={effectiveNicheId} nicheId={product} />;
  return <Redirect href={"/niche-select" as any} />;
}
const s = StyleSheet.create({ loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background } });
