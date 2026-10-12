// KEENONCOINS — Daily Tasks & Operations HQ
// The discipline engine. Everything that needs doing today, tomorrow, and this week.
// Routine tasks automatically generated from system state — nothing falls through.

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable,
  ScrollView, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { useAlert } from '@/template';
import { getSupabaseClient } from '@/template';

// ── Task Types ────────────────────────────────────────────────────────────────

type TaskCategory =
  | 'dispatch'
  | 'listing'
  | 'inventory'
  | 'financial'
  | 'acquisition'
  | 'review'
  | 'reprice';

type TaskPriority = 'urgent' | 'high' | 'normal' | 'low';

interface Task {
  id: string;
  category: TaskCategory;
  priority: TaskPriority;
  title: string;
  description: string;
  count?: number;
  value?: number;
  actionLabel: string;
  actionRoute?: string;
  canAutoComplete?: boolean;
  completed?: boolean;
  dueDate?: string;
}

const CATEGORY_CONFIG: Record<TaskCategory, {
  icon: string;
  color: string;
  label: string;
}> = {
  dispatch:    { icon: 'local-shipping',     color: Colors.warning,  label: 'Dispatch' },
  listing:     { icon: 'receipt-long',        color: Colors.info,     label: 'Listings' },
  inventory:   { icon: 'toll',               color: Colors.primary,  label: 'Inventory' },
  financial:   { icon: 'payments',           color: Colors.gold,     label: 'Financial' },
  acquisition: { icon: 'inventory-2',        color: Colors.accent,   label: 'Acquisitions' },
  review:      { icon: 'rate-review',        color: Colors.danger,   label: 'Review' },
  reprice:     { icon: 'price-change',       color: Colors.success,  label: 'Repricing' },
};

const PRIORITY_CONFIG: Record<TaskPriority, {
  color: string;
  label: string;
  badgeColor: string;
}> = {
  urgent: { color: Colors.danger,  label: 'Urgent',  badgeColor: Colors.danger  },
  high:   { color: Colors.warning, label: 'Today',   badgeColor: Colors.warning },
  normal: { color: Colors.info,    label: 'Soon',    badgeColor: Colors.info    },
  low:    { color: Colors.textTertiary, label: 'When ready', badgeColor: Colors.textTertiary },
};

// ── Task Card ─────────────────────────────────────────────────────────────────

function TaskCard({
  task,
  onAction,
  onComplete,
}: {
  task: Task;
  onAction: (task: Task) => void;
  onComplete: (taskId: string) => void;
}) {
  const cat = CATEGORY_CONFIG[task.category];
  const pri = PRIORITY_CONFIG[task.priority];

  return (
    <Pressable
      onPress={() => onAction(task)}
      style={({ pressed }) => [
        tc.card,
        task.completed && tc.cardCompleted,
        pressed && { opacity: 0.9 },
      ]}
    >
      {/* Left priority stripe */}
      <View style={[tc.stripe, { backgroundColor: pri.color }]} />

      <View style={tc.body}>
        {/* Icon + Category */}
        <View style={tc.topRow}>
          <View style={[tc.iconWrap, { backgroundColor: cat.color + '20' }]}>
            <MaterialIcons name={cat.icon as any} size={18} color={cat.color} />
          </View>
          <View style={tc.meta}>
            <View style={tc.metaRow}>
              <Text style={[tc.categoryLabel, { color: cat.color }]}>{cat.label}</Text>
              <View style={[tc.priorityBadge, { backgroundColor: pri.badgeColor + '20' }]}>
                <View style={[tc.priorityDot, { backgroundColor: pri.badgeColor }]} />
                <Text style={[tc.priorityText, { color: pri.badgeColor }]}>{pri.label}</Text>
              </View>
              {task.count ? (
                <View style={tc.countBadge}>
                  <Text style={tc.countText}>{task.count}</Text>
                </View>
              ) : null}
            </View>
            <Text style={[tc.title, task.completed && tc.titleCompleted]}>{task.title}</Text>
            <Text style={tc.desc} numberOfLines={2}>{task.description}</Text>
          </View>
        </View>

        {/* Value + Action */}
        <View style={tc.actionRow}>
          {task.value !== undefined ? (
            <Text style={[tc.value, { color: task.value >= 0 ? Colors.success : Colors.danger }]}>
              {task.value >= 0 ? '+' : ''}£{Math.abs(task.value).toFixed(0)}
            </Text>
          ) : null}
          <View style={tc.spacer} />
          {task.completed ? (
            <View style={tc.doneChip}>
              <MaterialIcons name="check-circle" size={13} color={Colors.success} />
              <Text style={tc.doneText}>Done</Text>
            </View>
          ) : (
            <Pressable
              onPress={() => onAction(task)}
              style={({ pressed }) => [tc.actionBtn, { borderColor: cat.color + '60', backgroundColor: cat.color + '15' }, pressed && { opacity: 0.8 }]}
            >
              <Text style={[tc.actionBtnText, { color: cat.color }]}>{task.actionLabel}</Text>
              <MaterialIcons name="arrow-forward" size={12} color={cat.color} />
            </Pressable>
          )}
        </View>
      </View>
    </Pressable>
  );
}

