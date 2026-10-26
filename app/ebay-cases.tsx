// SWISH — eBay Returns & Cases Management
// Handles returns, INR cases, SNAD disputes.
// Uses ebay_returns and ebay_cases tables.
// Integrates with eBay Post-Order API — sync_returns via swish-ebay-post-order edge function.

import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable,
  ActivityIndicator, RefreshControl, ScrollView, Modal,
  TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams, useNavigation } from 'expo-router';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { getSupabaseClient } from '@/template';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { useAlert } from '@/template';

// ── Types ─────────────────────────────────────────────────────────────────────

type SectionType = 'returns' | 'cases';

interface SyncStatus {
  syncing: boolean;
  lastSyncAt: string | null;
  lastFetched: number;
  lastImported: number;
  lastUpdated: number;
  error: string | null;
  requiresApproval: boolean;
}

interface EbayReturn {
  id: string;
  ebayReturnId?: string;
  ebayOrderId?: string;
  buyerUsername: string;
  reason: string;
  comments: string;
  status: string; // open | awaiting_seller | awaiting_buyer | closed | escalated
  refundAmount?: number;
  sellerResponse?: string;
  resolution?: string;
  deadline?: string;
  createdAt: string;
}

interface EbayCase {
  id: string;
  ebayCaseId?: string;
  ebayOrderId?: string;
  caseType?: string; // INR | SNAD | return
  buyerUsername: string;
  status: string; // open | awaiting_seller | awaiting_buyer | escalated | resolved | closed
  sellerResponse?: string;
  escalated: boolean;
  deadline?: string;
  resolution?: string;
  refundAmount?: number;
  createdAt: string;
}

// ── Deadline helper ──────────────────────────────────────────────────────────

function deadlineBadge(deadline?: string): { label: string; color: string; urgency: 'critical' | 'warning' | 'ok' } | null {
  if (!deadline) return null;
  const msLeft = new Date(deadline).getTime() - Date.now();
  const daysLeft = msLeft / (1000 * 60 * 60 * 24);
  if (daysLeft < 0) return { label: 'OVERDUE', color: Colors.danger, urgency: 'critical' };
  if (daysLeft < 1) return { label: `${Math.floor(msLeft / (1000 * 60 * 60))}h left`, color: Colors.danger, urgency: 'critical' };
  if (daysLeft < 3) return { label: `${Math.floor(daysLeft)}d left`, color: Colors.danger, urgency: 'critical' };
  if (daysLeft < 7) return { label: `${Math.floor(daysLeft)}d left`, color: Colors.warning, urgency: 'warning' };
  return { label: `${Math.floor(daysLeft)}d left`, color: Colors.textTertiary, urgency: 'ok' };
}

const STATUS_COLORS: Record<string, string> = {
  open: Colors.warning,
  awaiting_seller: Colors.danger,
  awaiting_buyer: Colors.primary,
  escalated: Colors.danger,
  resolved: Colors.success,
  closed: Colors.textTertiary,
};

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  awaiting_seller: '⚠ Needs Your Response',
  awaiting_buyer: 'Awaiting Buyer',
  escalated: 'Escalated',
  resolved: 'Resolved',
  closed: 'Closed',
};

// ── Return Row ────────────────────────────────────────────────────────────────

