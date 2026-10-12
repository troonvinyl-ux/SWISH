// SWISH — eBay Messages / Communications Inbox
// All eBay API operations are performed server-side via swish-ebay-messages edge function.
// The client NEVER reads credential_ref, accessToken, or clientSecret.
// The client sends only: authenticated request + tenantId + message parameters.

import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable,
  TextInput, ActivityIndicator, RefreshControl, Modal,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { getSupabaseClient } from '@/template';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { useAlert } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface EbayMessage {
  id: string;
  ebayMessageId?: string;
  conversationId?: string;
  ebayItemId?: string;
  ebayOrderId?: string;
  buyerUsername: string;
  subject: string;
  body: string;
  isRead: boolean;
  isReplied: boolean;
  isArchived: boolean;
  direction: 'inbound' | 'outbound';
  aiDraft?: string;
  listingId?: string;
  receivedAt: string;
  repliedAt?: string;
}

type FilterTab = 'unread' | 'all' | 'sent' | 'archived';

const FILTER_TABS: Array<{ id: FilterTab; label: string }> = [
  { id: 'unread', label: 'Unread' },
  { id: 'all', label: 'All' },
  { id: 'sent', label: 'Sent' },
  { id: 'archived', label: 'Archived' },
];

// ── Server-side message sync via swish-ebay-messages edge function ─────────────
// NO direct eBay API calls from the client.
// NO reading of credential_ref, accessToken, or clientSecret.

async function syncEbayMessages(
  tenantId: string,
): Promise<{ synced: number; error: string | null }> {
  const supabase = getSupabaseClient();

  try {
    const { data, error } = await supabase.functions.invoke('swish-ebay-messages', {
      body: { route: 'sync_messages', tenantId, daysBack: 30 },
    });

    if (error) {
      let errorMessage = error.message;
      if (error instanceof FunctionsHttpError) {
        try {
          const text = await error.context?.text();
          const parsed = text ? JSON.parse(text) : null;
          errorMessage = parsed?.error ?? text ?? error.message;
        } catch {
          errorMessage = error.message;
        }
      }
      return { synced: 0, error: errorMessage };
    }

    return { synced: data?.synced ?? 0, error: null };
  } catch (e: any) {
    return { synced: 0, error: e?.message ?? 'Failed to sync messages' };
  }
}

// ── Server-side reply via swish-ebay-messages edge function ────────────────────
// NO direct eBay Trading API calls from the client.

async function sendEbayReply(
  tenantId: string,
  params: {
    messageId: string;
    replyText: string;
    buyerUsername: string;
    ebayItemId?: string;
    conversationId?: string;
  },
): Promise<{ ebaySuccess: boolean; message: string; error?: string }> {
  const supabase = getSupabaseClient();

  try {
    const { data, error } = await supabase.functions.invoke('swish-ebay-messages', {
      body: { route: 'send_reply', tenantId, ...params },
    });

    if (error) {
      let errorMessage = error.message;
      if (error instanceof FunctionsHttpError) {
        try {
          const text = await error.context?.text();
          const parsed = text ? JSON.parse(text) : null;
          errorMessage = parsed?.error ?? text ?? error.message;
        } catch {
          errorMessage = error.message;
        }
      }
      return { ebaySuccess: false, message: '', error: errorMessage };
    }

    return {
      ebaySuccess: data?.ebaySuccess ?? false,
      message: data?.message ?? 'Reply processed.',
    };
  } catch (e: any) {
    return { ebaySuccess: false, message: '', error: e?.message ?? 'Failed to send reply' };
  }
}

// ── Generate AI reply draft (local template — no eBay credentials needed) ─────

