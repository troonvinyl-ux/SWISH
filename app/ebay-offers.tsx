// SWISH — eBay Offers & Negotiation
// Tracks sent offers, incoming Best Offers, and negotiation history.
// Integrates with eBay Negotiation API (send offers to watchers).

import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable,
  ActivityIndicator, RefreshControl, ScrollView, Modal,
  TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { getSupabaseClient } from '@/template';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { useAlert } from '@/template';

interface EbayOffer {
  id: string;
  listingId?: string;
  ebayListingId?: string;
  offerType: string; // sent_to_watchers | best_offer_received | counter
  buyerUsername?: string;
  offerAmount?: number;
  counterAmount?: number;
  originalPrice?: number;
  discountPct?: number;
  message: string;
  status: string; // pending | accepted | declined | expired | counter_sent
  expiresAt?: string;
  sentAt?: string;
  respondedAt?: string;
  itemTitle?: string;
}

interface EligibleListing {
  id: string;
  externalListingId?: string;
  title: string;
  price: number;
  watchers: number;
  daysListed: number;
}

const STATUS_COLORS: Record<string, string> = {
  pending: Colors.warning,
  accepted: Colors.success,
  declined: Colors.danger,
  expired: Colors.textTertiary,
  counter_sent: Colors.primary,
};

function OfferRow({ offer }: { offer: EbayOffer }) {
  const statusColor = STATUS_COLORS[offer.status] ?? Colors.textTertiary;
  return (
    <View style={or.card}>
      <View style={or.topRow}>
        <View style={[or.typeBadge, {
          backgroundColor: offer.offerType === 'best_offer_received' ? Colors.infoDim : Colors.accentDim,
        }]}>
          <MaterialIcons
            name={offer.offerType === 'best_offer_received' ? 'inbox' : 'local-offer'}
            size={10}
            color={offer.offerType === 'best_offer_received' ? Colors.info : Colors.accent}
          />
          <Text style={[or.typeText, { color: offer.offerType === 'best_offer_received' ? Colors.info : Colors.accent }]}>
            {offer.offerType === 'best_offer_received' ? 'Incoming Offer' : offer.offerType === 'sent_to_watchers' ? 'Sent to Watchers' : 'Counter Offer'}
          </Text>
        </View>
        <View style={[or.statusPill, { backgroundColor: statusColor + '20' }]}>
          <View style={[or.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[or.statusText, { color: statusColor }]}>{offer.status.replace(/_/g, ' ')}</Text>
        </View>
      </View>
      {offer.itemTitle ? (
        <Text style={or.title} numberOfLines={1}>{offer.itemTitle}</Text>
      ) : null}
      <View style={or.amountRow}>
        {offer.originalPrice ? (
          <Text style={or.originalPrice}>List: £{offer.originalPrice.toFixed(2)}</Text>
        ) : null}
        {offer.offerAmount ? (
          <Text style={or.offerAmount}>
            {offer.offerType === 'best_offer_received' ? 'Buyer offered' : 'Offer sent'}: £{offer.offerAmount.toFixed(2)}
          </Text>
        ) : null}
        {offer.discountPct ? (
          <Text style={or.discount}>{offer.discountPct.toFixed(0)}% off</Text>
        ) : null}
      </View>
      {offer.buyerUsername ? (
        <Text style={or.buyer}>Buyer: {offer.buyerUsername}</Text>
      ) : null}
      {offer.sentAt ? (
        <Text style={or.date}>
          {new Date(offer.sentAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
        </Text>
      ) : null}
    </View>
  );
}

const or = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.md, gap: 5,
    borderWidth: 1, borderColor: Colors.surfaceBorder, ...Shadow.sm,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  typeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderRadius: Radius.pill, paddingHorizontal: 6, paddingVertical: 3,
  },
  typeText: { fontSize: 9, fontWeight: Typography.weight.bold },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderRadius: Radius.pill, paddingHorizontal: 5, paddingVertical: 2,
  },
  statusDot: { width: 5, height: 5, borderRadius: 3 },
  statusText: { fontSize: 9, fontWeight: Typography.weight.semibold, textTransform: 'capitalize' },
  title: { fontSize: Typography.size.sm, color: Colors.textPrimary, fontWeight: Typography.weight.medium },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, flexWrap: 'wrap' },
  originalPrice: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  offerAmount: { fontSize: Typography.size.sm, color: Colors.gold, fontWeight: Typography.weight.bold },
  discount: { fontSize: 10, color: Colors.success, fontWeight: Typography.weight.semibold },
  buyer: { fontSize: Typography.size.xs, color: Colors.textSecondary },
  date: { fontSize: 9, color: Colors.textTertiary },
});