function ReturnRow({
  item,
  onPress,
  onRespond,
}: {
  item: EbayReturn;
  onPress: (r: EbayReturn) => void;
  onRespond: (r: EbayReturn) => void;
}) {
  const statusColor = STATUS_COLORS[item.status] ?? Colors.textTertiary;
  const statusLabel = STATUS_LABELS[item.status] ?? item.status;
  const dl = deadlineBadge(item.deadline);

  return (
    <Pressable
      onPress={() => onPress(item)}
      style={({ pressed }) => [
        rr.card,
        item.status === 'awaiting_seller' && rr.cardUrgent,
        dl?.urgency === 'critical' && rr.cardCritical,
        pressed && { opacity: 0.85 },
      ]}
    >
      <View style={[rr.stripe, { backgroundColor: dl?.urgency === 'critical' ? Colors.danger : statusColor }]} />
      <View style={rr.content}>
        <View style={rr.topRow}>
          <View style={[rr.caseTypeBadge, { backgroundColor: Colors.warningDim }]}>
            <MaterialIcons name="assignment-return" size={10} color={Colors.warning} />
            <Text style={[rr.caseTypeText, { color: Colors.warning }]}>Return</Text>
          </View>
          <View style={[rr.statusPill, { backgroundColor: statusColor + '20' }]}>
            <View style={[rr.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[rr.statusText, { color: statusColor }]}>{statusLabel}</Text>
          </View>
          {dl ? (
            <View style={[rr.deadlineBadge, { backgroundColor: dl.color + '20', borderColor: dl.color + '40' }]}>
              <MaterialIcons name={dl.urgency === 'critical' ? 'alarm' : 'schedule'} size={9} color={dl.color} />
              <Text style={[rr.deadlineText, { color: dl.color }]}>{dl.label}</Text>
            </View>
          ) : null}
        </View>

        <Text style={rr.buyer}>{item.buyerUsername || 'eBay Buyer'}</Text>
        <Text style={rr.reason}>{item.reason || 'No reason specified'}</Text>
        {item.comments ? (
          <Text style={rr.comments} numberOfLines={2}>{item.comments}</Text>
        ) : null}
        {item.refundAmount ? (
          <Text style={rr.refundAmount}>Refund: £{item.refundAmount.toFixed(2)}</Text>
        ) : null}
        {item.deadline ? (
          <Text style={[rr.deadlineDate, dl?.urgency === 'critical' && { color: Colors.danger, fontWeight: Typography.weight.bold }]}>
            Deadline: {new Date(item.deadline).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
          </Text>
        ) : null}

        {/* Quick action row */}
        <View style={rr.actionRow}>
          <Pressable
            onPress={(e) => { e.stopPropagation?.(); onRespond(item); }}
            style={[rr.respondBtn, dl?.urgency === 'critical' && { backgroundColor: Colors.danger, borderColor: Colors.danger }]}
            hitSlop={4}
          >
            <MaterialIcons name="reply" size={11} color={dl?.urgency === 'critical' ? Colors.background : Colors.primary} />
            <Text style={[rr.respondBtnText, dl?.urgency === 'critical' && { color: Colors.background }]}>Respond</Text>
          </Pressable>
          <Text style={rr.date}>{new Date(item.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
        </View>
      </View>
      <MaterialIcons name="chevron-right" size={16} color={Colors.textTertiary} />
    </Pressable>
  );
}

// ── Case Row ──────────────────────────────────────────────────────────────────

function CaseRow({
  item,
  onPress,
  onRespond,
}: {
  item: EbayCase;
  onPress: (c: EbayCase) => void;
  onRespond: (c: EbayCase) => void;
}) {
  const statusColor = STATUS_COLORS[item.status] ?? Colors.textTertiary;
  const statusLabel = STATUS_LABELS[item.status] ?? item.status;
  const caseTypeLabel = item.caseType === 'INR' ? 'Item Not Received' : item.caseType === 'SNAD' ? 'Not As Described' : item.caseType ?? 'Case';
  const dl = deadlineBadge(item.deadline);

  return (
    <Pressable
      onPress={() => onPress(item)}
      style={({ pressed }) => [
        rr.card,
        item.status === 'awaiting_seller' && rr.cardUrgent,
        dl?.urgency === 'critical' && rr.cardCritical,
        pressed && { opacity: 0.85 },
      ]}
    >
      <View style={[rr.stripe, { backgroundColor: dl?.urgency === 'critical' ? Colors.danger : statusColor }]} />
      <View style={rr.content}>
        <View style={rr.topRow}>
          <View style={[rr.caseTypeBadge, {
            backgroundColor: item.caseType === 'INR' ? Colors.infoDim : Colors.dangerDim,
          }]}>
            <MaterialIcons
              name={item.caseType === 'INR' ? 'search' : 'report-problem'}
              size={10}
              color={item.caseType === 'INR' ? Colors.info : Colors.danger}
            />
            <Text style={[rr.caseTypeText, { color: item.caseType === 'INR' ? Colors.info : Colors.danger }]}>
              {caseTypeLabel}
            </Text>
          </View>
          <View style={[rr.statusPill, { backgroundColor: statusColor + '20' }]}>
            <View style={[rr.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[rr.statusText, { color: statusColor }]}>{statusLabel}</Text>
          </View>
          {item.escalated ? (
            <View style={rr.escalatedBadge}>
              <MaterialIcons name="gavel" size={9} color={Colors.danger} />
              <Text style={rr.escalatedText}>Escalated</Text>
            </View>
          ) : null}
          {dl ? (
            <View style={[rr.deadlineBadge, { backgroundColor: dl.color + '20', borderColor: dl.color + '40' }]}>
              <MaterialIcons name={dl.urgency === 'critical' ? 'alarm' : 'schedule'} size={9} color={dl.color} />
              <Text style={[rr.deadlineText, { color: dl.color }]}>{dl.label}</Text>
            </View>
          ) : null}
        </View>
        <Text style={rr.buyer}>{item.buyerUsername || 'eBay Buyer'}</Text>
        {item.sellerResponse ? (
          <Text style={rr.reason} numberOfLines={1}>Response: {item.sellerResponse}</Text>
        ) : (
          <Text style={[rr.reason, { color: Colors.warning }]}>No response provided yet</Text>
        )}
        {item.deadline ? (
          <Text style={[rr.deadlineDate, dl?.urgency === 'critical' && { color: Colors.danger, fontWeight: Typography.weight.bold }]}>
            Deadline: {new Date(item.deadline).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
          </Text>
        ) : null}
        <View style={rr.actionRow}>
          <Pressable
            onPress={(e) => { e.stopPropagation?.(); onRespond(item); }}
            style={[rr.respondBtn, dl?.urgency === 'critical' && { backgroundColor: Colors.danger, borderColor: Colors.danger }]}
            hitSlop={4}
          >
            <MaterialIcons name="reply" size={11} color={dl?.urgency === 'critical' ? Colors.background : Colors.primary} />
            <Text style={[rr.respondBtnText, dl?.urgency === 'critical' && { color: Colors.background }]}>Respond</Text>
          </Pressable>
          <Text style={rr.date}>{new Date(item.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
        </View>
      </View>
      <MaterialIcons name="chevron-right" size={16} color={Colors.textTertiary} />
    </Pressable>
  );
}

const rr = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 0,
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    overflow: 'hidden', borderWidth: 1, borderColor: Colors.surfaceBorder, ...Shadow.sm,
  },
  cardUrgent: { borderColor: Colors.danger + '60' },
  cardCritical: { borderColor: Colors.danger, borderWidth: 1.5 },
  stripe: { width: 4, alignSelf: 'stretch', flexShrink: 0 },
  content: { flex: 1, padding: Spacing.md, gap: 4 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  caseTypeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderRadius: Radius.pill, paddingHorizontal: 6, paddingVertical: 3,
  },
  caseTypeText: { fontSize: 9, fontWeight: Typography.weight.bold },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderRadius: Radius.pill, paddingHorizontal: 6, paddingVertical: 3,
  },
  statusDot: { width: 5, height: 5, borderRadius: 3 },
  statusText: { fontSize: 9, fontWeight: Typography.weight.bold },
  escalatedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.dangerDim, borderRadius: Radius.pill, paddingHorizontal: 6, paddingVertical: 2,
  },
  escalatedText: { fontSize: 9, color: Colors.danger, fontWeight: Typography.weight.bold },
  deadlineBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderRadius: Radius.pill, paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 1,
  },
  deadlineText: { fontSize: 9, fontWeight: Typography.weight.bold },
  buyer: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary },
  reason: { fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 17 },
  comments: { fontSize: Typography.size.xs, color: Colors.textTertiary, lineHeight: 16, fontStyle: 'italic' as const },
  refundAmount: { fontSize: Typography.size.xs, color: Colors.gold, fontWeight: Typography.weight.semibold },
  deadlineDate: { fontSize: 10, color: Colors.warning },
  date: { fontSize: 9, color: Colors.textTertiary },
  actionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  respondBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.primaryDim, borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm, paddingVertical: 4,
    borderWidth: 1, borderColor: Colors.primary + '50',
  },
  respondBtnText: { fontSize: 10, color: Colors.primary, fontWeight: Typography.weight.bold },
});