function generateAiReply(message: EbayMessage): string {
  const context = (message.subject ?? '').toLowerCase();
  if (context.includes('return') || context.includes('refund')) {
    return `Thank you for getting in touch. I am sorry to hear about the issue with your order. I would be happy to help resolve this for you. Could you please provide more details about the problem? I will make sure we find the best solution as quickly as possible.\n\nKind regards`;
  }
  if (context.includes('dispatch') || context.includes('shipping') || context.includes('where')) {
    return `Thank you for your message. Your order has been processed and I will be dispatching it very soon. Once dispatched, you will receive a tracking number via eBay. If you have any further questions, please do not hesitate to ask.\n\nKind regards`;
  }
  return `Thank you for your message. I will get back to you as soon as possible. Please do not hesitate to ask if you have any questions.\n\nKind regards`;
}

// ── Message Row ───────────────────────────────────────────────────────────────

function MessageRow({
  message,
  onPress,
  onMarkRead,
  onArchive,
}: {
  message: EbayMessage;
  onPress: (m: EbayMessage) => void;
  onMarkRead: (id: string) => void;
  onArchive: (id: string) => void;
}) {
  const timeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(diff / 3600000);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  };

  return (
    <Pressable
      onPress={() => onPress(message)}
      style={({ pressed }) => [mr.card, !message.isRead && mr.cardUnread, pressed && { opacity: 0.85 }]}
    >
      <View style={mr.left}>
        <View style={[mr.avatar, !message.isRead && mr.avatarUnread]}>
          <Text style={mr.avatarText}>
            {(message.buyerUsername || 'B')[0].toUpperCase()}
          </Text>
        </View>
        {!message.isRead ? <View style={mr.unreadDot} /> : null}
      </View>
      <View style={mr.content}>
        <View style={mr.topRow}>
          <Text style={[mr.buyer, !message.isRead && mr.buyerUnread]} numberOfLines={1}>
            {message.buyerUsername || 'eBay Buyer'}
          </Text>
          <Text style={mr.time}>{timeAgo(message.receivedAt)}</Text>
        </View>
        <Text style={[mr.subject, !message.isRead && mr.subjectUnread]} numberOfLines={1}>
          {message.subject || '(no subject)'}
        </Text>
        <Text style={mr.preview} numberOfLines={1}>
          {message.body.slice(0, 80)}
        </Text>
        <View style={mr.tagRow}>
          {message.isReplied ? (
            <View style={mr.repliedTag}>
              <MaterialIcons name="reply" size={9} color={Colors.success} />
              <Text style={mr.repliedTagText}>Replied</Text>
            </View>
          ) : message.direction === 'inbound' && !message.isReplied ? (
            <View style={mr.awaitingTag}>
              <MaterialIcons name="hourglass-empty" size={9} color={Colors.warning} />
              <Text style={mr.awaitingTagText}>Awaiting reply</Text>
            </View>
          ) : null}
          {message.ebayItemId ? (
            <View style={mr.itemTag}>
              <MaterialIcons name="sell" size={9} color={Colors.textTertiary} />
              <Text style={mr.itemTagText}>#{message.ebayItemId}</Text>
            </View>
          ) : null}
        </View>
      </View>
      <View style={mr.actions}>
        {!message.isRead ? (
          <Pressable onPress={() => onMarkRead(message.id)} hitSlop={8} style={mr.actionBtn}>
            <MaterialIcons name="mark-email-read" size={14} color={Colors.primary} />
          </Pressable>
        ) : null}
        <Pressable onPress={() => onArchive(message.id)} hitSlop={8} style={mr.actionBtn}>
          <MaterialIcons name="archive" size={14} color={Colors.textTertiary} />
        </Pressable>
      </View>
    </Pressable>
  );
}

