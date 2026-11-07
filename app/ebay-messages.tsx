// Shared inbox UI. All data operations and scoped state come from useEbayMessages.
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { useAlert } from '@/template';
import { useEbayMessages } from '@/hooks/useEbayMessages';
import { useApp } from '@/hooks/useApp';
import type { EbayMessage } from '@/services/ebayMessageService';
import { Colors, Spacing, Radius, Typography } from '@/constants/theme';
type FilterTab = 'unread' | 'all' | 'sent' | 'archived';
const filters: Array<{ id: FilterTab; label: string }> = [{ id: 'unread', label: 'Unread' }, { id: 'all', label: 'All' }, { id: 'sent', label: 'Sent' }, { id: 'archived', label: 'Archived' }];
interface MessageRowProps { message: EbayMessage; onOpen: (message: EbayMessage) => void; onRead: (id: string) => void; onArchive: (id: string) => void }
const MessageRow = memo(function MessageRow({ message, onOpen, onRead, onArchive }: MessageRowProps) {
  return <View style={[s.message, !message.isRead ? s.unread : null]}>
    <Pressable accessibilityLabel={`Open message from ${message.buyerUsername}`} onPress={() => onOpen(message)} style={({ pressed }) => [s.messageBody, pressed ? s.pressed : null]}>
      <View style={s.row}><Text style={s.buyer} numberOfLines={1}>{message.buyerUsername || 'eBay buyer'}</Text><Text style={s.meta}>{new Date(message.receivedAt).toLocaleDateString()}</Text></View>
      <Text style={s.subject} numberOfLines={2}>{message.subject || '(No subject)'}</Text>
      <Text style={s.body} numberOfLines={2}>{message.body}</Text>
      <Text style={s.meta}>{message.direction === 'outbound' ? 'Sent' : message.isReplied ? 'Replied' : 'Awaiting reply'}{message.ebayItemId ? ` · Item ${message.ebayItemId}` : ''}</Text>
    </Pressable>
    <View style={s.row}>
      {!message.isRead ? <Pressable accessibilityLabel="Mark message read" onPress={() => onRead(message.id)} style={({ pressed }) => [s.icon, pressed ? s.pressed : null]}><MaterialIcons name="mark-email-read" size={22} color={Colors.primary}/></Pressable> : null}
      <Pressable accessibilityLabel="Archive message" onPress={() => onArchive(message.id)} style={({ pressed }) => [s.icon, pressed ? s.pressed : null]}><MaterialIcons name="archive" size={22} color={Colors.textSecondary}/></Pressable>
    </View>
  </View>;
});
interface ReplyModalProps { message: EbayMessage | null; onClose: () => void }
function ReplyModal({ message, onClose }: ReplyModalProps) {
  const inbox = useEbayMessages(); const { showAlert } = useAlert();
  const [text, setText] = useState(message?.aiDraft ?? ''), [sending, setSending] = useState(false);
  useEffect(() => { setText(message?.aiDraft ?? ''); }, [message?.id]);
  const send = useCallback(() => {
    if (!message || !text.trim() || sending) return;
    const scope = inbox.scope;
    showAlert('Send reply?', 'This sends your reviewed text to the buyer using the existing eBay connection.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Send', onPress: async () => {
      if (!inbox.isCurrentScope(scope)) return;
      setSending(true);
      const result = await inbox.sendReply({ messageId: message.id, replyText: text.trim(), buyerUsername: message.buyerUsername, ebayItemId: message.ebayItemId, conversationId: message.conversationId });
      if (!inbox.isCurrentScope(scope)) return;
      setSending(false);
      if (result.error || !result.ebaySuccess) { showAlert('Reply not confirmed', result.error ?? 'Check the original conversation before sending again.'); return; }
      if (result.localSyncPending) showAlert('eBay confirmed the reply', 'Local message status needs a refresh. Do not send the reply again.');
      onClose();
    } }]);
  }, [message, text, sending, inbox, showAlert, onClose]);
  if (!message) return null;
  return <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <SafeAreaView edges={['top', 'bottom']} style={s.screen}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.fill}>
      <View style={s.header}><Text style={s.title}>Reply to {message.buyerUsername}</Text><Pressable accessibilityLabel="Close reply" disabled={sending} onPress={onClose} style={({ pressed }) => [s.icon, pressed ? s.pressed : null]}><MaterialIcons name="close" size={24} color={Colors.textPrimary}/></Pressable></View>
      <ScrollView style={s.fill} contentContainerStyle={s.replyContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={s.label}>BUYER MESSAGE</Text><Text style={s.subject}>{message.subject}</Text><Text selectable style={s.longBody}>{message.body}</Text>
        {message.ebayItemId ? <Text style={s.meta}>eBay item {message.ebayItemId}</Text> : null}
        <Pressable disabled={sending} onPress={() => setText(inbox.suggestReply(message))} style={({ pressed }) => [s.secondary, pressed ? s.pressed : null]}><MaterialIcons name="edit-note" size={22} color={Colors.primary}/><Text style={s.actionText}>Suggest reply text</Text></Pressable>
        <Text style={s.meta}>Suggested text is a template, not a verified order update. Review before sending.</Text>
        <Text style={s.label}>YOUR REPLY</Text><TextInput accessibilityLabel="Your reply to the buyer" multiline textAlignVertical="top" value={text} onChangeText={setText} editable={!sending} style={s.compose} placeholder="Write your reply" placeholderTextColor={Colors.textSecondary}/>
        <Text style={s.meta}>{text.length} characters · Sent securely through eBay</Text>
      </ScrollView>
      <Pressable accessibilityRole="button" disabled={sending || !text.trim()} onPress={send} style={({ pressed }) => [s.primary, pressed || sending || !text.trim() ? s.pressed : null]}>{sending ? <ActivityIndicator color={Colors.background}/> : <MaterialIcons name="send" size={22} color={Colors.background}/>}<Text style={s.primaryText}>{sending ? 'Sending…' : 'Send reply'}</Text></Pressable>
    </KeyboardAvoidingView></SafeAreaView>
  </Modal>;
}
function EbayMessagesContent() {
  const inbox = useEbayMessages(), app = useApp(), router = useRouter();
  const [activeTab, setActiveTab] = useState<FilterTab>('unread'), [search, setSearch] = useState(''), [reply, setReply] = useState<EbayMessage | null>(null), [refreshing, setRefreshing] = useState(false);
  useEffect(() => { void inbox.refresh(); }, [inbox.refresh]);
  const refresh = useCallback(async () => { setRefreshing(true); try { await inbox.refresh(); } finally { if (inbox.isCurrentScope(inbox.scope)) setRefreshing(false); } }, [inbox.refresh, inbox.isCurrentScope, inbox.scope]);
  const open = useCallback((message: EbayMessage) => { if (!inbox.isCurrentScope(inbox.scope)) return; if (!message.isRead) void inbox.markRead(message.id); setReply(message); }, [inbox]);
  const unread = useMemo(() => inbox.messages.filter(message => !message.isRead && !message.isArchived && message.direction === 'inbound').length, [inbox.messages]);
  const displayed = useMemo(() => inbox.messages.filter(message => {
    const selected = activeTab === 'unread' ? !message.isRead && !message.isArchived && message.direction === 'inbound' : activeTab === 'sent' ? message.direction === 'outbound' : activeTab === 'archived' ? message.isArchived : !message.isArchived;
    return selected && (!search.trim() || `${message.buyerUsername} ${message.subject} ${message.body}`.toLowerCase().includes(search.trim().toLowerCase()));
  }), [inbox.messages, activeTab, search]);
  return <SafeAreaView edges={['top', 'bottom']} style={s.screen}><StatusBar style="light"/><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.content}>
    <View style={s.header}><Pressable accessibilityLabel="Back" onPress={() => router.back()} style={({ pressed }) => [s.icon, pressed ? s.pressed : null]}><MaterialIcons name="arrow-back" size={24} color={Colors.primary}/></Pressable><View style={s.fill}><Text style={s.title}>Messages</Text><Text style={s.meta}>{app.activeNiche.shortName} · {unread} unread</Text></View><Pressable disabled={!inbox.ready || inbox.syncing} onPress={() => { void inbox.sync(); }} style={({ pressed }) => [s.secondary, pressed || inbox.syncing ? s.pressed : null]}>{inbox.syncing ? <ActivityIndicator color={Colors.primary}/> : <MaterialIcons name="sync" size={22} color={Colors.primary}/>}<Text style={s.actionText}>Sync</Text></Pressable></View>
    <View style={s.tabs}><FlatList horizontal data={filters} keyExtractor={item => item.id} showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabsContent} renderItem={({ item }) => <Pressable accessibilityState={{ selected: activeTab === item.id }} onPress={() => setActiveTab(item.id)} style={({ pressed }) => [s.chip, activeTab === item.id ? s.selected : null, pressed ? s.pressed : null]}><Text style={[s.chipText, activeTab === item.id ? s.selectedText : null]}>{item.label}</Text></Pressable>}/></View>
    <Text style={s.label}>SEARCH MESSAGES</Text><TextInput accessibilityLabel="Search messages in the active niche" style={s.search} value={search} onChangeText={setSearch} placeholder="Buyer, subject or message" placeholderTextColor={Colors.textSecondary}/>
    {inbox.error ? <View style={s.errorRow}><MaterialIcons name="error-outline" size={22} color={Colors.warning}/><Text accessibilityRole="alert" style={s.error}>{inbox.error}</Text><Pressable accessibilityLabel="Retry messages" onPress={() => { void inbox.refresh(); }} style={({ pressed }) => [s.icon, pressed ? s.pressed : null]}><MaterialIcons name="refresh" size={22} color={Colors.primary}/></Pressable></View> : null}
    {inbox.loading ? <View style={s.center}><ActivityIndicator color={Colors.primary}/><Text style={s.body}>Loading authorised messages…</Text></View> : <FlatList data={displayed} keyExtractor={item => item.id} showsVerticalScrollIndicator={false} contentContainerStyle={s.list} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.primary}/>} renderItem={({ item }) => <MessageRow message={item} onOpen={open} onRead={id => { void inbox.markRead(id); }} onArchive={id => { void inbox.archive(id); }}/>} ListEmptyComponent={<View style={s.center}><MaterialIcons name="mail-outline" size={32} color={Colors.textSecondary}/><Text style={s.subject}>{inbox.error ? 'Messages unavailable' : search ? 'No matching messages' : `No ${activeTab === 'all' ? '' : activeTab + ' '}messages`}</Text><Text style={s.body}>{inbox.error ? 'Retry the authorised inbox read.' : 'Sync retrieves linked conversations for this workspace, not unrelated seller inventory.'}</Text></View>}/>}
    <ReplyModal key={reply?.id ?? 'closed'} message={reply} onClose={() => setReply(null)}/>
  </KeyboardAvoidingView></SafeAreaView>;
}
export default function EbayMessagesScreen() { const inbox = useEbayMessages(); return <EbayMessagesContent key={inbox.scope}/>; }
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background }, fill: { flex: 1 }, content: { flex: 1, width: '100%', maxWidth: 960, alignSelf: 'center', paddingHorizontal: Spacing.base },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder }, title: { color: Colors.textPrimary, fontSize: Typography.size.lg, fontWeight: Typography.weight.bold, flexShrink: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }, meta: { color: Colors.textSecondary, fontSize: Typography.size.sm, lineHeight: 22, includeFontPadding: false }, body: { color: Colors.textSecondary, fontSize: Typography.size.base, lineHeight: 26, includeFontPadding: false }, longBody: { color: Colors.textPrimary, fontSize: Typography.size.base, lineHeight: 26, includeFontPadding: false },
  subject: { color: Colors.textPrimary, fontSize: Typography.size.base, fontWeight: Typography.weight.semibold, lineHeight: 26 }, buyer: { flex: 1, color: Colors.primary, fontSize: Typography.size.base, fontWeight: Typography.weight.semibold },
  icon: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.sm }, secondary: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.sm, borderRadius: Radius.md, backgroundColor: Colors.surface }, actionText: { color: Colors.primary, fontSize: Typography.size.base, fontWeight: Typography.weight.semibold }, pressed: { opacity: 0.65 },
  tabs: { height: 64 }, tabsContent: { alignItems: 'center', gap: Spacing.sm }, chip: { height: 48, paddingHorizontal: Spacing.base, borderRadius: Radius.pill, backgroundColor: Colors.surface, justifyContent: 'center' }, selected: { backgroundColor: Colors.primary }, chipText: { color: Colors.textSecondary, fontSize: Typography.size.base }, selectedText: { color: Colors.background, fontWeight: Typography.weight.semibold },
  label: { color: Colors.textSecondary, fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, marginVertical: Spacing.xs }, search: { minHeight: 48, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.surfaceBorder, backgroundColor: Colors.surface, paddingHorizontal: Spacing.md, color: Colors.textPrimary, fontSize: Typography.size.base, includeFontPadding: false },
  list: { gap: Spacing.sm, paddingVertical: Spacing.base, paddingBottom: Spacing.lg }, message: { borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.surfaceBorder, padding: Spacing.md, backgroundColor: Colors.surface, gap: Spacing.sm }, unread: { borderColor: Colors.primary }, messageBody: { gap: Spacing.xs }, center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.lg }, errorRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }, error: { flex: 1, color: Colors.warning, fontSize: Typography.size.base, lineHeight: 26 },
  replyContent: { padding: Spacing.base, gap: Spacing.sm }, compose: { minHeight: 180, padding: Spacing.base, borderWidth: 1, borderColor: Colors.surfaceBorder, borderRadius: Radius.md, backgroundColor: Colors.surface, color: Colors.textPrimary, fontSize: Typography.size.base, lineHeight: 26, includeFontPadding: false }, primary: { minHeight: 52, margin: Spacing.base, padding: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.primary, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: Spacing.sm }, primaryText: { color: Colors.background, fontSize: Typography.size.base, fontWeight: Typography.weight.bold },
});