// ── Respond Modal ─────────────────────────────────────────────────────────────
// Pre-filled message composer that opens when tapping 'Respond' on any return/case.

function RespondModal({
  visible,
  type,
  returnItem,
  caseItem,
  onClose,
  onSaved,
  tenantId,
  showAlert,
}: {
  visible: boolean;
  type: 'return' | 'case';
  returnItem: EbayReturn | null;
  caseItem: EbayCase | null;
  onClose: () => void;
  onSaved: () => void;
  tenantId: string;
  showAlert: (t: string, m?: string, b?: any[]) => void;
}) {
  const item = returnItem ?? caseItem;
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  // Pre-fill message when item changes
  useEffect(() => {
    if (!visible || !item) return;
    const existing = returnItem?.sellerResponse ?? caseItem?.sellerResponse ?? '';
    if (existing) {
      setMessage(existing);
      return;
    }
    // Build a contextual template
    const buyer = item.buyerUsername || 'buyer';
    if (type === 'return' && returnItem) {
      const reason = returnItem.reason || 'your return request';
      setMessage(
        `Hi ${buyer},\n\nThank you for getting in touch regarding ${reason}. I'm sorry to hear there has been an issue with your order.\n\nI'd like to resolve this as quickly as possible for you. Please [describe next steps: e.g. return the item / provide photos / accept a refund].\n\nKind regards`
      );
    } else if (type === 'case' && caseItem) {
      const caseType = caseItem.caseType === 'INR' ? 'Item Not Received' : caseItem.caseType === 'SNAD' ? 'Item Not As Described' : 'your case';
      setMessage(
        `Hi ${buyer},\n\nThank you for opening a case regarding ${caseType}. I take all disputes seriously and want to resolve this promptly.\n\nCould you please [provide tracking / share photos / confirm your address]? I will respond as soon as possible.\n\nKind regards`
      );
    }
  }, [visible, item?.id]);

  const handleSave = async () => {
    if (!message.trim()) { showAlert('Empty', 'Write a response before saving.'); return; }
    if (!item) return;
    setSaving(true);
    const supabase = getSupabaseClient();
    const table = type === 'return' ? 'ebay_returns' : 'ebay_cases';
    await supabase.from(table).update({
      seller_response: message.trim(),
      status: 'awaiting_buyer',
      updated_at: new Date().toISOString(),
    }).eq('id', item.id);
    setSaving(false);
    showAlert(
      'Response Saved',
      'Your response has been recorded in SWISH. To send it to the buyer, submit via eBay Seller Hub → Returns / Cases.',
    );
    onSaved();
    onClose();
  };

  if (!item) return null;
  const dl = deadlineBadge(item.deadline);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: Colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {/* Header */}
        <View style={rm.header}>
          <Pressable onPress={onClose} style={rm.closeBtn} hitSlop={8}>
            <MaterialIcons name="close" size={18} color={Colors.textSecondary} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={rm.title}>Draft Response</Text>
            <Text style={rm.sub} numberOfLines={1}>
              {item.buyerUsername || 'eBay Buyer'}
              {type === 'return' && returnItem?.reason ? ` · ${returnItem.reason}` : ''}
            </Text>
          </View>
          {dl?.urgency === 'critical' ? (
            <View style={[rm.urgentBadge]}>
              <MaterialIcons name="alarm" size={11} color={Colors.background} />
              <Text style={rm.urgentText}>{dl.label}</Text>
            </View>
          ) : null}
        </View>

        <ScrollView contentContainerStyle={{ padding: Spacing.base, gap: Spacing.md, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
          {/* Case context card */}
          <View style={rm.contextCard}>
            <View style={rm.contextRow}>
              <MaterialIcons name={type === 'return' ? 'assignment-return' : 'gavel'} size={13} color={type === 'return' ? Colors.warning : Colors.danger} />
              <Text style={rm.contextType}>
                {type === 'return' ? 'Return Request' : `Case · ${caseItem?.caseType === 'INR' ? 'Item Not Received' : caseItem?.caseType === 'SNAD' ? 'Not As Described' : 'Dispute'}`}
              </Text>
              <View style={[rm.statusPill, { backgroundColor: (STATUS_COLORS[item.status] ?? Colors.textTertiary) + '20' }]}>
                <Text style={[rm.statusText, { color: STATUS_COLORS[item.status] ?? Colors.textTertiary }]}>
                  {STATUS_LABELS[item.status] ?? item.status}
                </Text>
              </View>
            </View>
            {item.deadline ? (
              <View style={[rm.deadlineRow, dl?.urgency === 'critical' && rm.deadlineRowUrgent]}>
                <MaterialIcons name="alarm" size={12} color={dl?.color ?? Colors.warning} />
                <Text style={[rm.deadlineText, { color: dl?.color ?? Colors.warning }]}>
                  Response deadline: {new Date(item.deadline).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
                </Text>
                {dl ? <Text style={[rm.deadlineBadge, { color: dl.color }]}>{dl.label}</Text> : null}
              </View>
            ) : null}
            {type === 'return' && returnItem?.comments ? (
              <View style={rm.buyerMessage}>
                <Text style={rm.buyerMessageLabel}>BUYER SAID</Text>
                <Text style={rm.buyerMessageText}>{returnItem.comments}</Text>
              </View>
            ) : null}
          </View>

          {/* Message composer */}
          <View style={rm.field}>
            <Text style={rm.fieldLabel}>YOUR RESPONSE</Text>
            <TextInput
              style={rm.textInput}
              value={message}
              onChangeText={setMessage}
              multiline
              textAlignVertical="top"
              placeholder="Write your response to the buyer..."
              placeholderTextColor={Colors.textTertiary}
              autoFocus
            />
            <Text style={rm.charCount}>{message.length} characters</Text>
          </View>

          {/* Suggested responses */}
          <View style={rm.suggestionsSection}>
            <Text style={rm.suggestionsLabel}>QUICK INSERTS</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={rm.suggestionsRow}>
              {[
                { label: 'Tracking Info', text: 'I can confirm your item was dispatched on [DATE] with tracking number [TRACKING]. Please allow [X] working days for delivery.' },
                { label: 'Accept Return', text: 'I accept your return request. Please return the item in its original condition and I will issue a full refund upon receipt.' },
                { label: 'Issue Refund', text: 'I have processed a full refund of £[AMOUNT] which should appear in your account within 3–5 working days.' },
                { label: 'Request Photos', text: 'Could you please send photos showing the issue? This will help me resolve your case as quickly as possible.' },
                { label: 'Apology', text: "I sincerely apologise for any inconvenience caused. I take great pride in my listings and I want to make this right for you." },
              ].map(s => (
                <Pressable
                  key={s.label}
                  onPress={() => setMessage(prev => prev ? prev + '\n\n' + s.text : s.text)}
                  style={rm.suggestionChip}
                >
                  <MaterialIcons name="add" size={10} color={Colors.primary} />
                  <Text style={rm.suggestionChipText}>{s.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          {/* eBay note */}
          <View style={rm.noteCard}>
            <MaterialIcons name="info-outline" size={12} color={Colors.textTertiary} />
            <Text style={rm.noteText}>
              SWISH saves your response locally. To send it to the buyer via eBay, open the case in eBay Seller Hub and submit the saved text.
            </Text>
          </View>

          {/* Save button */}
          <Pressable
            onPress={handleSave}
            disabled={saving || !message.trim()}
            style={[rm.saveBtn, (!message.trim() || saving) && { opacity: 0.5 }]}
          >
            {saving
              ? <ActivityIndicator size="small" color={Colors.background} style={{ width: 16, height: 16 }} />
              : <MaterialIcons name="save" size={16} color={Colors.background} />
            }
            <Text style={rm.saveBtnText}>{saving ? 'Saving...' : 'Save Response'}</Text>
          </Pressable>
        </ScrollView>
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
  title: { fontSize: Typography.size.md, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  sub: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 1 },
  urgentBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.danger, borderRadius: Radius.pill,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  urgentText: { fontSize: 10, fontWeight: Typography.weight.extrabold, color: Colors.background },
  contextCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    padding: Spacing.md, gap: Spacing.sm,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  contextRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  contextType: { flex: 1, fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary },
  statusPill: { borderRadius: Radius.pill, paddingHorizontal: 6, paddingVertical: 2 },
  statusText: { fontSize: 9, fontWeight: Typography.weight.bold },
  deadlineRow: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.warningDim, borderRadius: Radius.md, padding: Spacing.sm,
    borderWidth: 1, borderColor: Colors.warning + '30',
  },
  deadlineRowUrgent: {
    backgroundColor: Colors.dangerDim, borderColor: Colors.danger + '40',
  },
  deadlineText: { flex: 1, fontSize: Typography.size.xs, lineHeight: 16 },
  deadlineBadge: { fontSize: 9, fontWeight: Typography.weight.extrabold },
  buyerMessage: {
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md,
    padding: Spacing.sm, gap: 4, borderLeftWidth: 3, borderLeftColor: Colors.warning,
  },
  buyerMessageLabel: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary, letterSpacing: 0.4 },
  buyerMessageText: { fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 16, fontStyle: 'italic' as const },
  field: { gap: 5 },
  fieldLabel: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary, letterSpacing: 0.5 },
  textInput: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
    fontSize: Typography.size.sm, color: Colors.textPrimary, lineHeight: 22,
    minHeight: 160,
  },
  charCount: { fontSize: 9, color: Colors.textTertiary, textAlign: 'right' as const },
  suggestionsSection: { gap: 5 },
  suggestionsLabel: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary, letterSpacing: 0.4 },
  suggestionsRow: { flexDirection: 'row', gap: Spacing.xs, paddingVertical: 2 },
  suggestionChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.primaryDim, borderRadius: Radius.pill,
    paddingHorizontal: Spacing.sm, paddingVertical: 5,
    borderWidth: 1, borderColor: Colors.primary + '40',
  },
  suggestionChipText: { fontSize: 10, color: Colors.primary, fontWeight: Typography.weight.semibold },
  noteCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, padding: Spacing.sm,
  },
  noteText: { flex: 1, fontSize: 10, color: Colors.textTertiary, lineHeight: 14 },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: Spacing.base,
  },
  saveBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },
});