const mr = StyleSheet.create({
  card: {
    flexDirection: 'row', backgroundColor: Colors.surface, borderRadius: Radius.xl,
    padding: Spacing.md, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  cardUnread: { borderColor: Colors.primary + '50', backgroundColor: Colors.primaryDim + '40' },
  left: { position: 'relative' },
  avatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center',
  },
  avatarUnread: { backgroundColor: Colors.primaryDim },
  avatarText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textSecondary },
  unreadDot: {
    position: 'absolute', top: 0, right: 0,
    width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.primary,
    borderWidth: 1.5, borderColor: Colors.surface,
  },
  content: { flex: 1, gap: 2 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  buyer: { flex: 1, fontSize: Typography.size.sm, color: Colors.textSecondary },
  buyerUnread: { color: Colors.textPrimary, fontWeight: Typography.weight.semibold },
  time: { fontSize: 9, color: Colors.textTertiary },
  subject: { fontSize: Typography.size.sm, color: Colors.textSecondary },
  subjectUnread: { color: Colors.textPrimary, fontWeight: Typography.weight.semibold },
  preview: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  tagRow: { flexDirection: 'row', gap: 5, marginTop: 2 },
  repliedTag: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.successDim, borderRadius: Radius.pill, paddingHorizontal: 5, paddingVertical: 2,
  },
  repliedTagText: { fontSize: 9, color: Colors.success, fontWeight: Typography.weight.semibold },
  awaitingTag: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.warningDim, borderRadius: Radius.pill, paddingHorizontal: 5, paddingVertical: 2,
  },
  awaitingTagText: { fontSize: 9, color: Colors.warning, fontWeight: Typography.weight.semibold },
  itemTag: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.pill, paddingHorizontal: 5, paddingVertical: 2,
  },
  itemTagText: { fontSize: 9, color: Colors.textTertiary },
  actions: { gap: 6, justifyContent: 'center' },
  actionBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
});

// ── Reply Modal ───────────────────────────────────────────────────────────────