const tc = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    ...Shadow.sm,
  },
  cardCompleted: { opacity: 0.55 },
  stripe: { width: 4, flexShrink: 0 },
  body: { flex: 1, padding: Spacing.md, gap: Spacing.sm },
  topRow: { flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start' },
  iconWrap: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  meta: { flex: 1, gap: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  categoryLabel: { fontSize: 9, fontWeight: Typography.weight.bold, textTransform: 'uppercase', letterSpacing: 0.5 },
  priorityBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: Radius.pill },
  priorityDot: { width: 5, height: 5, borderRadius: 3 },
  priorityText: { fontSize: 9, fontWeight: Typography.weight.semibold },
  countBadge: {
    minWidth: 20, height: 20, borderRadius: 10,
    backgroundColor: Colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5,
  },
  countText: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.textSecondary },
  title: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary, lineHeight: 18 },
  titleCompleted: { textDecorationLine: 'line-through', color: Colors.textTertiary },
  desc: { fontSize: Typography.size.xs, color: Colors.textTertiary, lineHeight: 16 },
  actionRow: { flexDirection: 'row', alignItems: 'center' },
  value: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold },
  spacer: { flex: 1 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: Spacing.md, paddingVertical: 6,
    borderRadius: Radius.md, borderWidth: 1,
  },
  actionBtnText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold },
  doneChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.successDim, borderRadius: Radius.pill, paddingHorizontal: Spacing.sm, paddingVertical: 4 },
  doneText: { fontSize: Typography.size.xs, color: Colors.success, fontWeight: Typography.weight.medium },
});

// ── Category filter bar ───────────────────────────────────────────────────────