// ── Detail Modal ──────────────────────────────────────────────────────────────

function DetailModal({
  visible,
  type,
  returnItem,
  caseItem,
  onClose,
  onUpdate,
  tenantId,
  showAlert,
}: {
  visible: boolean;
  type: 'return' | 'case';
  returnItem: EbayReturn | null;
  caseItem: EbayCase | null;
  onClose: () => void;
  onUpdate: () => void;
  tenantId: string;
  showAlert: (t: string, m?: string, b?: any[]) => void;
}) {
  const [responseText, setResponseText] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const item = returnItem ?? caseItem;

  useEffect(() => {
    if (visible) {
      setResponseText(returnItem?.sellerResponse ?? caseItem?.sellerResponse ?? '');
      setRefundAmount('');
    }
  }, [visible, returnItem, caseItem]);

  if (!item) return null;

  const handleAcceptReturn = async () => {
    setSaving(true);
    const supabase = getSupabaseClient();
    if (type === 'return') {
      await supabase.from('ebay_returns').update({
        status: 'awaiting_buyer',
        seller_response: responseText || 'Return accepted',
        updated_at: new Date().toISOString(),
      }).eq('id', item.id);
    }
    setSaving(false);
    showAlert('Return Accepted', 'Buyer has been notified to return the item. Update once received.');
    onUpdate();
    onClose();
  };

  const handleRefund = async () => {
    const amount = parseFloat(refundAmount);
    if (isNaN(amount) || amount <= 0) {
      showAlert('Invalid Amount', 'Enter a valid refund amount.');
      return;
    }
    setSaving(true);
    const supabase = getSupabaseClient();
    const table = type === 'return' ? 'ebay_returns' : 'ebay_cases';
    await supabase.from(table).update({
      status: 'resolved',
      refund_amount: amount,
      resolution: `Refund of £${amount.toFixed(2)} issued`,
      updated_at: new Date().toISOString(),
    }).eq('id', item.id);
    setSaving(false);
    showAlert('Refund Recorded', `£${amount.toFixed(2)} refund recorded. Process the actual refund via eBay Seller Hub if not yet done.`);
    onUpdate();
    onClose();
  };

  const handleRespond = async () => {
    if (!responseText.trim()) {
      showAlert('Empty Response', 'Write a response before saving.');
      return;
    }
    setSaving(true);
    const supabase = getSupabaseClient();
    const table = type === 'return' ? 'ebay_returns' : 'ebay_cases';
    await supabase.from(table).update({
      seller_response: responseText,
      status: 'awaiting_buyer',
      updated_at: new Date().toISOString(),
    }).eq('id', item.id);
    setSaving(false);
    showAlert('Response Saved', 'Your response has been recorded. Submit via eBay Seller Hub to notify the buyer.');
    onUpdate();
    onClose();
  };

  const handleClose = async () => {
    setSaving(true);
    const supabase = getSupabaseClient();
    const table = type === 'return' ? 'ebay_returns' : 'ebay_cases';
    await supabase.from(table).update({
      status: 'resolved',
      resolution: 'Resolved by seller',
      updated_at: new Date().toISOString(),
    }).eq('id', item.id);
    setSaving(false);
    showAlert('Marked Resolved', 'Recorded as resolved in SWISH.');
    onUpdate();
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: Colors.background }}>
        <View style={dm.header}>
          <Pressable onPress={onClose} style={dm.closeBtn} hitSlop={8}>
            <MaterialIcons name="close" size={18} color={Colors.textSecondary} />
          </Pressable>
          <Text style={dm.title}>
            {type === 'return' ? 'Return Request' : 'eBay Case'}
          </Text>
        </View>
        <ScrollView contentContainerStyle={{ padding: Spacing.base, gap: Spacing.md, paddingBottom: 100 }}>
          {/* Details */}
          <View style={dm.detailCard}>
            <View style={dm.detailRow}>
              <Text style={dm.label}>BUYER</Text>
              <Text style={dm.value}>{item.buyerUsername || '—'}</Text>
            </View>
            {returnItem ? (
              <View style={dm.detailRow}>
                <Text style={dm.label}>REASON</Text>
                <Text style={dm.value}>{returnItem.reason || '—'}</Text>
              </View>
            ) : null}
            {caseItem ? (
              <View style={dm.detailRow}>
                <Text style={dm.label}>CASE TYPE</Text>
                <Text style={dm.value}>{caseItem.caseType === 'INR' ? 'Item Not Received' : caseItem.caseType === 'SNAD' ? 'Not As Described' : caseItem.caseType ?? '—'}</Text>
              </View>
            ) : null}
            <View style={dm.detailRow}>
              <Text style={dm.label}>STATUS</Text>
              <Text style={[dm.value, { color: STATUS_COLORS[item.status] ?? Colors.textPrimary }]}>
                {STATUS_LABELS[item.status] ?? item.status}
              </Text>
            </View>
            {item.deadline ? (
              <View style={dm.detailRow}>
                <Text style={dm.label}>DEADLINE</Text>
                <Text style={[dm.value, { color: Colors.warning }]}>
                  {new Date(item.deadline).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                </Text>
              </View>
            ) : null}
          </View>

          {/* Response field */}
          <View style={dm.field}>
            <Text style={dm.fieldLabel}>YOUR RESPONSE</Text>
            <TextInput
              style={[dm.textInput, { minHeight: 100 }]}
              value={responseText}
              onChangeText={setResponseText}
              multiline
              textAlignVertical="top"
              placeholder="Type your response to the buyer..."
              placeholderTextColor={Colors.textTertiary}
            />
          </View>

          {/* Refund field */}
          <View style={dm.field}>
            <Text style={dm.fieldLabel}>REFUND AMOUNT (£)</Text>
            <TextInput
              style={dm.singleInput}
              value={refundAmount}
              onChangeText={setRefundAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={Colors.textTertiary}
            />
          </View>

          {/* API note */}
          <View style={dm.noteCard}>
            <MaterialIcons name="open-in-new" size={12} color={Colors.textTertiary} />
            <Text style={dm.noteText}>
              For full Post-Order API actions (accept return, issue refund via eBay), use
              eBay Seller Hub directly. SWISH records your responses and tracks the status locally.
            </Text>
          </View>

          {/* Action buttons */}
          <View style={dm.btnGrid}>
            {type === 'return' && item.status === 'open' ? (
              <Pressable onPress={handleAcceptReturn} disabled={saving} style={[dm.btn, { backgroundColor: Colors.success }]}>
                <MaterialIcons name="check" size={14} color={Colors.background} />
                <Text style={[dm.btnText, { color: Colors.background }]}>Accept Return</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={handleRespond} disabled={saving || !responseText.trim()} style={[dm.btn, { backgroundColor: Colors.primary }]}>
              <MaterialIcons name="reply" size={14} color={Colors.background} />
              <Text style={[dm.btnText, { color: Colors.background }]}>Save Response</Text>
            </Pressable>
            {refundAmount ? (
              <Pressable onPress={handleRefund} disabled={saving} style={[dm.btn, { backgroundColor: Colors.gold }]}>
                <MaterialIcons name="payments" size={14} color={Colors.background} />
                <Text style={[dm.btnText, { color: Colors.background }]}>Record Refund</Text>
              </Pressable>
            ) : null}
            {item.status !== 'closed' && item.status !== 'resolved' ? (
              <Pressable onPress={handleClose} disabled={saving} style={[dm.btn, { backgroundColor: Colors.surfaceHighlight }]}>
                <MaterialIcons name="check-circle" size={14} color={Colors.textSecondary} />
                <Text style={dm.btnText}>Mark Resolved</Text>
              </Pressable>
            ) : null}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const dm = StyleSheet.create({
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
  title: { fontSize: Typography.size.lg, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  detailCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    padding: Spacing.base, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  detailRow: { flexDirection: 'row', gap: Spacing.md },
  label: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.textTertiary, width: 80 },
  value: { flex: 1, fontSize: Typography.size.sm, color: Colors.textPrimary },
  field: { gap: 6 },
  fieldLabel: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.textTertiary, letterSpacing: 0.5 },
  textInput: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
    fontSize: Typography.size.sm, color: Colors.textPrimary, lineHeight: 20,
  },
  singleInput: {
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    fontSize: Typography.size.sm, color: Colors.textPrimary, height: 44,
  },
  noteCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, padding: Spacing.sm,
  },
  noteText: { flex: 1, fontSize: 10, color: Colors.textTertiary, lineHeight: 14 },
  btnGrid: { gap: Spacing.sm },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    borderRadius: Radius.md, paddingVertical: Spacing.md,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  btnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textSecondary },
});

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function EbayReturnsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ section?: string }>();
  const { tenant } = useApp();
  const { showAlert } = useAlert();

  const [section, setSection] = useState<SectionType>(params.section === 'cases' ? 'cases' : 'returns');
  const [returns, setReturns] = useState<EbayReturn[]>([]);
  const [cases, setCases] = useState<EbayCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedReturn, setSelectedReturn] = useState<EbayReturn | null>(null);
  const [selectedCase, setSelectedCase] = useState<EbayCase | null>(null);

  // Respond modal state
  const [respondReturn, setRespondReturn] = useState<EbayReturn | null>(null);
  const [respondCase, setRespondCase] = useState<EbayCase | null>(null);

  // Sync status
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    syncing: false,
    lastSyncAt: null,
    lastFetched: 0,
    lastImported: 0,
    lastUpdated: 0,
    error: null,
    requiresApproval: false,
  });

  const load = useCallback(async () => {
    if (!tenant) return;
    const supabase = getSupabaseClient();

    const [returnsRes, casesRes] = await Promise.all([
      supabase.from('ebay_returns').select('*').eq('tenant_id', tenant.id).order('created_at', { ascending: false }),
      supabase.from('ebay_cases').select('*').eq('tenant_id', tenant.id).order('created_at', { ascending: false }),
    ]);

    setReturns((returnsRes.data ?? []).map((r: any) => ({
      id: r.id, ebayReturnId: r.ebay_return_id ?? undefined,
      ebayOrderId: r.ebay_order_id ?? undefined,
      buyerUsername: r.buyer_username ?? '',
      reason: r.reason ?? '', comments: r.comments ?? '',
      status: r.status ?? 'open',
      refundAmount: r.refund_amount ? Number(r.refund_amount) : undefined,
      sellerResponse: r.seller_response ?? undefined,
      resolution: r.resolution ?? undefined,
      deadline: r.deadline ?? undefined,
      createdAt: r.created_at,
    })));

    setCases((casesRes.data ?? []).map((r: any) => ({
      id: r.id, ebayCaseId: r.ebay_case_id ?? undefined,
      ebayOrderId: r.ebay_order_id ?? undefined,
      caseType: r.case_type ?? undefined,
      buyerUsername: r.buyer_username ?? '',
      status: r.status ?? 'open',
      sellerResponse: r.seller_response ?? undefined,
      escalated: r.escalated ?? false,
      deadline: r.deadline ?? undefined,
      resolution: r.resolution ?? undefined,
      refundAmount: r.refund_amount ? Number(r.refund_amount) : undefined,
      createdAt: r.created_at,
    })));

    setLoading(false);
    setRefreshing(false);
  }, [tenant?.id]);

  useEffect(() => { load(); }, [load]);
  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);

  // ── Sync returns from eBay Post-Order API ──────────────────────────────────

  const handleSyncFromEbay = useCallback(async () => {
    if (!tenant || syncStatus.syncing) return;
    setSyncStatus(prev => ({ ...prev, syncing: true, error: null }));
    try {
      const supabase = getSupabaseClient();
      const syncRoute = section === 'cases' ? 'sync_cases' : 'sync_returns';
      const { data, error } = await supabase.functions.invoke('swish-ebay-post-order', {
        body: { route: syncRoute, tenantId: tenant.id },
      });

      if (error) {
        let msg = error.message;
        if (error instanceof FunctionsHttpError) {
          try {
            const txt = await error.context?.text();
            const parsed = txt ? JSON.parse(txt) : null;
            msg = parsed?.error ?? txt ?? msg;
          } catch {}
        }
        // Surface permission errors clearly
        if (msg?.includes('not granted') || msg?.includes('additional approval') || msg?.includes('Seller Hub')) {
          setSyncStatus(prev => ({
            ...prev, syncing: false, error: msg, requiresApproval: true,
            lastSyncAt: new Date().toISOString(),
          }));
          return;
        }
        throw new Error(msg);
      }

      const { fetched = 0, imported = 0, updated = 0 } = data ?? {};
      setSyncStatus(prev => ({
        ...prev, syncing: false, error: null, requiresApproval: false,
        lastSyncAt: new Date().toISOString(),
        lastFetched: fetched, lastImported: imported, lastUpdated: updated,
      }));

      if (section === 'cases') {
        if (fetched === 0 && imported === 0 && updated === 0) {
          showAlert('No Cases Found', 'eBay returned no cases for this account.');
        } else {
          showAlert(
            'Cases Synced',
            `Fetched ${fetched} case${fetched !== 1 ? 's' : ''} from eBay.\n• ${imported} new · ${updated} updated`,
          );
          load();
        }
      } else if (fetched === 0 && imported === 0) {
        showAlert('No Open Returns', 'eBay reports no open return requests at this time.');
      } else {
        showAlert(
          'Returns Synced',
          `Fetched ${fetched} return${fetched !== 1 ? 's' : ''} from eBay.\n• ${imported} new · ${updated} updated`,
        );
        load();
      }
    } catch (e: any) {
      setSyncStatus(prev => ({ ...prev, syncing: false, error: e?.message ?? 'Unknown error' }));
      showAlert('Sync Failed', e?.message ?? 'Could not sync returns from eBay.');
    }
  }, [tenant, syncStatus.syncing, showAlert, load, section]);

  const openReturns = returns.filter(r => r.status !== 'closed' && r.status !== 'resolved');
  const openCases = cases.filter(c => c.status !== 'closed' && c.status !== 'resolved');
  const urgentCases = cases.filter(c => c.status === 'awaiting_seller' || c.escalated);
  const criticalDeadlines = [...returns, ...cases].filter(i => {
    const dl = deadlineBadge(i.deadline);
    return dl?.urgency === 'critical';
  });

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      <View style={[s.header, { paddingTop: insets.top + Spacing.base }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={20} color={Colors.textSecondary} />
        </Pressable>
        <View style={s.flex}>
          <Text style={s.title}>
            {section === 'returns' ? 'Returns' : 'Cases & Disputes'}
          </Text>
          <Text style={s.subtitle}>
            {section === 'returns'
              ? `${openReturns.length} open · ${returns.length} total${criticalDeadlines.length > 0 ? ` · ${criticalDeadlines.length} urgent` : ''}`
              : `${openCases.length} open${urgentCases.length > 0 ? ` · ${urgentCases.length} urgent` : ''}`}
          </Text>
        </View>

        {/* Sync from eBay button */}
        <Pressable
          onPress={handleSyncFromEbay}
          disabled={syncStatus.syncing}
          style={[s.syncBtn, syncStatus.requiresApproval && s.syncBtnLocked]}
          hitSlop={4}
        >
          {syncStatus.syncing
            ? <ActivityIndicator size="small" color={syncStatus.requiresApproval ? Colors.textTertiary : Colors.primary} style={{ width: 14, height: 14 }} />
            : <MaterialIcons
                name={syncStatus.requiresApproval ? 'lock' : 'sync'}
                size={14}
                color={syncStatus.requiresApproval ? Colors.textTertiary : Colors.primary}
              />
          }
          <Text style={[s.syncBtnText, syncStatus.requiresApproval && { color: Colors.textTertiary }]}>
            {syncStatus.syncing ? 'Syncing...' : 'Sync eBay'}
          </Text>
        </Pressable>
      </View>

      {/* Sync result banner */}
      {syncStatus.lastSyncAt && !syncStatus.syncing ? (
        <View style={[
          s.syncBanner,
          syncStatus.error ? s.syncBannerError
          : syncStatus.requiresApproval ? s.syncBannerLocked
          : s.syncBannerOk,
        ]}>
          <MaterialIcons
            name={syncStatus.error ? (syncStatus.requiresApproval ? 'lock' : 'warning') : 'check-circle'}
            size={13}
            color={syncStatus.error ? (syncStatus.requiresApproval ? Colors.textTertiary : Colors.warning) : Colors.success}
          />
          <Text style={[
            s.syncBannerText,
            syncStatus.error ? (syncStatus.requiresApproval ? { color: Colors.textTertiary } : { color: Colors.warning }) : { color: Colors.success },
          ]} numberOfLines={2}>
            {syncStatus.error
              ? syncStatus.requiresApproval
                ? 'eBay Post-Order API requires additional approval. Manage returns via eBay Seller Hub. Tap Sync eBay to check again.'
                : syncStatus.error
              : `Last sync: ${new Date(syncStatus.lastSyncAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · ${syncStatus.lastFetched} fetched · ${syncStatus.lastImported} new · ${syncStatus.lastUpdated} updated`
            }
          </Text>
        </View>
      ) : null}

      {/* Critical deadline alert */}
      {criticalDeadlines.length > 0 && section === 'returns' ? (
        <View style={s.urgentBanner}>
          <MaterialIcons name="alarm" size={14} color={Colors.danger} />
          <Text style={s.urgentBannerText}>
            {criticalDeadlines.length} return{criticalDeadlines.length > 1 ? 's' : ''} require{criticalDeadlines.length === 1 ? 's' : ''} urgent action — deadline within 3 days
          </Text>
        </View>
      ) : null}

      {/* Toggle */}
      <View style={s.toggle}>
        {(['returns', 'cases'] as SectionType[]).map(t => (
          <Pressable
            key={t}
            onPress={() => setSection(t)}
            style={[s.toggleBtn, section === t && s.toggleBtnActive]}
          >
            <MaterialIcons
              name={t === 'returns' ? 'assignment-return' : 'gavel'}
              size={14}
              color={section === t ? Colors.background : Colors.textSecondary}
            />
            <Text style={[s.toggleText, section === t && s.toggleTextActive]}>
              {t === 'returns' ? `Returns${openReturns.length > 0 ? ` (${openReturns.length})` : ''}` : `Cases${urgentCases.length > 0 ? ` (${urgentCases.length})` : ''}`}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={s.loading}><ActivityIndicator color={Colors.primary} size="large" /></View>
      ) : (
        <FlatList<any>
          data={section === 'returns' ? returns : cases}
          keyExtractor={i => i.id}
          contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 80 }]}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
          renderItem={({ item }) =>
            section === 'returns' ? (
              <ReturnRow
                item={item as EbayReturn}
                onPress={setSelectedReturn}
                onRespond={r => { setRespondReturn(r); setRespondCase(null); }}
              />
            ) : (
              <CaseRow
                item={item as unknown as EbayCase}
                onPress={setSelectedCase}
                onRespond={c => { setRespondCase(c); setRespondReturn(null); }}
              />
            )
          }
          ListEmptyComponent={
            <View style={s.empty}>
              <MaterialIcons
                name={section === 'returns' ? 'assignment-return' : 'gavel'}
                size={48} color={Colors.textTertiary}
              />
              <Text style={s.emptyTitle}>
                No {section === 'returns' ? 'returns' : 'cases'}
              </Text>
              <Text style={s.emptyText}>
                {section === 'returns'
                  ? 'Return requests from eBay will appear here when synced.'
                  : 'eBay cases and disputes will appear here. Cases requiring your action are highlighted in red.'}
              </Text>
            </View>
          }
        />
      )}

      <DetailModal
        visible={!!(selectedReturn || selectedCase)}
        type={selectedReturn ? 'return' : 'case'}
        returnItem={selectedReturn}
        caseItem={selectedCase}
        onClose={() => { setSelectedReturn(null); setSelectedCase(null); }}
        onUpdate={load}
        tenantId={tenant?.id ?? ''}
        showAlert={showAlert}
      />

      {/* Respond modal */}
      <RespondModal
        visible={!!(respondReturn || respondCase)}
        type={respondReturn ? 'return' : 'case'}
        returnItem={respondReturn}
        caseItem={respondCase}
        onClose={() => { setRespondReturn(null); setRespondCase(null); }}
        onSaved={load}
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
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.primaryDim, borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm, paddingVertical: 6,
    borderWidth: 1, borderColor: Colors.primary + '50',
  },
  syncBtnLocked: {
    backgroundColor: Colors.surfaceHighlight, borderColor: Colors.surfaceBorder,
  },
  syncBtnText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.primary },
  syncBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
  },
  syncBannerOk: { backgroundColor: Colors.successDim, borderBottomColor: Colors.success + '30' },
  syncBannerError: { backgroundColor: Colors.warningDim, borderBottomColor: Colors.warning + '30' },
  syncBannerLocked: { backgroundColor: Colors.surfaceHighlight, borderBottomColor: Colors.surfaceBorder },
  syncBannerText: { flex: 1, fontSize: 10, lineHeight: 15 },
  urgentBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm,
    backgroundColor: Colors.dangerDim,
    borderBottomWidth: 1, borderBottomColor: Colors.danger + '30',
  },
  urgentBannerText: { flex: 1, fontSize: Typography.size.xs, color: Colors.danger, fontWeight: Typography.weight.semibold },
  toggle: {
    flexDirection: 'row', gap: Spacing.sm,
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  toggleBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.xs, paddingVertical: Spacing.sm, borderRadius: Radius.md,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  toggleBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  toggleText: { fontSize: Typography.size.sm, color: Colors.textSecondary, fontWeight: Typography.weight.medium },
  toggleTextActive: { color: Colors.background, fontWeight: Typography.weight.bold },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: Spacing.base },
  empty: { alignItems: 'center', gap: Spacing.md, paddingVertical: 60, paddingHorizontal: Spacing.xl },
  emptyTitle: { fontSize: Typography.size.lg, fontWeight: Typography.weight.semibold, color: Colors.textSecondary },
  emptyText: { fontSize: Typography.size.sm, color: Colors.textTertiary, textAlign: 'center', lineHeight: 20 },
});