// ── Send Offer Modal ──────────────────────────────────────────────────────────

function SendOfferModal({
  visible,
  eligibleListings,
  onClose,
  onSent,
  tenantId,
  showAlert,
}: {
  visible: boolean;
  eligibleListings: EligibleListing[];
  onClose: () => void;
  onSent: () => void;
  tenantId: string;
  showAlert: (t: string, m?: string, b?: any[]) => void;
}) {
  const [selectedListing, setSelectedListing] = useState<EligibleListing | null>(null);
  const [discountPct, setDiscountPct] = useState('10');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (visible) { setSelectedListing(null); setDiscountPct('10'); setMessage(''); }
  }, [visible]);

  const handleSend = async () => {
    if (!selectedListing) { showAlert('Select Listing', 'Choose a listing to send an offer for.'); return; }
    const pct = parseFloat(discountPct);
    if (isNaN(pct) || pct <= 0 || pct > 50) { showAlert('Invalid Discount', 'Enter a discount between 1% and 50%.'); return; }

    const offerPrice = selectedListing.price * (1 - pct / 100);

    showAlert(
      'Send Offer to Watchers?',
      `Send a ${pct}% discount offer (£${offerPrice.toFixed(2)}) to ${selectedListing.watchers} watcher${selectedListing.watchers !== 1 ? 's' : ''} of "${selectedListing.title.slice(0, 40)}"?\n\nNote: eBay Negotiation API requires specific eBay approval. Offer is recorded in SWISH.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send Offer',
          onPress: async () => {
            setSending(true);
            const supabase = getSupabaseClient();
            await supabase.from('ebay_offers').insert({
              tenant_id: tenantId,
              listing_id: selectedListing.id,
              ebay_listing_id: selectedListing.externalListingId,
              offer_type: 'sent_to_watchers',
              offer_amount: offerPrice,
              original_price: selectedListing.price,
              discount_pct: pct,
              message,
              status: 'pending',
              sent_at: new Date().toISOString(),
            });
            setSending(false);
            showAlert('Offer Recorded', `£${offerPrice.toFixed(2)} offer saved. To send via eBay, use Seller Hub → Promoted Listings → Offers.`);
            onSent();
            onClose();
          },
        },
      ]
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: Colors.background }}>
        <View style={sm.header}>
          <Pressable onPress={onClose} style={sm.closeBtn} hitSlop={8}>
            <MaterialIcons name="close" size={18} color={Colors.textSecondary} />
          </Pressable>
          <Text style={sm.title}>Send Offer to Watchers</Text>
        </View>
        <ScrollView contentContainerStyle={{ padding: Spacing.base, gap: Spacing.md, paddingBottom: 100 }}>
          {/* Select listing */}
          <Text style={sm.label}>SELECT LISTING</Text>
          {eligibleListings.length === 0 ? (
            <View style={sm.emptyNote}>
              <MaterialIcons name="info-outline" size={14} color={Colors.textTertiary} />
              <Text style={sm.emptyNoteText}>No active listings with watchers found.</Text>
            </View>
          ) : (
            eligibleListings.map(l => (
              <Pressable
                key={l.id}
                onPress={() => setSelectedListing(l)}
                style={[sm.listingRow, selectedListing?.id === l.id && sm.listingRowActive]}
              >
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={sm.listingTitle} numberOfLines={1}>{l.title}</Text>
                  <Text style={sm.listingMeta}>
                    £{l.price.toFixed(2)} · {l.watchers} watcher{l.watchers !== 1 ? 's' : ''} · {l.daysListed}d listed
                  </Text>
                </View>
                {selectedListing?.id === l.id ? (
                  <MaterialIcons name="check-circle" size={18} color={Colors.primary} />
                ) : null}
              </Pressable>
            ))
          )}

          {/* Discount */}
          <View style={sm.field}>
            <Text style={sm.label}>DISCOUNT %</Text>
            <TextInput
              style={sm.input}
              value={discountPct}
              onChangeText={setDiscountPct}
              keyboardType="decimal-pad"
              placeholder="e.g. 10"
              placeholderTextColor={Colors.textTertiary}
            />
            {selectedListing ? (
              <Text style={sm.preview}>
                Offer price: £{(selectedListing.price * (1 - (parseFloat(discountPct) || 0) / 100)).toFixed(2)}
              </Text>
            ) : null}
          </View>

          {/* Message */}
          <View style={sm.field}>
            <Text style={sm.label}>PERSONAL MESSAGE (optional)</Text>
            <TextInput
              style={[sm.input, { minHeight: 70, textAlignVertical: 'top' }]}
              value={message}
              onChangeText={setMessage}
              placeholder="Add a personal message to the buyer..."
              placeholderTextColor={Colors.textTertiary}
              multiline
            />
          </View>

          {/* API note */}
          <View style={sm.noteCard}>
            <MaterialIcons name="info-outline" size={12} color={Colors.warning} />
            <Text style={sm.noteText}>
              The eBay Negotiation API requires specific eBay approval. Offers are recorded in SWISH
              and can be submitted directly via eBay Seller Hub → Offers tool.
            </Text>
          </View>

          <Pressable
            onPress={handleSend}
            disabled={sending || !selectedListing}
            style={[sm.sendBtn, (!selectedListing || sending) && { opacity: 0.5 }]}
          >
            {sending ? <ActivityIndicator size="small" color={Colors.background} style={{ width: 14, height: 14 }} /> : <MaterialIcons name="local-offer" size={14} color={Colors.background} />}
            <Text style={sm.sendBtnText}>{sending ? 'Sending...' : 'Record Offer'}</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

const sm = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.base, paddingTop: Spacing.lg, paddingBottom: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  closeBtn: {
    width: 32, height: 32, borderRadius: Radius.md,
    backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  title: { fontSize: Typography.size.md, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  label: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary, letterSpacing: 0.5 },
  field: { gap: 5 },
  input: {
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    fontSize: Typography.size.sm, color: Colors.textPrimary, includeFontPadding: false,
  },
  preview: { fontSize: Typography.size.sm, color: Colors.gold, fontWeight: Typography.weight.semibold },
  listingRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  listingRowActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryDim },
  listingTitle: { fontSize: Typography.size.sm, color: Colors.textPrimary, fontWeight: Typography.weight.medium },
  listingMeta: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  emptyNote: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, padding: Spacing.md,
  },
  emptyNoteText: { fontSize: Typography.size.sm, color: Colors.textTertiary },
  noteCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    backgroundColor: Colors.warningDim, borderRadius: Radius.md, padding: Spacing.sm,
  },
  noteText: { flex: 1, fontSize: 10, color: Colors.warning, lineHeight: 14 },
  sendBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: Colors.accent, borderRadius: Radius.md, paddingVertical: Spacing.md,
  },
  sendBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },
});

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function EbayOffersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tenant } = useApp();
  const { showAlert } = useAlert();

  const [offers, setOffers] = useState<EbayOffer[]>([]);
  const [eligibleListings, setEligibleListings] = useState<EligibleListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showSendModal, setShowSendModal] = useState(false);

  const load = useCallback(async () => {
    if (!tenant) return;
    const supabase = getSupabaseClient();
    const now = Date.now();

    const [offersRes, listingsRes] = await Promise.all([
      supabase.from('ebay_offers').select('*, listings(title)').eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(100),
      supabase.from('listings').select('id, external_listing_id, title, price, watchers, published_at')
        .eq('tenant_id', tenant.id).eq('marketplace_id', 'ebay').eq('status', 'active')
        .gt('watchers', 0).order('watchers', { ascending: false }).limit(50),
    ]);

    setOffers((offersRes.data ?? []).map((r: any) => ({
      id: r.id, listingId: r.listing_id ?? undefined, ebayListingId: r.ebay_listing_id ?? undefined,
      offerType: r.offer_type ?? 'sent_to_watchers', buyerUsername: r.buyer_username ?? undefined,
      offerAmount: r.offer_amount ? Number(r.offer_amount) : undefined,
      counterAmount: r.counter_amount ? Number(r.counter_amount) : undefined,
      originalPrice: r.original_price ? Number(r.original_price) : undefined,
      discountPct: r.discount_pct ? Number(r.discount_pct) : undefined,
      message: r.message ?? '',
      status: r.status ?? 'pending',
      expiresAt: r.expires_at ?? undefined,
      sentAt: r.sent_at ?? undefined,
      respondedAt: r.responded_at ?? undefined,
      itemTitle: r.listings?.title ?? undefined,
    })));

    setEligibleListings((listingsRes.data ?? []).map((r: any) => ({
      id: r.id, externalListingId: r.external_listing_id ?? undefined,
      title: r.title, price: Number(r.price ?? 0),
      watchers: r.watchers ?? 0,
      daysListed: r.published_at ? Math.floor((now - new Date(r.published_at).getTime()) / (1000 * 60 * 60 * 24)) : 0,
    })));

    setLoading(false);
    setRefreshing(false);
  }, [tenant?.id]);

  useEffect(() => { load(); }, [load]);
  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);

  const pendingCount = offers.filter(o => o.status === 'pending').length;

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      <View style={[s.header, { paddingTop: insets.top + Spacing.base }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={20} color={Colors.textSecondary} />
        </Pressable>
        <View style={s.flex}>
          <Text style={s.title}>Offers & Negotiation</Text>
          <Text style={s.subtitle}>
            {pendingCount > 0 ? `${pendingCount} pending · ` : ''}
            {eligibleListings.length} listings eligible
          </Text>
        </View>
        <Pressable
          onPress={() => setShowSendModal(true)}
          style={s.sendBtn}
          hitSlop={4}
        >
          <MaterialIcons name="local-offer" size={14} color={Colors.background} />
          <Text style={s.sendBtnText}>Send Offer</Text>
        </Pressable>
      </View>

      {/* Eligible listings banner */}
      {eligibleListings.length > 0 ? (
        <View style={s.eligibleBanner}>
          <MaterialIcons name="star" size={14} color={Colors.accent} />
          <Text style={s.eligibleText}>
            {eligibleListings.length} listing{eligibleListings.length > 1 ? 's' : ''} with watchers — eligible for targeted offers
          </Text>
          <Pressable onPress={() => setShowSendModal(true)} style={s.eligibleBtn} hitSlop={4}>
            <Text style={s.eligibleBtnText}>Send Now</Text>
          </Pressable>
        </View>
      ) : null}

      {loading ? (
        <View style={s.loading}><ActivityIndicator color={Colors.primary} size="large" /></View>
      ) : (
        <FlatList
          data={offers}
          keyExtractor={o => o.id}
          contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 80 }]}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
          renderItem={({ item }) => <OfferRow offer={item} />}
          ListEmptyComponent={
            <View style={s.empty}>
              <MaterialIcons name="local-offer" size={48} color={Colors.textTertiary} />
              <Text style={s.emptyTitle}>No offers yet</Text>
              <Text style={s.emptyText}>
                Send targeted discount offers to buyers who are watching your listings.
                Watchers have shown interest — a well-timed offer can close the sale.
              </Text>
              <Pressable onPress={() => setShowSendModal(true)} style={s.emptyCta}>
                <MaterialIcons name="local-offer" size={16} color={Colors.background} />
                <Text style={s.emptyCtaText}>Send Offer</Text>
              </Pressable>
            </View>
          }
        />
      )}

      <SendOfferModal
        visible={showSendModal}
        eligibleListings={eligibleListings}
        onClose={() => setShowSendModal(false)}
        onSent={load}
        tenantId={tenant?.id ?? ''}
        showAlert={showAlert}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.base, paddingBottom: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  backBtn: {
    width: 34, height: 34, borderRadius: Radius.md,
    backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  title: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  subtitle: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 1 },
  sendBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.accent, borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm, paddingVertical: 6,
  },
  sendBtnText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.background },
  eligibleBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm,
    backgroundColor: Colors.accentDim, borderBottomWidth: 1, borderBottomColor: Colors.accent + '30',
  },
  eligibleText: { flex: 1, fontSize: Typography.size.xs, color: Colors.accent },
  eligibleBtn: {
    backgroundColor: Colors.accent, borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm, paddingVertical: 4,
  },
  eligibleBtnText: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: Spacing.base },
  empty: { alignItems: 'center', gap: Spacing.md, paddingVertical: 60, paddingHorizontal: Spacing.xl },
  emptyTitle: { fontSize: Typography.size.lg, fontWeight: Typography.weight.semibold, color: Colors.textSecondary },
  emptyText: { fontSize: Typography.size.sm, color: Colors.textTertiary, textAlign: 'center', lineHeight: 20 },
  emptyCta: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.accent, borderRadius: Radius.pill,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
  },
  emptyCtaText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },
});
