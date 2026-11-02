import { memo, useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useAlert } from '@/template';
import { useEbayMessages } from '@/hooks/useEbayMessages';
import type { EbayMessage, EbayReplyInput, EbayReplyResult } from '@/services/ebayMessageService';
import { Colors, Spacing, Radius, Typography } from '@/constants/theme';

type Filter = 'unread' | 'all' | 'sent' | 'archived';
const filters: Array<{ id: Filter; label: string }> = [{ id: 'unread', label: 'Unread' }, { id: 'all', label: 'All' }, { id: 'sent', label: 'Sent' }, { id: 'archived', label: 'Archived' }];
interface MessageRowProps { message: EbayMessage; onOpen: (message: EbayMessage) => void; onArchive: (id: string) => void }
const MessageRow = memo(function MessageRow({ message, onOpen, onArchive }: MessageRowProps) {
  return <View style={[s.messageCard, !message.isRead ? s.unread : null]}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Open message from ${message.buyerUsername}`} onPress={() => onOpen(message)} style={({ pressed }) => [s.messageOpen, pressed ? s.pressed : null]}>
      <MaterialIcons name={message.direction === 'outbound' ? 'reply' : 'mail-outline'} size={24} color={message.isRead ? Colors.textSecondary : Colors.primary}/>
      <View style={s.flex}><Text style={s.cardTitle}>{message.buyerUsername || 'eBay member'}</Text><Text style={s.body} numberOfLines={1}>{message.subject || 'No subject'}</Text><Text style={s.muted} numberOfLines={2}>{message.body}</Text><Text style={s.meta}>{message.isReplied ? 'Reply confirmed' : message.direction === 'outbound' ? 'Sent' : 'Incoming'} · {new Date(message.receivedAt).toLocaleDateString()}</Text></View>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel="Archive message in SWISH" onPress={() => onArchive(message.id)} style={({ pressed }) => [s.icon, pressed ? s.pressed : null]}><MaterialIcons name="archive" size={22} color={Colors.textSecondary}/></Pressable>
  </View>;
});
interface ReplyComposerProps { message: EbayMessage | null; onClose: () => void; sendReply: (input: EbayReplyInput) => Promise<EbayReplyResult> }
function ReplyComposer({ message, onClose, sendReply }: ReplyComposerProps) {
  const [text, setText] = useState(''); const [sending, setSending] = useState(false);
  const { showAlert } = useAlert();
  const send = useCallback(() => {
    if (!message || sending || !text.trim()) return;
    showAlert('Send reply through eBay?', 'Only a confirmed eBay acknowledgement counts as sent. If the response is lost, check eBay before trying again.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Send', onPress: async () => {
      setSending(true);
      try {
        const result = await sendReply({ messageId: message.id, replyText: text.trim(), buyerUsername: message.buyerUsername, ebayItemId: message.ebayItemId, conversationId: message.conversationId });
        if (result.error || !result.ebaySuccess) { showAlert('Reply not confirmed', result.error ?? 'Check the conversation on eBay before retrying.'); return; }
        if (result.localSyncPending) showAlert('eBay confirmed the reply', result.message);
        setText(''); onClose();
      } finally { setSending(false); }
    } }]);
  }, [message, sending, text, sendReply, showAlert, onClose]);
  if (!message) return null;
  return <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { if (!sending) onClose(); }}>
    <SafeAreaView edges={['top', 'bottom']} style={s.screen}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.screen}>
      <FlatList data={[]} renderItem={null} keyboardShouldPersistTaps="handled" contentContainerStyle={s.content} ListHeaderComponent={<View style={s.block}>
        <View style={s.row}><View style={s.flex}><Text style={s.eyebrow}>EBAY CONVERSATION</Text><Text style={s.title}>Reply to {message.buyerUsername}</Text></View><Pressable disabled={sending} onPress={onClose} accessibilityLabel="Close reply" style={({ pressed }) => [s.icon, pressed ? s.pressed : null]}><MaterialIcons name="close" size={24} color={Colors.textPrimary}/></Pressable></View>
        <View style={s.hero}><Text style={s.cardTitle}>{message.subject || 'Buyer message'}</Text><Text style={s.body}>{message.body}</Text><Text style={s.muted}>{message.ebayItemId ? `eBay item ${message.ebayItemId}` : 'This message has no eBay item ID. Review/reply on eBay.'}</Text></View>
        <Text style={s.label}>Your reply</Text><TextInput accessibilityLabel="Reply text" value={text} onChangeText={setText} multiline maxLength={4000} editable={!sending} textAlignVertical="top" placeholder="Write a factual reply based on this conversation" placeholderTextColor={Colors.textSecondary} style={s.compose}/>
        <Text style={s.muted}>{text.length} / 4000 characters</Text>
        <Pressable disabled={sending} accessibilityRole="button" onPress={() => setText('Thank you for your message. I will review your query and get back to you.\n\nKind regards')} style={({ pressed }) => [s.secondary, pressed ? s.pressed : null]}><Text style={s.linkText}>Use acknowledgement template</Text></Pressable>
        <Text style={s.muted}>This is a local reply template, not AI research. Verify every claim before sending. SWISH does not assume an order was processed or dispatched.</Text>
        <Pressable disabled={sending || !text.trim() || !message.ebayItemId} accessibilityRole="button" onPress={send} style={({ pressed }) => [s.primary, sending || !text.trim() || !message.ebayItemId || pressed ? s.pressed : null]}>{sending ? <ActivityIndicator color={Colors.background}/> : <MaterialIcons name="send" size={20} color={Colors.background}/>}<Text style={s.primaryText}>{sending ? 'Awaiting eBay confirmation' : 'Send reply'}</Text></Pressable>
      </View>}/>
    </KeyboardAvoidingView></SafeAreaView>
  </Modal>;
}

export default function EbayMessagesScreen() {
  const router = useRouter(); const inbox = useEbayMessages();
  const [filter, setFilter] = useState<Filter>('unread'); const [search, setSearch] = useState(''); const [selected, setSelected] = useState<EbayMessage | null>(null);
  const unread = inbox.messages.filter(message => !message.isRead && !message.isArchived && message.direction === 'inbound').length;
  const displayed = useMemo(() => inbox.messages.filter(message => {
    if (filter === 'unread' && (message.isRead || message.isArchived || message.direction !== 'inbound')) return false;
    if (filter === 'sent' && message.direction !== 'outbound') return false;
    if (filter === 'archived' && !message.isArchived) return false;
    if (filter === 'all' && message.isArchived) return false;
    const query = search.trim().toLowerCase();
    return !query || `${message.buyerUsername} ${message.subject} ${message.body}`.toLowerCase().includes(query);
  }), [inbox.messages, filter, search]);
  const open = useCallback((message: EbayMessage) => { if (!message.isRead) inbox.handleMarkRead(message.id); setSelected(message); }, [inbox.handleMarkRead]);
  const close = useCallback(() => setSelected(null), []);
  return <SafeAreaView edges={['top', 'bottom']} style={s.screen}><StatusBar style="light"/><KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <FlatList data={displayed} keyExtractor={message => message.id} renderItem={({ item }) => <MessageRow message={item} onOpen={open} onArchive={inbox.handleArchive}/>} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={inbox.loading} onRefresh={() => { void inbox.load(); }} tintColor={Colors.primary}/>} ListHeaderComponent={<View style={s.block}>
      <View style={s.row}><Pressable accessibilityLabel="Back" onPress={() => router.back()} style={({ pressed }) => [s.icon, pressed ? s.pressed : null]}><MaterialIcons name="arrow-back" size={24} color={Colors.textPrimary}/></Pressable><View style={s.flex}><Text style={s.eyebrow}>SWISH / EBAY OPERATIONS</Text><Text style={s.title}>Messages</Text></View></View>
      <View style={s.hero}><View style={s.row}><MaterialIcons name="forum" size={28} color={Colors.primary}/><Text style={s.cardTitle}>{unread} unread conversations</Text></View><Text style={s.body}>Your business inbox. Read and archive changes are shown only after SWISH saves them; replies require eBay confirmation.</Text><Text style={s.muted}>Sync imports provider summaries. A missing full message body is disclosed, not invented. Latest 200 stored messages.</Text>
        <Pressable onPress={() => { void inbox.handleSync(); }} disabled={inbox.syncing} style={({ pressed }) => [s.primary, inbox.syncing || pressed ? s.pressed : null]}>{inbox.syncing ? <ActivityIndicator color={Colors.background}/> : <MaterialIcons name="sync" size={22} color={Colors.background}/>}<Text style={s.primaryText}>{inbox.syncing ? 'Syncing messages' : 'Sync eBay messages'}</Text></Pressable>
      </View>
      {inbox.error ? <View style={s.error}><MaterialIcons name="error-outline" size={22} color={Colors.danger}/><Text style={[s.body, s.flex]}>{inbox.error}</Text></View> : null}
      <View style={s.filterRail}><FlatList horizontal data={filters} keyExtractor={item => item.id} showsHorizontalScrollIndicator={false} contentContainerStyle={s.filters} renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityState={{ selected: filter === item.id }} onPress={() => setFilter(item.id)} style={({ pressed }) => [s.chip, filter === item.id ? s.selected : null, pressed ? s.pressed : null]}><Text style={s.body}>{item.label}</Text></Pressable>}/></View>
      <Text style={s.label}>Search conversations</Text><TextInput accessibilityLabel="Search conversations" value={search} onChangeText={setSearch} placeholder="Buyer, subject or message" placeholderTextColor={Colors.textSecondary} style={s.input}/>
      <Text style={s.muted}>{filters.find(item => item.id === filter)?.label} · {displayed.length} messages</Text>
    </View>} ListEmptyComponent={<View style={s.empty}>{inbox.loading ? <ActivityIndicator color={Colors.primary}/> : <><MaterialIcons name="mail-outline" size={40} color={Colors.textSecondary}/><Text style={s.cardTitle}>{inbox.error ? 'Messages are unavailable' : 'No messages in this view'}</Text><Text style={s.body}>{inbox.error ? 'Retry loading or check the eBay connection.' : 'Change the filter or sync the connected eBay account.'}</Text></>}</View>}/>
    <ReplyComposer key={selected?.id ?? 'closed'} message={selected} onClose={close} sendReply={inbox.reply}/>
  </KeyboardAvoidingView></SafeAreaView>;
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background }, content: { padding: Spacing.base, paddingBottom: Spacing.xl, gap: Spacing.md, width: '100%', maxWidth: 960, alignSelf: 'center' },
  block: { gap: Spacing.md }, row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md }, flex: { flex: 1 }, icon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.md, backgroundColor: Colors.surfaceHighlight },
  eyebrow: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.primary, letterSpacing: 1 }, title: { fontSize: Typography.size.lg, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  hero: { padding: Spacing.base, gap: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.primary },
  cardTitle: { fontSize: Typography.size.base, fontWeight: Typography.weight.semibold, color: Colors.textPrimary, lineHeight: 26 }, body: { fontSize: Typography.size.base, color: Colors.textSecondary, lineHeight: 26, includeFontPadding: false }, muted: { fontSize: Typography.size.sm, color: Colors.textSecondary, lineHeight: 22 }, meta: { fontSize: Typography.size.xs, color: Colors.primary, lineHeight: 20 },
  primary: { minHeight: 48, padding: Spacing.md, backgroundColor: Colors.primary, borderRadius: Radius.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm }, primaryText: { fontSize: Typography.size.base, fontWeight: Typography.weight.semibold, color: Colors.background }, secondary: { minHeight: 48, padding: Spacing.md, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, justifyContent: 'center' }, linkText: { fontSize: Typography.size.base, color: Colors.primary },
  label: { fontSize: Typography.size.base, color: Colors.textPrimary, fontWeight: Typography.weight.semibold }, input: { minHeight: 48, padding: Spacing.md, fontSize: Typography.size.base, color: Colors.textPrimary, backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.surfaceBorder }, compose: { minHeight: 180, padding: Spacing.base, fontSize: Typography.size.base, lineHeight: 26, color: Colors.textPrimary, borderRadius: Radius.md, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder },
  filterRail: { minHeight: 56 }, filters: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xs }, chip: { height: 48, borderRadius: Radius.pill, backgroundColor: Colors.surface, paddingHorizontal: Spacing.base, justifyContent: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder }, selected: { backgroundColor: Colors.primaryDim, borderColor: Colors.primary },
  messageCard: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center', padding: Spacing.md, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceBorder, backgroundColor: Colors.surface }, messageOpen: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, minHeight: 48 }, unread: { borderColor: Colors.primary }, error: { flexDirection: 'row', gap: Spacing.sm, padding: Spacing.md, backgroundColor: Colors.dangerDim, borderRadius: Radius.md }, empty: { alignItems: 'center', padding: Spacing.xl, gap: Spacing.md }, pressed: { opacity: 0.65 },
});
