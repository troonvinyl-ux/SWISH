import { memo, useCallback } from 'react';
import { preferredStudioImage } from '@/shared/smartStudio';
import { View, Text, FlatList, Pressable, Modal, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import type { ProductionNicheId } from '@/constants/niches';
import { getNicheHeaderArtwork } from '@/constants/nicheHeaderArtwork';
import { Colors, Spacing, Radius, Typography, Shadow } from '@/constants/theme';
import { useNicheDashboard } from '@/hooks/useNicheDashboard';
import type { NicheDashboardAction } from '@/services/nicheDashboardService';

interface SharedNicheDashboardProps { nicheId: ProductionNicheId; embedded?: boolean }

/** Collectibles' stage layout, with isolated data, photography, copy and specialist actions. */
export const SharedNicheDashboard = memo(function SharedNicheDashboard({ nicheId, embedded = false }: SharedNicheDashboardProps) {
  const dashboard = useNicheDashboard(nicheId);
  const { content, columns } = dashboard;
  const artwork = getNicheHeaderArtwork(nicheId);
  const numbersUnavailable = !dashboard.ready || dashboard.loading || Boolean(dashboard.error);
  const identifyAction = content.actions.find(action => action.id === 'identify');
  const selectTitle = dashboard.purpose === 'listing' ? 'Choose stock for a listing' : dashboard.purpose === 'condition' ? 'Choose stock to assess' : 'Choose stock to value';

  const renderAction = useCallback(({ item }: { item: NicheDashboardAction }) => (
    <Pressable accessibilityRole="button" accessibilityLabel={item.title}
      testID={`${nicheId}-action-${item.id}`} disabled={!dashboard.ready}
      onPress={() => dashboard.open(item)}
      style={({ pressed }) => [s.tile, { borderColor: content.border, maxWidth: dashboard.tileWidth }, pressed ? s.pressed : null, !dashboard.ready ? s.disabled : null]}>
      <View style={[s.icon, { backgroundColor: content.accent + '18' }]}>
        <MaterialIcons name={item.icon as any} size={32} color={content.accent} />
      </View>
      <Text style={[s.tileTitle, s.actionTitle]}>{item.title}</Text>
      <Text style={s.detail}>{item.detail}</Text>
    </Pressable>
  ), [content.accent, content.border, dashboard.ready, dashboard.open, dashboard.tileWidth, nicheId]);

  return (
    <SafeAreaView edges={embedded ? [] : ['top']} style={s.screen} testID={`module-dashboard-${nicheId}`}>
      <StatusBar style={embedded ? 'dark' : 'light'} />
      <FlatList key={`${nicheId}:${columns}`} data={content.actions} numColumns={columns}
        keyExtractor={action => action.id} renderItem={renderAction}
        showsVerticalScrollIndicator={false} refreshing={dashboard.loading} onRefresh={dashboard.reload}
        contentContainerStyle={s.content} columnWrapperStyle={s.columns}
        ListHeaderComponent={
          <View style={s.block}>
            <View style={s.header}>
              <MaterialIcons name={content.icon as any} size={32} color={content.accent} />
              <View style={s.copy}>
                <Text style={[s.eyebrow, { color: content.accent }]}>SWISH / SPECIALIST WORKSPACE</Text>
                <Text style={s.title}>{content.name.toUpperCase()}</Text>
              </View>
            </View>
            <View style={[s.banner, { height: dashboard.bannerHeight, borderColor: content.border }]}>
              {artwork ? <Image source={artwork} contentFit="cover" contentPosition="center" transition={200}
                accessibilityLabel={`${content.name} header artwork`} style={StyleSheet.absoluteFill} /> : null}
              <LinearGradient colors={[Colors.overlay20, Colors.overlay20, Colors.overlay80]} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill} />
              <View style={s.bannerCopy}>
                <Text style={s.bannerTitle}>{content.headline}</Text>
                <Text style={s.bannerDetail}>{content.categories}</Text>
              </View>
            </View>
            <View style={s.metrics}>
              <View style={s.stat}><Text style={[s.number, { color: content.accent }]}>{numbersUnavailable ? '—' : dashboard.stats.grandTotal}</Text><Text style={s.body}>Inventory</Text></View>
              <View style={s.stat}><Text style={[s.number, { color: content.accent }]}>{numbersUnavailable ? '—' : dashboard.stats.liveCount}</Text><Text style={s.body}>Live</Text></View>
              <View style={s.stat}><Text style={[s.number, { color: content.accent }]}>{numbersUnavailable ? '—' : dashboard.stats.soldCount}</Text><Text style={s.body}>Sold</Text></View>
            </View>
            {dashboard.error ? <View style={s.errorPanel}>
              <MaterialIcons name="error-outline" size={24} color={Colors.danger} />
              <View style={s.copy}><Text accessibilityRole="alert" style={s.error}>{dashboard.error}</Text>
                <Pressable onPress={dashboard.reload} disabled={dashboard.loading} accessibilityRole="button" accessibilityState={{ disabled: dashboard.loading, busy: dashboard.loading }} style={({ pressed }) => [s.retry, pressed ? s.pressed : null, dashboard.loading ? s.disabled : null]}><Text style={[s.actionText, { color: content.accent }]}>{dashboard.loading ? 'Refreshing inventory…' : 'Retry inventory refresh'}</Text></Pressable>
              </View>
            </View> : null}
            <Text style={[s.eyebrow, { color: content.accent }]}>{content.motto}</Text>
          </View>
        }
        ListFooterComponent={
          <View style={s.info}>
            <MaterialIcons name="verified-user" size={24} color={content.accent} />
            <View style={s.copy}><Text style={s.tileTitle}>{content.guidanceTitle}</Text><Text style={s.body}>{content.guidance}</Text></View>
          </View>
        }
      />
      <Modal visible={dashboard.purpose !== null && dashboard.ready} animationType="slide" onRequestClose={dashboard.close} presentationStyle="pageSheet">
        <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
          <View style={s.modalHeader}>
            <View style={s.copy}><Text style={s.title}>{selectTitle}</Text><Text style={s.body}>Only your {content.shortName} inventory is shown.</Text></View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close item selection" onPress={dashboard.close} style={({ pressed }) => [s.close, pressed ? s.pressed : null]}>
              <MaterialIcons name="close" size={24} color={content.accent} />
            </Pressable>
          </View>
          <FlatList data={dashboard.items} keyExtractor={item => item.id} contentContainerStyle={s.content}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
              <Pressable accessibilityRole="button" accessibilityLabel={`Select ${item.canonicalTitle}`}
                onPress={() => dashboard.select(item.id)} style={({ pressed }) => [s.item, pressed ? s.pressed : null]}>
                {preferredStudioImage(item.media,item.attributes) ? <Image source={{ uri: preferredStudioImage(item.media,item.attributes) }} contentFit="cover" transition={200} style={s.thumbnail} /> :
                  <View style={[s.thumbnail, s.icon]}><MaterialIcons name={content.icon as any} size={24} color={content.accent} /></View>}
                <View style={s.copy}><Text style={s.tileTitle}>{item.canonicalTitle}</Text><Text style={s.body}>{item.condition || 'Unassessed'} · {item.status}</Text></View>
                <MaterialIcons name="chevron-right" size={24} color={content.accent} />
              </Pressable>
            )}
            ListEmptyComponent={
              <View style={s.empty}>
                {dashboard.loading ? <ActivityIndicator color={content.accent} /> : <>
                  <Text style={s.body}>{dashboard.error ?? `Capture and save your first ${content.shortName.toLowerCase()} item, then prepare its listing or research its value.`}</Text>
                  {dashboard.error ? <Pressable onPress={dashboard.reload} style={({ pressed }) => [s.retry, pressed ? s.pressed : null]}><Text style={[s.actionText, { color: content.accent }]}>Retry loading stock</Text></Pressable> : identifyAction ?
                    <Pressable accessibilityRole="button" onPress={() => { dashboard.close(); dashboard.open(identifyAction); }} style={({ pressed }) => [s.primary, { backgroundColor: content.accent }, pressed ? s.pressed : null]}><Text style={s.primaryText}>{identifyAction.title}</Text></Pressable> : null}
                </>}
              </View>
            }
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
});

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.base, gap: Spacing.base, maxWidth: 960, width: '100%', alignSelf: 'center', paddingBottom: Spacing.xxl },
  block: { gap: Spacing.base, marginBottom: Spacing.base },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  copy: { flex: 1, gap: Spacing.xs },
  title: { fontSize: Typography.size.lg, fontWeight: Typography.weight.bold, color: Colors.textPrimary, includeFontPadding: false },
  eyebrow: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, letterSpacing: 1, includeFontPadding: false },
  banner: { borderWidth: 1, borderRadius: Radius.xl, overflow: 'hidden', justifyContent: 'flex-end', backgroundColor: Colors.surface, ...Shadow.md },
  bannerCopy: { padding: Spacing.base, gap: Spacing.sm },
  bannerTitle: { fontSize: Typography.size.xl, lineHeight: Typography.size.xl * Typography.lineHeight.tight, fontWeight: Typography.weight.bold, color: Colors.textPrimary, includeFontPadding: false },
  bannerDetail: { fontSize: Typography.size.base, lineHeight: Typography.size.base * Typography.lineHeight.relaxed, color: Colors.textPrimary, includeFontPadding: false },
  body: { fontSize: Typography.size.base, lineHeight: Typography.size.base * Typography.lineHeight.relaxed, color: Colors.textSecondary, includeFontPadding: false },
  columns: { gap: Spacing.base },
  tile: { flex: 1, minHeight: 176, borderWidth: 1, borderRadius: Radius.lg, backgroundColor: Colors.surface, padding: Spacing.base, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  icon: { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceHighlight, padding: Spacing.md, borderRadius: Radius.md },
  tileTitle: { fontSize: Typography.size.base, lineHeight: Typography.size.base * Typography.lineHeight.normal, fontWeight: Typography.weight.semibold, color: Colors.textPrimary, includeFontPadding: false, flexShrink: 1 },
  actionTitle: { textAlign: 'center' },
  detail: { fontSize: Typography.size.base, color: Colors.textSecondary, lineHeight: Typography.size.base * Typography.lineHeight.relaxed, textAlign: 'center', includeFontPadding: false },
  metrics: { flexDirection: 'row', borderRadius: Radius.lg, padding: Spacing.base, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder },
  stat: { flex: 1, alignItems: 'center', gap: Spacing.xs },
  number: { fontSize: Typography.size.xxl, fontWeight: Typography.weight.bold, fontVariant: ['tabular-nums'], includeFontPadding: false },
  info: { flexDirection: 'row', padding: Spacing.base, gap: Spacing.md, backgroundColor: Colors.surface, borderRadius: Radius.lg, marginTop: Spacing.base },
  errorPanel: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.dangerDim, padding: Spacing.base, borderRadius: Radius.lg },
  error: { color: Colors.danger, fontSize: Typography.size.base, lineHeight: Typography.size.base * Typography.lineHeight.relaxed },
  retry: { minHeight: 48, paddingVertical: Spacing.md, justifyContent: 'center' },
  actionText: { fontSize: Typography.size.base, fontWeight: Typography.weight.semibold },
  modalHeader: { flexDirection: 'row', padding: Spacing.base, gap: Spacing.base },
  close: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.md, backgroundColor: Colors.surface },
  item: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, backgroundColor: Colors.surface, borderRadius: Radius.lg, minHeight: 80 },
  thumbnail: { width: 64, height: 64, borderRadius: Radius.md },
  empty: { gap: Spacing.base, paddingVertical: Spacing.base },
  primary: { minHeight: 48, padding: Spacing.base, borderRadius: Radius.md, alignItems: 'center' },
  primaryText: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: Colors.textInverse },
  pressed: { opacity: 0.75, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.6 },
});
