// Legacy item-ID entry retained as a preparation adapter, never a second editing form.
import { useEffect } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { usePreparedListing } from '@/hooks/usePreparedListing';
import { useApp } from '@/hooks/useApp';
import { Colors, Spacing, Radius, Typography } from '@/constants/theme';
export default function CreateListingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const flow = usePreparedListing(typeof id === 'string' ? id : ''), router = useRouter();
  const { activeNiche } = useApp(), { state } = flow;
  useEffect(() => {
    if (state.listingId) router.replace({ pathname: '/ebay-listing-editor', params: { id: state.listingId } } as any);
  }, [state.listingId, router]);
  return <SafeAreaView edges={['top', 'bottom']} style={styles.screen}><StatusBar style="light" />
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Back to inventory" onPress={() => router.back()} style={({ pressed }) => [styles.back, pressed ? styles.pressed : null]}><MaterialIcons name="arrow-back" size={24} color={activeNiche.color} /></Pressable><Text style={styles.title}>{activeNiche.shortName} · Listing</Text></View>
    <View style={styles.content}>
      {state.busy || state.listingId ? <><ActivityIndicator color={activeNiche.color} /><Text accessibilityLiveRegion="polite" style={styles.body}>{state.listingId ? 'Opening the shared listing editor…' : 'Preparing this saved item for the shared listing editor…'}</Text></> : null}
      {state.error ? <View style={styles.error}><MaterialIcons name="error-outline" size={24} color={Colors.warning} /><Text accessibilityRole="alert" style={styles.errorText}>{state.error}</Text></View> : null}
      {!state.busy && !state.listingId ? <Pressable accessibilityRole="button" onPress={flow.retry} style={({ pressed }) => [styles.retry, pressed ? styles.pressed : null]}><Text style={styles.body}>Retry preparation</Text></Pressable> : null}
      <Text style={styles.note}>Title, description, photos and eBay details use the same editor in every niche. Nothing is published during preparation.</Text>
    </View>
  </SafeAreaView>;
}
const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: Colors.background }, header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.base }, back: { minHeight: 48, minWidth: 48, borderRadius: Radius.md, backgroundColor: Colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center' }, title: { flex: 1, color: Colors.textPrimary, fontSize: Typography.size.lg, fontWeight: Typography.weight.bold }, content: { padding: Spacing.base, gap: Spacing.base, width: '100%', maxWidth: 960, alignSelf: 'center' }, body: { color: Colors.textPrimary, fontSize: Typography.size.base, lineHeight: 26 }, note: { color: Colors.textSecondary, fontSize: Typography.size.base, lineHeight: 26 }, error: { flexDirection: 'row', gap: Spacing.sm, padding: Spacing.base, backgroundColor: Colors.warningDim, borderRadius: Radius.md }, errorText: { flex: 1, color: Colors.warning, fontSize: Typography.size.base, lineHeight: 26 }, retry: { minHeight: 48, alignItems: 'center', justifyContent: 'center', padding: Spacing.sm, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.surfaceBorder, backgroundColor: Colors.surface }, pressed: { opacity: 0.65 } });