type FilterTab = 'all' | TaskCategory;

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function TasksScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tenant } = useApp();
  const { showAlert } = useAlert();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
  const [completed, setCompleted] = useState<Set<string>>(new Set());

  // ── Load tasks from live system state ─────────────────────────────────────

  const load = useCallback(async () => {
    if (!tenant) return;
    const supabase = getSupabaseClient();

    try {
      // Parallel fetch of all state needed to generate task list
      const [
        ordersRes,
        itemsRes,
        listingsRes,
        reviewItemsRes,
        endedListingsRes,
      ] = await Promise.all([
        // Orders awaiting dispatch
        supabase.from('orders')
          .select('id, fulfilment_status, sale_price, buyer_name, created_at')
          .eq('tenant_id', tenant.id)
          .in('fulfilment_status', ['awaiting_dispatch', 'packing', 'label_created'])
          .order('created_at', { ascending: true }),

        // Items with no listing (available to list)
        supabase.from('items')
          .select('id, canonical_title, valuation_mid, created_at, status')
          .eq('tenant_id', tenant.id)
          .in('status', ['identified', 'priced', 'new', 'captured'])
          .order('valuation_mid', { ascending: false })
          .limit(50),

        // Draft listings not yet submitted
        supabase.from('listings')
          .select('id, title, price, created_at, marketplace_id')
          .eq('tenant_id', tenant.id)
          .eq('status', 'draft')
          .order('created_at', { ascending: true })
          .limit(50),

        // Items needing review
        supabase.from('items')
          .select('id, canonical_title, valuation_mid')
          .eq('tenant_id', tenant.id)
          .eq('status', 'review_required')
          .limit(20),

        // Ended listings that could be relisted
        supabase.from('listings')
          .select('id, title, price, ended_at')
          .eq('tenant_id', tenant.id)
          .eq('status', 'ended')
          .order('ended_at', { ascending: false })
          .limit(20),
      ]);

      const generatedTasks: Task[] = [];

      // ── DISPATCH TASKS ────────────────────────────────────────────────────

      const awaitingDispatch = (ordersRes.data ?? []).filter(o => o.fulfilment_status === 'awaiting_dispatch');
      const packing = (ordersRes.data ?? []).filter(o => o.fulfilment_status === 'packing');
      const labelReady = (ordersRes.data ?? []).filter(o => o.fulfilment_status === 'label_created');
      const totalDispatch = ordersRes.data?.length ?? 0;

      if (awaitingDispatch.length > 0) {
        const totalValue = awaitingDispatch.reduce((s, o) => s + Number(o.sale_price ?? 0), 0);
        generatedTasks.push({
          id: 'dispatch_pick',
          category: 'dispatch',
          priority: awaitingDispatch.length >= 3 ? 'urgent' : 'high',
          title: `${awaitingDispatch.length} order${awaitingDispatch.length === 1 ? '' : 's'} waiting to be picked`,
          description: `Items need picking from storage. The sooner they ship, the better your seller metrics and feedback.`,
          count: awaitingDispatch.length,
          value: totalValue,
          actionLabel: 'Go to Dispatch',
          actionRoute: '/dispatch',
        });
      }

      if (packing.length > 0) {
        generatedTasks.push({
          id: 'dispatch_pack',
          category: 'dispatch',
          priority: 'high',
          title: `${packing.length} order${packing.length === 1 ? '' : 's'} being packed`,
          description: 'Continue packing — seal, weigh, and prepare labels for these orders.',
          count: packing.length,
          actionLabel: 'Continue',
          actionRoute: '/dispatch',
        });
      }

      if (labelReady.length > 0) {
        generatedTasks.push({
          id: 'dispatch_label',
          category: 'dispatch',
          priority: 'urgent',
          title: `${labelReady.length} label${labelReady.length === 1 ? '' : 's'} ready to print`,
          description: 'Labels created — print and stick, then mark as dispatched to update buyer tracking.',
          count: labelReady.length,
          actionLabel: 'Print & Dispatch',
          actionRoute: '/dispatch',
        });
      }

      // ── REVIEW TASKS ──────────────────────────────────────────────────────

      const reviewItems = reviewItemsRes.data ?? [];
      if (reviewItems.length > 0) {
        const highValueReviews = reviewItems.filter(i => Number(i.valuation_mid) >= 50);
        generatedTasks.push({
          id: 'review_items',
          category: 'review',
          priority: highValueReviews.length > 0 ? 'urgent' : 'high',
          title: `${reviewItems.length} item${reviewItems.length === 1 ? '' : 's'} need human review`,
          description: highValueReviews.length > 0
            ? `${highValueReviews.length} high-value item${highValueReviews.length === 1 ? '' : 's'} waiting — AI confidence was too low to auto-approve.`
            : 'AI identification confidence was below threshold. Quick human check needed before listing.',
          count: reviewItems.length,
          value: reviewItems.reduce((s, i) => s + Number(i.valuation_mid ?? 0), 0),
          actionLabel: 'Review Now',
          actionRoute: '/(tabs)/inventory',
        });
      }

      // ── LISTING TASKS ─────────────────────────────────────────────────────

      const unlisted = itemsRes.data ?? [];
      if (unlisted.length > 0) {
        const highValueUnlisted = unlisted.filter(i => Number(i.valuation_mid) >= 20);
        const totalUnlistedValue = unlisted.reduce((s, i) => s + Number(i.valuation_mid ?? 0), 0);

        generatedTasks.push({
          id: 'list_items',
          category: 'listing',
          priority: highValueUnlisted.length > 0 ? 'high' : 'normal',
          title: `${unlisted.length} item${unlisted.length === 1 ? '' : 's'} ready to list`,
          description: `Identified stock sitting unlisted = dead capital. Generate and submit listings to start earning.${highValueUnlisted.length > 0 ? ` ${highValueUnlisted.length} high-value items in this batch.` : ''}`,
          count: unlisted.length,
          value: totalUnlistedValue,
          actionLabel: 'List Items',
          actionRoute: '/(tabs)/inventory',
        });
      }

      const draftListings = listingsRes.data ?? [];
      if (draftListings.length > 0) {
        const totalDraftValue = draftListings.reduce((s, l) => s + Number(l.price ?? 0), 0);
        generatedTasks.push({
          id: 'submit_drafts',
          category: 'listing',
          priority: draftListings.length >= 5 ? 'high' : 'normal',
          title: `${draftListings.length} draft listing${draftListings.length === 1 ? '' : 's'} ready to submit`,
          description: `Listings generated but not yet live. Submit to eBay to start the clock — every day listed = another chance to sell.`,
          count: draftListings.length,
          value: totalDraftValue,
          actionLabel: 'Submit All',
          actionRoute: '/(tabs)/listings',
        });
      }

      // ── RELIST TASKS ──────────────────────────────────────────────────────

      const endedListings = endedListingsRes.data ?? [];
      if (endedListings.length > 0) {
        const recentlyEnded = endedListings.filter(l => {
          if (!l.ended_at) return true;
          const days = (Date.now() - new Date(l.ended_at).getTime()) / (1000 * 86400);
          return days <= 14; // Ended in last 2 weeks
        });

        if (recentlyEnded.length > 0) {
          generatedTasks.push({
            id: 'relist_ended',
            category: 'listing',
            priority: 'normal',
            title: `${recentlyEnded.length} ended listing${recentlyEnded.length === 1 ? '' : 's'} to relist`,
            description: 'Items whose listings ended without selling. Review pricing and relist — stale stock costs you money.',
            count: recentlyEnded.length,
            actionLabel: 'Review Ended',
            actionRoute: '/ebay-admin',
          });
        }
      }

      // ── INVENTORY HEALTH ──────────────────────────────────────────────────

      // Items without photos (can't list effectively)
      const { data: noPhotoItems } = await supabase
        .from('items')
        .select('id')
        .eq('tenant_id', tenant.id)
        .not('status', 'in', '("sold","disposed")')
        .eq('media', '{}')
        .limit(20);

      if ((noPhotoItems ?? []).length > 0) {
        generatedTasks.push({
          id: 'add_photos',
          category: 'inventory',
          priority: 'normal',
          title: `${noPhotoItems!.length} item${noPhotoItems!.length === 1 ? '' : 's'} missing photos`,
          description: 'Items without photos cannot be effectively listed. Good photos = more views = faster sales.',
          count: noPhotoItems!.length,
          actionLabel: 'Add Photos',
          actionRoute: '/(tabs)/inventory',
        });
      }

      // Items without KC IDs
      const { data: noKcItems } = await supabase
        .from('items')
        .select('id')
        .eq('tenant_id', tenant.id)
        .is('inventory_id', null)
        .limit(50);

      if ((noKcItems ?? []).length > 0) {
        generatedTasks.push({
          id: 'assign_kc_ids',
          category: 'inventory',
          priority: 'low',
          title: `${noKcItems!.length} item${noKcItems!.length === 1 ? '' : 's'} without KC IDs`,
          description: 'Assign permanent KC Inventory IDs to track items across marketplaces and through their full lifecycle.',
          count: noKcItems!.length,
          actionLabel: 'View Inventory',
          actionRoute: '/(tabs)/inventory',
        });
      }

      // Items valued over £100 with no catalogue number
      const { data: highValueNoCat } = await supabase
        .from('items')
        .select('id')
        .eq('tenant_id', tenant.id)
        .gte('valuation_mid', 100)
        .or('catalogue_number.is.null,catalogue_number.eq.')
        .not('status', 'in', '("sold","disposed")')
        .limit(10);

      if ((highValueNoCat ?? []).length > 0) {
        generatedTasks.push({
          id: 'catalogue_high_value',
          category: 'inventory',
          priority: 'normal',
          title: `${highValueNoCat!.length} high-value item${highValueNoCat!.length === 1 ? '' : 's'} without catalogue numbers`,
          description: 'Items valued at £100+ benefit from proper catalogue attribution for buyer confidence and accurate pricing.',
          count: highValueNoCat!.length,
          actionLabel: 'Complete Records',
          actionRoute: '/(tabs)/inventory',
        });
      }

      // ── REPRICE TASKS ─────────────────────────────────────────────────────

      // Items listed > 30 days with 0 watchers
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data: staleListings } = await supabase
        .from('listings')
        .select('id, title, price, published_at')
        .eq('tenant_id', tenant.id)
        .eq('status', 'active')
        .eq('watchers', 0)
        .lt('published_at', thirtyDaysAgo)
        .limit(20);

      if ((staleListings ?? []).length > 0) {
        generatedTasks.push({
          id: 'reprice_stale',
          category: 'reprice',
          priority: 'normal',
          title: `${staleListings!.length} listing${staleListings!.length === 1 ? '' : 's'} stale — no views in 30+ days`,
          description: 'Zero watchers after 30 days usually means overpriced. A 5-10% reduction often unsticks slow movers.',
          count: staleListings!.length,
          actionLabel: 'Review Pricing',
          actionRoute: '/repricing',
        });
      }

      // ── FINANCIAL TASKS ───────────────────────────────────────────────────

      // Completed orders not yet reconciled
      const { data: unreconciledOrders } = await supabase
        .from('orders')
        .select('id, sale_price, net_revenue')
        .eq('tenant_id', tenant.id)
        .eq('fulfilment_status', 'delivered')
        .limit(10);

      if ((unreconciledOrders ?? []).length > 0) {
        const totalValue = (unreconciledOrders ?? []).reduce((s, o) => s + Number(o.net_revenue ?? 0), 0);
        generatedTasks.push({
          id: 'reconcile_orders',
          category: 'financial',
          priority: 'low',
          title: `${unreconciledOrders!.length} delivered order${unreconciledOrders!.length === 1 ? '' : 's'} to mark complete`,
          description: 'Mark delivered orders as completed to lock in profit figures and update your P&L tracking.',
          count: unreconciledOrders!.length,
          value: totalValue,
          actionLabel: 'Update Orders',
          actionRoute: '/orders',
        });
      }

      // Sort by priority
      const priorityOrder: Record<TaskPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
      generatedTasks.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

      setTasks(generatedTasks);
    } catch (e: any) {
      console.error('Tasks load error:', e.message);
    }

    setLoading(false);
    setRefreshing(false);
  }, [tenant?.id]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
  }, [load]);

  // ── Filtered tasks ─────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const withCompleted = tasks.map(t => ({ ...t, completed: completed.has(t.id) }));
    if (activeFilter === 'all') return withCompleted;
    return withCompleted.filter(t => t.category === activeFilter);
  }, [tasks, activeFilter, completed]);

  // ── Stats ──────────────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const urgent = tasks.filter(t => t.priority === 'urgent').length;
    const today = tasks.filter(t => t.priority === 'high').length;
    const total = tasks.length;
    const totalPotentialValue = tasks
      .filter(t => t.value !== undefined)
      .reduce((s, t) => s + (t.value ?? 0), 0);
    return { urgent, today, total, totalPotentialValue };
  }, [tasks]);

  // ── Category counts for filter bar ────────────────────────────────────────

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: tasks.length };
    for (const t of tasks) {
      counts[t.category] = (counts[t.category] ?? 0) + 1;
    }
    return counts;
  }, [tasks]);

  // ── Action handler ─────────────────────────────────────────────────────────

  const handleAction = useCallback((task: Task) => {
    if (task.actionRoute) {
      router.push(task.actionRoute as any);
    }
  }, [router]);

  const handleComplete = useCallback((taskId: string) => {
    setCompleted(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  const pendingCount = tasks.filter(t => !completed.has(t.id)).length;

  const FILTER_TABS: Array<{ id: FilterTab; label: string; icon: string }> = [
    { id: 'all',         label: 'All',         icon: 'list' },
    { id: 'dispatch',    label: 'Dispatch',    icon: 'local-shipping' },
    { id: 'listing',     label: 'Listings',    icon: 'receipt-long' },
    { id: 'inventory',   label: 'Inventory',   icon: 'toll' },
    { id: 'review',      label: 'Review',      icon: 'rate-review' },
    { id: 'reprice',     label: 'Reprice',     icon: 'price-change' },
    { id: 'financial',   label: 'Financial',   icon: 'payments' },
  ];

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + Spacing.base }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={20} color={Colors.textSecondary} />
        </Pressable>
        <View style={s.flex}>
          <View style={s.titleRow}>
            <Text style={s.title}>Daily Tasks</Text>
            {pendingCount > 0 ? (
              <View style={s.pendingBadge}>
                <Text style={s.pendingBadgeText}>{pendingCount}</Text>
              </View>
            ) : null}
          </View>
          <Text style={s.subtitle}>
            {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
          </Text>
        </View>
        <Pressable onPress={() => load()} hitSlop={8} style={s.refreshBtn}>
          <MaterialIcons name="refresh" size={18} color={Colors.textSecondary} />
        </Pressable>
      </View>

      {/* Summary strip */}
      {!loading && tasks.length > 0 ? (
        <View style={s.summaryStrip}>
          {[
            { label: 'Urgent',     value: stats.urgent, color: Colors.danger,       icon: 'priority-high' },
            { label: 'Today',      value: stats.today,  color: Colors.warning,      icon: 'today' },
            { label: 'Total',      value: stats.total,  color: Colors.textSecondary, icon: 'checklist' },
            {
              label: 'Potential',
              value: `£${stats.totalPotentialValue >= 1000 ? (stats.totalPotentialValue / 1000).toFixed(1) + 'k' : stats.totalPotentialValue.toFixed(0)}`,
              color: Colors.gold,
              icon: 'payments',
              isText: true,
            },
          ].map(stat => (
            <View key={stat.label} style={s.summaryItem}>
              <MaterialIcons name={stat.icon as any} size={14} color={stat.color} />
              <Text style={[s.summaryValue, { color: stat.color }]}>
                {stat.isText ? String(stat.value) : String(stat.value)}
              </Text>
              <Text style={s.summaryLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* Filter tabs */}
      <View style={s.tabsOuter}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.tabsContent}
        >
          {FILTER_TABS.map(tab => {
            const active = activeFilter === tab.id;
            const count = categoryCounts[tab.id] ?? 0;
            const catConfig = tab.id !== 'all' ? CATEGORY_CONFIG[tab.id as TaskCategory] : null;
            const color = catConfig?.color ?? Colors.primary;
            if (tab.id !== 'all' && count === 0) return null;
            return (
              <Pressable
                key={tab.id}
                onPress={() => setActiveFilter(tab.id)}
                style={[s.tab, active && s.tabActive]}
              >
                <MaterialIcons
                  name={tab.icon as any}
                  size={13}
                  color={active ? color : Colors.textTertiary}
                />
                <Text style={[s.tabLabel, active && { color }]}>{tab.label}</Text>
                {count > 0 ? (
                  <View style={[s.tabCount, active && { backgroundColor: color + '20' }]}>
                    <Text style={[s.tabCountText, active && { color }]}>{count}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {loading ? (
        <View style={s.loading}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={s.loadingText}>Scanning your business for tasks...</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={t => t.id}
          contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 100 }]}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
          }
          renderItem={({ item: task }) => (
            <TaskCard
              task={task}
              onAction={handleAction}
              onComplete={handleComplete}
            />
          )}
          ListEmptyComponent={
            <View style={s.empty}>
              <View style={s.emptyIconWrap}>
                <MaterialIcons name="check-circle" size={52} color={Colors.success} />
              </View>
              <Text style={s.emptyTitle}>
                {activeFilter === 'all' ? 'All Clear' : `No ${activeFilter} tasks`}
              </Text>
              <Text style={s.emptyText}>
                {activeFilter === 'all'
                  ? 'No outstanding tasks. Dispatch is clear, listings are live, inventory is healthy.'
                  : `No ${activeFilter} tasks right now.`}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.base, paddingBottom: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: Radius.md,
    backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  refreshBtn: {
    width: 36, height: 36, borderRadius: Radius.md,
    backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  title: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  pendingBadge: {
    minWidth: 22, height: 22, borderRadius: 11,
    backgroundColor: Colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5,
  },
  pendingBadgeText: { fontSize: 11, fontWeight: Typography.weight.bold, color: '#FFFFFF' },
  subtitle: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2 },

  summaryStrip: {
    flexDirection: 'row', justifyContent: 'space-around',
    paddingVertical: Spacing.md, paddingHorizontal: Spacing.base,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
    backgroundColor: Colors.surface,
  },
  summaryItem: { alignItems: 'center', gap: 3 },
  summaryValue: { fontSize: Typography.size.lg, fontWeight: Typography.weight.extrabold },
  summaryLabel: { fontSize: Typography.size.xs - 1, color: Colors.textTertiary },

  tabsOuter: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  tabsContent: {
    flexDirection: 'row', gap: Spacing.xs,
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm,
  },
  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs + 2,
    borderRadius: Radius.pill, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  tabActive: { backgroundColor: Colors.surfaceHighlight },
  tabLabel: { fontSize: Typography.size.xs, color: Colors.textSecondary, fontWeight: Typography.weight.medium },
  tabCount: {
    paddingHorizontal: 5, paddingVertical: 1,
    borderRadius: Radius.pill, backgroundColor: Colors.surfaceHighlight, minWidth: 18, alignItems: 'center',
  },
  tabCountText: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary },

  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  loadingText: { fontSize: Typography.size.sm, color: Colors.textTertiary },

  list: { padding: Spacing.base },

  empty: { alignItems: 'center', gap: Spacing.md, paddingVertical: 60, paddingHorizontal: Spacing.xl },
  emptyIconWrap: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: Colors.successDim, alignItems: 'center', justifyContent: 'center',
  },
  emptyTitle: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  emptyText: {
    fontSize: Typography.size.sm, color: Colors.textTertiary,
    textAlign: 'center', lineHeight: 20,
  },
});