function ReplyModal({
  visible,
  message,
  onClose,
  onSent,
  tenantId,
  showAlert,
}: {
  visible: boolean;
  message: EbayMessage | null;
  onClose: () => void;
  onSent: (msgId: string) => void;
  tenantId: string;
  showAlert: (t: string, m?: string, b?: any[]) => void;
}) {
  const [replyText, setReplyText] = useState('');
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (visible && message) {
      setReplyText(message.aiDraft ?? '');
    } else {
      setReplyText('');
    }
  }, [visible, message]);

  const handleGenerateDraft = useCallback(() => {
    if (!message) return;
    setGeneratingDraft(true);
    // Local template generation — no credentials needed
    const draft = generateAiReply(message);
    setReplyText(draft);
    setGeneratingDraft(false);
  }, [message]);

  const handleSend = useCallback(async () => {
    if (!message || !replyText.trim()) {
      showAlert('Empty Reply', 'Write a reply before sending.');
      return;
    }

    showAlert(
      'Send Reply?',
      'This will send a reply to the buyer via eBay messaging.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send',
          onPress: async () => {
            setSending(true);
            const result = await sendEbayReply(tenantId, {
              messageId:      message.id,
              replyText:      replyText.trim(),
              buyerUsername:  message.buyerUsername,
              ebayItemId:     message.ebayItemId,
              conversationId: message.conversationId,
            });
            setSending(false);

            if (result.error) {
              showAlert('Send Failed', result.error);
              return;
            }

            if (result.ebaySuccess) {
              showAlert('Reply Sent', 'Your message has been sent via eBay.');
            } else {
              showAlert('Reply Saved', result.message);
            }
            onSent(message.id);
            onClose();
          },
        },
      ]
    );
  }, [message, replyText, tenantId, showAlert, onSent, onClose]);

  if (!message) return null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: Colors.background }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Header */}
        <View style={rm.header}>
          <Pressable onPress={onClose} style={rm.closeBtn} hitSlop={8}>
            <MaterialIcons name="close" size={18} color={Colors.textSecondary} />
          </Pressable>
          <View style={rm.flex}>
            <Text style={rm.title}>Reply to {message.buyerUsername}</Text>
            <Text style={rm.sub} numberOfLines={1}>{message.subject}</Text>
          </View>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: Spacing.base, gap: Spacing.md, paddingBottom: 120 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Original message */}
          <View style={rm.originalCard}>
            <Text style={rm.originalLabel}>BUYER'S MESSAGE</Text>
            <Text style={rm.originalText}>{message.body}</Text>
            {message.ebayItemId ? (
              <Text style={rm.itemRef}>eBay Item #{message.ebayItemId}</Text>
            ) : null}
          </View>

          {/* AI draft button */}
          <Pressable
            onPress={handleGenerateDraft}
            disabled={generatingDraft}
            style={({ pressed }) => [rm.draftBtn, pressed && { opacity: 0.85 }]}
          >
            <MaterialIcons name="auto-awesome" size={14} color={Colors.accent} />
            <Text style={rm.draftBtnText}>Generate Draft Reply</Text>
          </Pressable>

          {/* Reply compose */}
          <View style={rm.composeBox}>
            <Text style={rm.composeLabel}>YOUR REPLY</Text>
            <TextInput
              style={rm.composeInput}
              value={replyText}
              onChangeText={setReplyText}
              multiline
              textAlignVertical="top"
              placeholder="Type your reply..."
              placeholderTextColor={Colors.textTertiary}
              minHeight={180}
            />
            <Text style={rm.charCount}>{replyText.length} chars</Text>
          </View>

          <View style={rm.noteCard}>
            <MaterialIcons name="info-outline" size={12} color={Colors.info} />
            <Text style={rm.noteText}>
              Reply is sent server-side via eBay messaging. Your credentials are never exposed to the app.
            </Text>
          </View>
        </ScrollView>

        {/* Send button */}
        <View style={rm.footer}>
          <Pressable
            onPress={handleSend}
            disabled={sending || !replyText.trim()}
            style={[rm.sendBtn, (!replyText.trim() || sending) && { opacity: 0.5 }]}
          >
            {sending
              ? <ActivityIndicator size="small" color={Colors.background} style={{ width: 14, height: 14 }} />
              : <MaterialIcons name="send" size={16} color={Colors.background} />
            }
            <Text style={rm.sendBtnText}>{sending ? 'Sending...' : 'Send Reply'}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const rm = StyleSheet.create({
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
  flex: { flex: 1 },
  title: { fontSize: Typography.size.md, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  sub: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 1 },
  originalCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    padding: Spacing.md, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  originalLabel: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary, letterSpacing: 0.5 },
  originalText: { fontSize: Typography.size.sm, color: Colors.textSecondary, lineHeight: 20 },
  itemRef: { fontSize: 10, color: Colors.primary },
  draftBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: Colors.accentDim, borderRadius: Radius.md, paddingVertical: Spacing.md,
    borderWidth: 1, borderColor: Colors.accent + '40',
  },
  draftBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.accent },
  composeBox: { gap: 6 },
  composeLabel: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary, letterSpacing: 0.5 },
  composeInput: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.md,
    fontSize: Typography.size.sm, color: Colors.textPrimary, lineHeight: 20,
    includeFontPadding: false,
  },
  charCount: { fontSize: 9, color: Colors.textTertiary, textAlign: 'right' },
  noteCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    backgroundColor: Colors.infoDim, borderRadius: Radius.md, padding: Spacing.sm,
  },
  noteText: { flex: 1, fontSize: 10, color: Colors.textSecondary, lineHeight: 14 },
  footer: {
    padding: Spacing.base, paddingBottom: Platform.OS === 'ios' ? Spacing.xl : Spacing.base,
    borderTopWidth: 1, borderTopColor: Colors.surfaceBorder,
  },
  sendBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: Spacing.base,
  },
  sendBtnText: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: Colors.background },
});

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function EbayMessagesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tenant } = useApp();
  const { showAlert } = useAlert();

  const [messages, setMessages] = useState<EbayMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [activeTab, setActiveTab] = useState<FilterTab>('unread');
  const [search, setSearch] = useState('');
  const [replyMessage, setReplyMessage] = useState<EbayMessage | null>(null);

  // Load messages from local DB (already synced from eBay server-side)
  const load = useCallback(async () => {
    if (!tenant) return;
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('ebay_messages')
      .select('*')
      .eq('tenant_id', tenant.id)
      .order('received_at', { ascending: false })
      .limit(200);

    setMessages((data ?? []).map((r: any) => ({
      id: r.id,
      ebayMessageId: r.ebay_message_id ?? undefined,
      conversationId: r.conversation_id ?? undefined,
      ebayItemId: r.ebay_item_id ?? undefined,
      ebayOrderId: r.ebay_order_id ?? undefined,
      buyerUsername: r.buyer_username ?? '',
      subject: r.subject ?? '',
      body: r.body ?? '',
      isRead: r.is_read ?? false,
      isReplied: r.is_replied ?? false,
      isArchived: r.is_archived ?? false,
      direction: r.direction ?? 'inbound',
      aiDraft: r.ai_draft ?? undefined,
      listingId: r.listing_id ?? undefined,
      receivedAt: r.received_at ?? r.created_at,
      repliedAt: r.replied_at ?? undefined,
    })));

    setLoading(false);
    setRefreshing(false);
  }, [tenant?.id]);

  useEffect(() => { load(); }, [load]);
  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);

  const handleSync = useCallback(async () => {
    if (!tenant) return;
    setSyncing(true);
    const { synced, error } = await syncEbayMessages(tenant.id);
    setSyncing(false);
    if (error) {
      showAlert('Sync Failed', error);
    } else if (synced === 0) {
      showAlert('No New Messages', 'No new messages found in the last 30 days.');
    } else {
      showAlert('Messages Synced', `${synced} messages imported from eBay.`);
      load();
    }
  }, [tenant, showAlert, load]);

  const handleMarkRead = useCallback(async (id: string) => {
    const supabase = getSupabaseClient();
    await supabase.from('ebay_messages').update({ is_read: true }).eq('id', id);
    setMessages(prev => prev.map(m => m.id === id ? { ...m, isRead: true } : m));
  }, []);

  const handleArchive = useCallback(async (id: string) => {
    const supabase = getSupabaseClient();
    await supabase.from('ebay_messages').update({ is_archived: true }).eq('id', id);
    setMessages(prev => prev.map(m => m.id === id ? { ...m, isArchived: true } : m));
  }, []);

  const handleMessagePress = useCallback((m: EbayMessage) => {
    if (!m.isRead) handleMarkRead(m.id);
    setReplyMessage(m);
  }, [handleMarkRead]);

  const displayed = messages.filter(m => {
    if (activeTab === 'unread') return !m.isRead && !m.isArchived && m.direction === 'inbound';
    if (activeTab === 'sent') return m.direction === 'outbound';
    if (activeTab === 'archived') return m.isArchived;
    return !m.isArchived;
  }).filter(m => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return m.buyerUsername.toLowerCase().includes(q)
      || m.subject.toLowerCase().includes(q)
      || m.body.toLowerCase().includes(q);
  });

  const unreadCount = messages.filter(m => !m.isRead && !m.isArchived && m.direction === 'inbound').length;

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + Spacing.base }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={20} color={Colors.textSecondary} />
        </Pressable>
        <View style={s.flex}>
          <Text style={s.title}>Messages</Text>
          <Text style={s.subtitle}>
            {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
          </Text>
        </View>
        <Pressable
          onPress={handleSync}
          disabled={syncing}
          style={s.syncBtn}
          hitSlop={4}
        >
          {syncing
            ? <ActivityIndicator size="small" color={Colors.primary} />
            : <MaterialIcons name="sync" size={16} color={Colors.primary} />
          }
          <Text style={s.syncBtnText}>{syncing ? 'Syncing...' : 'Sync'}</Text>
        </Pressable>
      </View>

      {/* Filter Tabs */}
      <ScrollView
        horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.tabsContent}
        style={s.tabsOuter}
      >
        {FILTER_TABS.map(tab => {
          const active = activeTab === tab.id;
          const count = tab.id === 'unread' ? unreadCount : undefined;
          return (
            <Pressable
              key={tab.id}
              onPress={() => setActiveTab(tab.id)}
              style={[s.tab, active && s.tabActive]}
            >
              <Text style={[s.tabLabel, active && s.tabLabelActive]}>{tab.label}</Text>
              {count !== undefined && count > 0 ? (
                <View style={s.tabBadge}>
                  <Text style={s.tabBadgeText}>{count}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Search */}
      <View style={s.searchWrap}>
        <MaterialIcons name="search" size={15} color={Colors.textTertiary} style={{ marginLeft: Spacing.sm }} />
        <TextInput
          style={s.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search messages..."
          placeholderTextColor={Colors.textTertiary}
          clearButtonMode="while-editing"
        />
      </View>

      {loading ? (
        <View style={s.loading}>
          <ActivityIndicator color={Colors.primary} size="large" />
        </View>
      ) : displayed.length === 0 ? (
        <View style={s.empty}>
          <MaterialIcons name="mail-outline" size={48} color={Colors.textTertiary} />
          <Text style={s.emptyTitle}>
            {activeTab === 'unread' ? 'No unread messages' : 'No messages'}
          </Text>
          <Text style={s.emptyText}>
            Tap Sync to fetch messages from eBay.{'\n'}Messages from the last 30 days are imported.
          </Text>
          <Pressable onPress={handleSync} disabled={syncing} style={s.syncLargeBtn}>
            <MaterialIcons name="sync" size={16} color={Colors.background} />
            <Text style={s.syncLargeBtnText}>Sync eBay Messages</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={displayed}
          keyExtractor={m => m.id}
          contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 80 }]}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.xs }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
          renderItem={({ item }) => (
            <MessageRow
              message={item}
              onPress={handleMessagePress}
              onMarkRead={handleMarkRead}
              onArchive={handleArchive}
            />
          )}
        />
      )}

      <ReplyModal
        visible={!!replyMessage}
        message={replyMessage}
        onClose={() => setReplyMessage(null)}
        onSent={id => {
          setMessages(prev => prev.map(m => m.id === id ? { ...m, isReplied: true } : m));
        }}
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
  syncBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primaryDim, borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm, paddingVertical: 6,
    borderWidth: 1, borderColor: Colors.primary + '40',
  },
  syncBtnText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.primary },
  tabsOuter: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  tabsContent: { flexDirection: 'row', gap: Spacing.xs, paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm },
  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs + 2,
    borderRadius: Radius.pill, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  tabActive: { backgroundColor: Colors.primaryDim, borderColor: Colors.primary + '50' },
  tabLabel: { fontSize: Typography.size.xs, color: Colors.textSecondary },
  tabLabelActive: { color: Colors.primary, fontWeight: Typography.weight.semibold },
  tabBadge: {
    backgroundColor: Colors.danger, borderRadius: Radius.pill,
    paddingHorizontal: 5, paddingVertical: 1, minWidth: 16, alignItems: 'center',
  },
  tabBadgeText: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: '#fff' },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: Spacing.base, marginVertical: Spacing.sm,
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.surfaceBorder, height: 40,
  },
  searchInput: {
    flex: 1, fontSize: Typography.size.sm, color: Colors.textPrimary,
    paddingVertical: 0, paddingHorizontal: Spacing.xs, includeFontPadding: false,
  },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: Spacing.base },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, paddingHorizontal: Spacing.xl },
  emptyTitle: { fontSize: Typography.size.lg, fontWeight: Typography.weight.semibold, color: Colors.textSecondary },
  emptyText: { fontSize: Typography.size.sm, color: Colors.textTertiary, textAlign: 'center', lineHeight: 20 },
  syncLargeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.primary, borderRadius: Radius.pill,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
  },
  syncLargeBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },
});
