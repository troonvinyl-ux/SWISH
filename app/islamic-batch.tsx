// Islamic & Indian Silver Batch Identification Screen
// Evidence-based pipeline: AI → Zeno → Numista → Reconcile → Identify
// Handles single coins and batches up to 100 items.

import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput,
  ActivityIndicator, FlatList, Modal, Linking, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { useAlert } from '@/template';
import {
  IslamicBatchItem,
  IslamicIdentificationResult,
  identifyIslamicSilver,
  processIslamicBatch,
  saveIslamicBatchToInventory,
  BatchSaveProgress,
  getConfidenceColor,
  getIdentificationStateLabel,
  getCountermarkLabel,
  getWorkflowLabel,
  countZenoMatches,
} from '@/services/islamicIdentificationService';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type ScreenMode = 'single' | 'batch';
type Tab = 'all' | 'specialist' | 'more_info' | 'countermarked' | 'complete';

let _batchIdCounter = 0;
function newBatchId() { return `coin_${++_batchIdCounter}_${Date.now()}`; }

// ─────────────────────────────────────────────────────────────────────────────
// RESULT DETAIL MODAL
// ─────────────────────────────────────────────────────────────────────────────

function ResultDetailModal({ item, visible, onClose }: {
  item: IslamicBatchItem | null;
  visible: boolean;
  onClose: () => void;
}) {
  if (!item || !item.result) return null;
  const r = item.result;
  const confColor = getConfidenceColor(r.confidenceTier);
  const cm = r.countermark;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={rd.container}>
        <View style={rd.header}>
          <Pressable onPress={onClose} style={rd.closeBtn} hitSlop={8}>
            <MaterialIcons name="close" size={20} color={Colors.textSecondary} />
          </Pressable>
          <Text style={rd.headerTitle} numberOfLines={1}>{item.label ?? r.canonicalTitle}</Text>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView contentContainerStyle={rd.content} showsVerticalScrollIndicator={false}>

          {/* ── Title + Confidence ── */}
          <View style={rd.titleBlock}>
            <View style={rd.statePill}>
              <MaterialIcons
                name={r.identificationState === 'source_supported' || r.identificationState === 'verified' ? 'verified' : 'info-outline'}
                size={11}
                color={r.identificationState === 'source_supported' ? Colors.success : Colors.warning}
              />
              <Text style={[rd.statePillTxt, { color: r.identificationState === 'source_supported' ? Colors.success : Colors.warning }]}>
                {getIdentificationStateLabel(r.identificationState).toUpperCase()}
              </Text>
            </View>
            <Text style={rd.resultTitle}>{r.canonicalTitle}</Text>
            {r.coinFamily ? <Text style={rd.familyLabel}>{r.coinFamily}</Text> : null}
            <View style={[rd.confPill, { backgroundColor: confColor + '18', borderColor: confColor + '50' }]}>
              <Text style={[rd.confPct, { color: confColor }]}>{Math.round(r.confidence * 100)}%</Text>
              <View style={[rd.confSep, { backgroundColor: confColor + '40' }]} />
              <Text style={[rd.confTier, { color: confColor }]}>{r.confidenceTier.replace('_', ' ').toUpperCase()}</Text>
            </View>
            {r.confidenceReason ? <Text style={rd.confReason} numberOfLines={3}>{r.confidenceReason}</Text> : null}
          </View>

          {/* ── Countermark ── */}
          {cm.status !== 'none' ? (
            <View style={[rd.cmCard, {
              borderColor: cm.status === 'confirmed' ? Colors.danger + '50' : Colors.warning + '40',
              backgroundColor: cm.status === 'confirmed' ? Colors.danger + '08' : Colors.warning + '08',
            }]}>
              <View style={rd.cmHeader}>
                <MaterialIcons name="warning" size={14} color={cm.status === 'confirmed' ? Colors.danger : Colors.warning} />
                <Text style={[rd.cmTitle, { color: cm.status === 'confirmed' ? Colors.danger : Colors.warning }]}>
                  {getCountermarkLabel(cm.status).toUpperCase()}
                </Text>
              </View>
              {cm.description ? <Text style={rd.cmDesc}>{cm.description}</Text> : null}
              {cm.possibleAuthority ? <Text style={rd.cmDetail}>Authority: {cm.possibleAuthority}</Text> : null}
              {cm.possibleRuler ? <Text style={rd.cmDetail}>Ruler: {cm.possibleRuler}</Text> : null}
              {cm.possibleDate ? <Text style={rd.cmDetail}>Approximate date: {cm.possibleDate}</Text> : null}
              {cm.inscription ? <Text style={rd.cmDetail}>Inscription: {cm.inscription}</Text> : null}
              {cm.requiresBetterImage ? (
                <Text style={[rd.cmDetail, { color: Colors.warning, fontWeight: Typography.weight.semibold }]}>
                  Macro photograph of countermark required for identification
                </Text>
              ) : null}
              {cm.notes ? <Text style={rd.cmNotes}>{cm.notes}</Text> : null}
            </View>
          ) : null}

          {/* ── Host Coin (if countermarked) ── */}
          {r.hostCoin ? (
            <View style={rd.sectionCard}>
              <Text style={rd.sectionTitle}>HOST COIN</Text>
              {r.hostCoin.dynasty ? <Text style={rd.detail}>Dynasty: {r.hostCoin.dynasty}</Text> : null}
              {r.hostCoin.ruler ? <Text style={rd.detail}>Ruler: {r.hostCoin.ruler}</Text> : null}
              {r.hostCoin.denomination ? <Text style={rd.detail}>Denomination: {r.hostCoin.denomination}</Text> : null}
              {r.hostCoin.approximateDate ? <Text style={rd.detail}>Date: {r.hostCoin.approximateDate}</Text> : null}
              <Text style={[rd.detail, { color: confColor }]}>Confidence: {Math.round(r.hostCoin.confidence * 100)}%</Text>
              {r.hostCoin.notes ? <Text style={rd.noteText}>{r.hostCoin.notes}</Text> : null}
            </View>
          ) : null}

          {/* ── Physical Observations ── */}
          <View style={rd.sectionCard}>
            <Text style={rd.sectionTitle}>PHYSICAL OBSERVATIONS</Text>
            {r.observations.obverse ? <Text style={rd.detail}>Obverse: {r.observations.obverse}</Text> : null}
            {r.observations.reverse ? <Text style={rd.detail}>Reverse: {r.observations.reverse}</Text> : null}
            {r.observations.inscriptionObverse ? <Text style={rd.detail}>Obv. Inscription: {r.observations.inscriptionObverse}</Text> : null}
            {r.observations.inscriptionReverse ? <Text style={rd.detail}>Rev. Inscription: {r.observations.inscriptionReverse}</Text> : null}
            {r.observations.scriptType ? <Text style={rd.detail}>Script: {r.observations.scriptType}</Text> : null}
            {r.observations.estimatedWeight !== 'Not supplied' ? <Text style={rd.detail}>Weight: {r.observations.estimatedWeight}</Text> : null}
            {r.observations.estimatedDiameter !== 'Not supplied' ? <Text style={rd.detail}>Diameter: {r.observations.estimatedDiameter}</Text> : null}
            {r.observations.condition ? <Text style={rd.detail}>Condition: {r.observations.condition}{r.observations.conditionGrade ? ` (${r.observations.conditionGrade})` : ''}</Text> : null}
            {r.observations.conditionNotes ? <Text style={rd.noteText}>{r.observations.conditionNotes}</Text> : null}
          </View>

          {/* ── Candidates ── */}
          {r.candidates.length > 0 ? (
            <View style={rd.sectionCard}>
              <Text style={rd.sectionTitle}>CANDIDATES CONSIDERED</Text>
              {r.candidates.map((c, i) => {
                const cc = getConfidenceColor(c.confidenceTier);
                const isSelected = c.candidateId === r.selectedCandidateId;
                return (
                  <View key={c.candidateId} style={[rd.candidateRow, isSelected && rd.candidateRowSelected, i > 0 && { marginTop: Spacing.sm }]}>
                    <View style={rd.candidateHeader}>
                      <View style={[rd.candidateBadge, { backgroundColor: cc + '20' }]}>
                        <Text style={[rd.candidateBadgeTxt, { color: cc }]}>{c.candidateId}</Text>
                      </View>
                      <Text style={rd.candidateLabel} numberOfLines={2}>{c.label}</Text>
                      {isSelected ? <MaterialIcons name="check-circle" size={14} color={Colors.success} /> : null}
                    </View>
                    {c.dynasty ? <Text style={rd.detail}>Dynasty: {c.dynasty}</Text> : null}
                    {c.ruler ? <Text style={rd.detail}>Ruler: {c.ruler}</Text> : null}
                    {c.denomination ? <Text style={rd.detail}>Denomination: {c.denomination}</Text> : null}
                    {(c.dateCE || c.dateAH) ? <Text style={rd.detail}>Date: {[c.dateAH ? `AH ${c.dateAH}` : null, c.dateCE ? `CE ${c.dateCE}` : null].filter(Boolean).join(' / ')}</Text> : null}
                    {c.sourceEvidence.length > 0 ? (
                      <View style={rd.evidenceList}>
                        {c.sourceEvidence.slice(0, 3).map((e, j) => (
                          <Text key={j} style={rd.evidItem}>✓ {e}</Text>
                        ))}
                      </View>
                    ) : null}
                    {c.contradictions.length > 0 ? (
                      <View style={rd.evidenceList}>
                        {c.contradictions.slice(0, 2).map((e, j) => (
                          <Text key={j} style={[rd.evidItem, { color: Colors.danger + 'BB' }]}>✗ {e}</Text>
                        ))}
                      </View>
                    ) : null}
                    <View style={[rd.confPillSm, { backgroundColor: cc + '18', borderColor: cc + '40' }]}>
                      <Text style={[rd.confPillSmTxt, { color: cc }]}>{Math.round(c.confidence * 100)}% {c.confidenceTier.replace('_', ' ')}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}

          {/* ── Zeno Evidence ── */}
          {r.zenoSearch.length > 0 ? (
            <View style={rd.sectionCard}>
              <Text style={rd.sectionTitle}>
                {`ZENO.RU SEARCHES (${countZenoMatches(r.zenoSearch)}/${r.zenoSearch.length} returned results)`}
              </Text>
              {r.zenoSearch.map((zr, i) => (
                <View key={i} style={rd.sourceRow}>
                  <View style={rd.sourceRowHeader}>
                    <MaterialIcons
                      name={zr.available && zr.candidates.length > 0 ? 'check-circle' : zr.available ? 'search-off' : 'error-outline'}
                      size={12}
                      color={zr.available && zr.candidates.length > 0 ? Colors.success : Colors.warning}
                    />
                    <Text style={rd.sourceQuery} numberOfLines={1}>{zr.query}</Text>
                    <Pressable onPress={() => Linking.openURL(zr.searchUrl)} hitSlop={8}>
                      <MaterialIcons name="open-in-new" size={11} color={Colors.info} />
                    </Pressable>
                  </View>
                  {zr.candidates.slice(0, 3).map((c, j) => (
                    <Pressable key={j} onPress={() => Linking.openURL(c.referenceUrl)} style={rd.zenoCandRow}>
                      <Text style={rd.zenoCandTitle} numberOfLines={2}>{c.title}</Text>
                      <Text style={rd.zenoCandScore}>Score: {c.matchScore}</Text>
                    </Pressable>
                  ))}
                  {!zr.available ? <Text style={rd.sourceError}>{zr.error}</Text> : null}
                </View>
              ))}
            </View>
          ) : null}

          {/* ── Numista Evidence ── */}
          {r.numistaSearch.available && r.numistaSearch.candidates.length > 0 ? (
            <View style={rd.sectionCard}>
              <Text style={rd.sectionTitle}>NUMISTA CATALOGUE</Text>
              {r.numistaSearch.candidates.slice(0, 3).map((c, i) => (
                <Pressable key={i} onPress={() => Linking.openURL(c.numistaUrl)} style={rd.zenoCandRow}>
                  <Text style={rd.zenoCandTitle} numberOfLines={2}>{c.numistaN}: {c.title}</Text>
                  <Text style={rd.zenoCandScore}>Score: {c.matchScore}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {/* ── Warnings ── */}
          {r.warnings.length > 0 ? (
            <View style={rd.warningBlock}>
              {r.warnings.map((w, i) => (
                <View key={i} style={rd.warningRow}>
                  <MaterialIcons name="warning" size={11} color={Colors.warning} style={{ marginTop: 2 }} />
                  <Text style={rd.warningText}>{w}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* ── Next Actions ── */}
          {r.nextActions.length > 0 ? (
            <View style={rd.sectionCard}>
              <Text style={rd.sectionTitle}>NEXT ACTIONS</Text>
              {r.nextActions.map((a, i) => (
                <View key={i} style={rd.actionRow}>
                  <Text style={rd.actionNum}>{i + 1}.</Text>
                  <Text style={rd.actionText}>{a}</Text>
                </View>
              ))}
            </View>
          ) : null}

          <Text style={rd.valuationNote}>{r.marketEvidenceNote}</Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

const rd = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.base, paddingTop: Spacing.lg, paddingBottom: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  closeBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  content: { padding: Spacing.base, gap: Spacing.lg, paddingBottom: 48 },
  titleBlock: { gap: Spacing.sm },
  statePill: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', backgroundColor: Colors.surface, borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: Colors.surfaceBorder },
  statePillTxt: { fontSize: 9, fontWeight: Typography.weight.bold, letterSpacing: 0.5 },
  resultTitle: { fontSize: Typography.size.lg, fontWeight: Typography.weight.bold, color: Colors.textPrimary, lineHeight: 26 },
  familyLabel: { fontSize: Typography.size.xs, color: Colors.textSecondary, fontWeight: Typography.weight.medium },
  confPill: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderRadius: Radius.pill, paddingHorizontal: Spacing.md, paddingVertical: 7, borderWidth: 1, alignSelf: 'flex-start' },
  confPct: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold },
  confSep: { width: 1, height: 14 },
  confTier: { fontSize: 10, fontWeight: Typography.weight.bold, letterSpacing: 0.4 },
  confReason: { fontSize: Typography.size.xs, color: Colors.textTertiary, lineHeight: 16 },
  cmCard: { borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.xs, borderWidth: 1 },
  cmHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  cmTitle: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, letterSpacing: 0.5 },
  cmDesc: { fontSize: Typography.size.xs, color: Colors.textPrimary, lineHeight: 16 },
  cmDetail: { fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 15 },
  cmNotes: { fontSize: Typography.size.xs, color: Colors.textTertiary, lineHeight: 14, fontStyle: 'italic' },
  sectionCard: { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.xs, borderWidth: 1, borderColor: Colors.surfaceBorder },
  sectionTitle: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  detail: { fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 16 },
  noteText: { fontSize: Typography.size.xs, color: Colors.textTertiary, lineHeight: 14, fontStyle: 'italic', marginTop: 2 },
  candidateRow: { backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, padding: Spacing.sm, gap: 3, borderWidth: 1, borderColor: Colors.surfaceBorder },
  candidateRowSelected: { borderColor: Colors.primary + '60', backgroundColor: Colors.primaryDim },
  candidateHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.xs },
  candidateBadge: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  candidateBadgeTxt: { fontSize: 10, fontWeight: Typography.weight.bold },
  candidateLabel: { flex: 1, fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.textPrimary, lineHeight: 15 },
  evidenceList: { gap: 2, marginTop: 3 },
  evidItem: { fontSize: 10, color: Colors.success + 'BB', lineHeight: 14 },
  confPillSm: { flexDirection: 'row', alignItems: 'center', borderRadius: Radius.pill, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, alignSelf: 'flex-start', marginTop: 4 },
  confPillSmTxt: { fontSize: 9, fontWeight: Typography.weight.bold },
  sourceRow: { gap: 4, paddingVertical: Spacing.xs, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder + '60' },
  sourceRowHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  sourceQuery: { flex: 1, fontSize: Typography.size.xs, color: Colors.textSecondary, fontWeight: Typography.weight.medium },
  sourceError: { fontSize: 10, color: Colors.warning, lineHeight: 13 },
  zenoCandRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.xs, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder + '40' },
  zenoCandTitle: { flex: 1, fontSize: 10, color: Colors.info, lineHeight: 14, textDecorationLine: 'underline' },
  zenoCandScore: { fontSize: 10, color: Colors.textTertiary },
  warningBlock: { backgroundColor: Colors.warning + '10', borderRadius: Radius.md, padding: Spacing.md, gap: Spacing.xs, borderWidth: 1, borderColor: Colors.warning + '30' },
  warningRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.xs },
  warningText: { flex: 1, fontSize: Typography.size.xs, color: Colors.warning, lineHeight: 15 },
  actionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.xs },
  actionNum: { fontSize: Typography.size.xs, color: Colors.primary, fontWeight: Typography.weight.bold, minWidth: 16 },
  actionText: { flex: 1, fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 16 },
  valuationNote: { fontSize: Typography.size.xs, color: Colors.textTertiary, lineHeight: 16, textAlign: 'center', padding: Spacing.md, backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.surfaceBorder },
});

// ─────────────────────────────────────────────────────────────────────────────
// BATCH ITEM CARD
// ─────────────────────────────────────────────────────────────────────────────

function BatchItemCard({ item, onPress, onRemove }: {
  item: IslamicBatchItem;
  onPress: () => void;
  onRemove?: () => void;
}) {
  const r = item.result;
  const confColor = r ? getConfidenceColor(r.confidenceTier) : Colors.textTertiary;
  const flagColor = r?.batchFlags.workflowStatus === 'specialist_review' ? Colors.danger
    : r?.batchFlags.workflowStatus === 'more_info_required' ? Colors.warning
    : r?.batchFlags.workflowStatus === 'identification_complete' ? Colors.success
    : Colors.textTertiary;

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [bic.card, pressed && { opacity: 0.85 }]}>
      {/* Left: image or placeholder */}
      <View style={bic.imgSlot}>
        {item.images[0] || item.existingImageUrls?.[0] ? (
          <Image
            source={{ uri: item.images[0] || item.existingImageUrls![0] }}
            style={bic.img}
            contentFit="cover"
            transition={100}
          />
        ) : (
          <MaterialIcons name="toll" size={20} color={Colors.textTertiary} />
        )}
        {item.status === 'processing' ? (
          <View style={bic.processingOverlay}>
            <ActivityIndicator size="small" color="#fff" />
          </View>
        ) : null}
      </View>

      {/* Main content */}
      <View style={bic.main}>
        <Text style={bic.label} numberOfLines={1}>{item.label ?? `Coin ${item.id}`}</Text>
        {item.status === 'complete' && r ? (
          <>
            <Text style={bic.title} numberOfLines={2}>{r.canonicalTitle}</Text>
            <View style={bic.metaRow}>
              <View style={[bic.confBadge, { backgroundColor: confColor + '20', borderColor: confColor + '40' }]}>
                <Text style={[bic.confTxt, { color: confColor }]}>{Math.round(r.confidence * 100)}%</Text>
              </View>
              {r.countermark.status !== 'none' ? (
                <View style={bic.cmBadge}>
                  <MaterialIcons name="warning" size={9} color={Colors.danger} />
                  <Text style={bic.cmBadgeTxt}>CM</Text>
                </View>
              ) : null}
              <View style={[bic.statusBadge, { backgroundColor: flagColor + '15', borderColor: flagColor + '30' }]}>
                <Text style={[bic.statusTxt, { color: flagColor }]}>{getWorkflowLabel(r.batchFlags.workflowStatus)}</Text>
              </View>
            </View>
          </>
        ) : item.status === 'error' ? (
          <Text style={bic.errorTxt} numberOfLines={2}>{item.error}</Text>
        ) : item.status === 'processing' ? (
          <Text style={bic.processingTxt}>Identifying…</Text>
        ) : (
          <View style={bic.measureRow}>
            {item.weight ? <Text style={bic.measureTxt}>{item.weight}g</Text> : null}
            {item.diameter ? <Text style={bic.measureTxt}>{item.diameter}mm</Text> : null}
          </View>
        )}
      </View>

      {/* Remove button (pending only) */}
      {item.status === 'pending' && onRemove ? (
        <Pressable onPress={onRemove} style={bic.removeBtn} hitSlop={8}>
          <MaterialIcons name="close" size={14} color={Colors.textTertiary} />
        </Pressable>
      ) : (
        <MaterialIcons name="chevron-right" size={18} color={Colors.textTertiary} />
      )}
    </Pressable>
  );
}

const bic = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder, ...Shadow.sm },
  imgSlot: { width: 52, height: 52, borderRadius: Radius.md, backgroundColor: Colors.surfaceHighlight, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  img: { width: '100%', height: '100%' },
  processingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  main: { flex: 1, gap: 3 },
  label: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.3 },
  title: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary, lineHeight: 17 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, flexWrap: 'wrap' },
  confBadge: { borderRadius: Radius.pill, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1 },
  confTxt: { fontSize: 9, fontWeight: Typography.weight.bold },
  cmBadge: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: Colors.danger + '15', borderRadius: Radius.pill, paddingHorizontal: 5, paddingVertical: 2, borderWidth: 1, borderColor: Colors.danger + '30' },
  cmBadgeTxt: { fontSize: 8, fontWeight: Typography.weight.bold, color: Colors.danger },
  statusBadge: { borderRadius: Radius.pill, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1 },
  statusTxt: { fontSize: 9, fontWeight: Typography.weight.medium },
  errorTxt: { fontSize: Typography.size.xs, color: Colors.danger, lineHeight: 15 },
  processingTxt: { fontSize: Typography.size.xs, color: Colors.textTertiary, fontStyle: 'italic' },
  measureRow: { flexDirection: 'row', gap: Spacing.sm },
  measureTxt: { fontSize: Typography.size.xs, color: Colors.textSecondary },
  removeBtn: { width: 28, height: 28, borderRadius: Radius.md, backgroundColor: Colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center' },
});

// ─────────────────────────────────────────────────────────────────────────────
// ADD COIN FORM
// ─────────────────────────────────────────────────────────────────────────────

function AddCoinForm({ onAdd }: { onAdd: (item: IslamicBatchItem) => void }) {
  const [images, setImages] = useState<string[]>([]);
  const [weight, setWeight] = useState('');
  const [diameter, setDiameter] = useState('');
  const [notes, setNotes] = useState('');
  const [label, setLabel] = useState('');

  const pickImages = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.85,
      base64: true,
      selectionLimit: 4,
    });
    if (!result.canceled) {
      // Use base64 data URI so the edge function can pass it directly to the AI model.
      // Fall back to file URI only for display if base64 is unavailable.
      const uris = result.assets.map(a =>
        a.base64 ? `data:image/jpeg;base64,${a.base64}` : a.uri
      );
      setImages(prev => [...prev, ...uris].slice(0, 4));
    }
  }, []);

  const takePhoto = useCallback(async () => {
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.85,
      base64: true,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      const uri = asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : asset.uri;
      setImages(prev => [...prev, uri].slice(0, 4));
    }
  }, []);

  const handleAdd = useCallback(() => {
    const item: IslamicBatchItem = {
      id: newBatchId(),
      images,
      weight: weight ? parseFloat(weight) : undefined,
      diameter: diameter ? parseFloat(diameter) : undefined,
      notes: notes.trim() || undefined,
      label: label.trim() || undefined,
      status: 'pending',
    };
    onAdd(item);
    setImages([]); setWeight(''); setDiameter(''); setNotes(''); setLabel('');
  }, [images, weight, diameter, notes, label, onAdd]);

  const canAdd = images.length > 0;

  return (
    <View style={acf.container}>
      <Text style={acf.sectionTitle}>ADD COIN</Text>

      {/* Image row */}
      <View style={acf.imageRow}>
        {images.slice(0, 4).map((uri, i) => (
          <View key={i} style={acf.imgSlot}>
            <Image source={{ uri }} style={acf.imgThumb} contentFit="cover" />
            <Pressable onPress={() => setImages(prev => prev.filter((_, j) => j !== i))} style={acf.imgRemove} hitSlop={4}>
              <MaterialIcons name="close" size={10} color="#fff" />
            </Pressable>
          </View>
        ))}
        {images.length < 4 ? (
          <View style={acf.addImgGroup}>
            <Pressable onPress={takePhoto} style={acf.addImgBtn}>
              <MaterialIcons name="photo-camera" size={18} color={Colors.primary} />
            </Pressable>
            <Pressable onPress={pickImages} style={acf.addImgBtn}>
              <MaterialIcons name="photo-library" size={16} color={Colors.textTertiary} />
            </Pressable>
          </View>
        ) : null}
      </View>

      {/* Measurements */}
      <View style={acf.measureRow}>
        <View style={acf.measureField}>
          <Text style={acf.fieldLabel}>Weight (g)</Text>
          <TextInput style={acf.input} value={weight} onChangeText={setWeight} keyboardType="decimal-pad" placeholder="e.g. 5.12" placeholderTextColor={Colors.textTertiary} />
        </View>
        <View style={acf.measureField}>
          <Text style={acf.fieldLabel}>Diameter (mm)</Text>
          <TextInput style={acf.input} value={diameter} onChangeText={setDiameter} keyboardType="decimal-pad" placeholder="e.g. 20.5" placeholderTextColor={Colors.textTertiary} />
        </View>
      </View>

      {/* Label */}
      <TextInput style={acf.input} value={label} onChangeText={setLabel} placeholder="Label (optional, e.g. 'Lot 5 Coin A')" placeholderTextColor={Colors.textTertiary} />

      {/* Notes */}
      <TextInput style={[acf.input, acf.notesInput]} value={notes} onChangeText={setNotes} placeholder="Notes (optional: seller description, provenance, etc.)" placeholderTextColor={Colors.textTertiary} multiline numberOfLines={2} textAlignVertical="top" />

      <Pressable onPress={handleAdd} disabled={!canAdd} style={[acf.addBtn, !canAdd && acf.addBtnDisabled]}>
        <MaterialIcons name="add" size={16} color={canAdd ? Colors.background : Colors.textTertiary} />
        <Text style={[acf.addBtnTxt, !canAdd && acf.addBtnTxtDisabled]}>Add to Batch</Text>
      </Pressable>
    </View>
  );
}

const acf = StyleSheet.create({
  container: { backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.md, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.surfaceBorder },
  sectionTitle: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  imageRow: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' },
  imgSlot: { width: 60, height: 60, borderRadius: Radius.md, overflow: 'hidden', position: 'relative' },
  imgThumb: { width: '100%', height: '100%' },
  imgRemove: { position: 'absolute', top: 2, right: 2, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 8, width: 16, height: 16, alignItems: 'center', justifyContent: 'center' },
  addImgGroup: { flexDirection: 'column', gap: 4 },
  addImgBtn: { width: 60, height: 28, borderRadius: Radius.md, backgroundColor: Colors.primaryDim, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.primary + '40' },
  measureRow: { flexDirection: 'row', gap: Spacing.sm },
  measureField: { flex: 1, gap: 3 },
  fieldLabel: { fontSize: 10, fontWeight: Typography.weight.semibold, color: Colors.textTertiary },
  input: { backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.surfaceBorder, paddingHorizontal: Spacing.sm, paddingVertical: 8, fontSize: Typography.size.xs, color: Colors.textPrimary, includeFontPadding: false },
  notesInput: { minHeight: 48, textAlignVertical: 'top' },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: Spacing.md },
  addBtnDisabled: { backgroundColor: Colors.surfaceHighlight },
  addBtnTxt: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },
  addBtnTxtDisabled: { color: Colors.textTertiary },
});

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SCREEN
// ─────────────────────────────────────────────────────────────────────────────

export default function IslamicBatchScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tenant } = useApp();
  const { showAlert } = useAlert();

  const [items, setItems] = useState<IslamicBatchItem[]>([]);
  const [processing, setProcessing] = useState(false);
  const [processedCount, setProcessedCount] = useState(0);
  const [currentlyProcessing, setCurrentlyProcessing] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('all');
  const [selectedItem, setSelectedItem] = useState<IslamicBatchItem | null>(null);
  const [showAddForm, setShowAddForm] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  // Save to inventory state
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState<BatchSaveProgress | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [saveComplete, setSaveComplete] = useState(false);

  const pendingItems = useMemo(() => items.filter(i => i.status === 'pending'), [items]);
  const completedItems = useMemo(() => items.filter(i => i.status === 'complete'), [items]);
  const countermarkedItems = useMemo(() => items.filter(i => i.result?.countermark.status === 'confirmed' || i.result?.countermark.status === 'possible'), [items]);
  const specialistItems = useMemo(() => items.filter(i => i.result?.batchFlags.workflowStatus === 'specialist_review'), [items]);
  const moreInfoItems = useMemo(() => items.filter(i => i.result?.batchFlags.workflowStatus === 'more_info_required'), [items]);
  const identCompleteItems = useMemo(() => items.filter(i => i.result?.batchFlags.workflowStatus === 'identification_complete'), [items]);

  const filteredItems = useMemo(() => {
    switch (activeTab) {
      case 'specialist': return specialistItems;
      case 'more_info': return moreInfoItems;
      case 'countermarked': return countermarkedItems;
      case 'complete': return identCompleteItems;
      default: return items;
    }
  }, [activeTab, items, specialistItems, moreInfoItems, countermarkedItems, identCompleteItems]);

  const handleAddItem = useCallback((item: IslamicBatchItem) => {
    setItems(prev => [...prev, item]);
  }, []);

  const handleRemoveItem = useCallback((id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
  }, []);

  const handleRunBatch = useCallback(async () => {
    if (!tenant) { showAlert('Not Ready', 'Please wait for tenant to load'); return; }
    if (pendingItems.length === 0) { showAlert('No Items', 'Add at least one coin to the batch'); return; }

    setProcessing(true);
    setProcessedCount(0);
    abortRef.current = new AbortController();

    await processIslamicBatch(
      pendingItems,
      tenant.id,
      (processed, total, currentItem) => {
        setProcessedCount(processed);
        setCurrentlyProcessing(currentItem.status === 'processing' ? currentItem.id : null);
        // Update item in list
        setItems(prev => prev.map(i => i.id === currentItem.id ? currentItem : i));
      },
      abortRef.current.signal,
    );

    setProcessing(false);
    setCurrentlyProcessing(null);
    setShowAddForm(false);
  }, [tenant, pendingItems, showAlert]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setProcessing(false);
    setCurrentlyProcessing(null);
  }, []);

  const handleClearAll = useCallback(() => {
    showAlert('Clear All?', 'This will remove all items from the batch.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => {
        setItems([]); setProcessedCount(0); setShowAddForm(true);
        setSavedIds(new Set()); setSaveComplete(false); setSaveProgress(null);
      }},
    ]);
  }, [showAlert]);

  const completedUnsaved = useMemo(() =>
    items.filter(i => i.status === 'complete' && i.result && !savedIds.has(i.id)),
    [items, savedIds],
  );

  const handleSaveAll = useCallback(async () => {
    if (!tenant) { showAlert('Not Ready', 'Tenant not loaded yet'); return; }
    if (completedUnsaved.length === 0) {
      showAlert('Nothing to Save', 'All completed coins have already been saved to inventory');
      return;
    }

    setSaving(true);
    setSaveComplete(false);
    setSaveProgress({ saved: 0, total: completedUnsaved.length, failed: 0 });

    const { savedIds: newIds, failed, errors } = await saveIslamicBatchToInventory(
      tenant.id,
      completedUnsaved,
      (progress) => setSaveProgress(progress),
    );

    setSavedIds(prev => {
      const next = new Set(prev);
      // Map saved indices back to item IDs
      completedUnsaved.forEach((item, idx) => {
        if (idx < newIds.length) next.add(item.id);
      });
      return next;
    });

    setSaving(false);
    setSaveComplete(true);
    setSaveProgress(null);

    if (failed === 0) {
      showAlert(
        'Saved to Inventory',
        `${newIds.length} coin${newIds.length !== 1 ? 's' : ''} added to your inventory as Islamic Silver items.`,
      );
    } else {
      showAlert(
        'Partial Save',
        `${newIds.length} saved, ${failed} failed. Tap items to review.`,
      );
    }
  }, [tenant, completedUnsaved, showAlert]);

  const allSaved = completedUnsaved.length === 0 && saveComplete;

  const TABS: { key: Tab; label: string; count: number; color?: string }[] = [
    { key: 'all', label: 'All', count: items.length },
    { key: 'specialist', label: 'Specialist Review', count: specialistItems.length, color: Colors.danger },
    { key: 'countermarked', label: 'Countermarked', count: countermarkedItems.length, color: Colors.warning },
    { key: 'more_info', label: 'More Info', count: moreInfoItems.length, color: Colors.warning },
    { key: 'complete', label: 'Complete', count: identCompleteItems.length, color: Colors.success },
  ];

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + Spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={s.headerBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={20} color={Colors.textSecondary} />
        </Pressable>
        <View style={s.flex}>
          <Text style={s.headerTitle}>Islamic & Indian Silver</Text>
          <Text style={s.headerSub}>Zeno · Numista · Evidence-Based</Text>
        </View>
        {items.length > 0 ? (
          <Pressable onPress={handleClearAll} style={s.clearBtn} hitSlop={4}>
            <MaterialIcons name="delete-outline" size={16} color={Colors.danger} />
          </Pressable>
        ) : null}
      </View>

      {/* Progress bar (when processing) */}
      {processing ? (
        <View style={s.progressBar}>
          <View style={[s.progressFill, { width: `${items.length > 0 ? (processedCount / pendingItems.length) * 100 : 0}%` }]} />
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Info banner */}
        <View style={s.infoBanner}>
          <MaterialIcons name="info-outline" size={13} color={Colors.info} />
          <Text style={s.infoText}>
            For each coin: AI analyses the photograph, then searches Zeno.ru and Numista for corroborating evidence. Countermarks are identified separately from the host coin.
          </Text>
        </View>

        {/* Add form */}
        {showAddForm ? (
          <AddCoinForm onAdd={handleAddItem} />
        ) : (
          <Pressable onPress={() => setShowAddForm(true)} style={s.showAddBtn}>
            <MaterialIcons name="add" size={15} color={Colors.primary} />
            <Text style={s.showAddBtnTxt}>Add More Coins</Text>
          </Pressable>
        )}

        {/* Tab bar */}
        {items.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabContent} style={s.tabBar}>
            {TABS.filter(t => t.count > 0 || t.key === 'all').map(tab => (
              <Pressable
                key={tab.key}
                onPress={() => setActiveTab(tab.key)}
                style={[s.tab, activeTab === tab.key && s.tabActive]}
              >
                <Text style={[s.tabTxt, activeTab === tab.key && s.tabTxtActive, tab.color && activeTab === tab.key ? { color: tab.color } : null]}>
                  {tab.label}
                </Text>
                {tab.count > 0 ? (
                  <View style={[s.tabBadge, activeTab === tab.key && s.tabBadgeActive, tab.color && activeTab === tab.key ? { backgroundColor: tab.color + '25' } : null]}>
                    <Text style={[s.tabBadgeTxt, activeTab === tab.key && s.tabBadgeTxtActive]}>{tab.count}</Text>
                  </View>
                ) : null}
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        {/* Save to Inventory banner */}
      {completedItems.length > 0 && !processing ? (
        saving ? (
          <View style={s.savingBanner}>
            <ActivityIndicator size="small" color={Colors.success} />
            <View style={s.flex}>
              <Text style={s.savingTitle}>
                Saving {saveProgress ? `${saveProgress.saved + 1} of ${saveProgress.total}` : '...'}...
              </Text>
              {saveProgress?.currentLabel ? (
                <Text style={s.savingSub}>{saveProgress.currentLabel}</Text>
              ) : null}
            </View>
          </View>
        ) : allSaved ? (
          <View style={[s.savingBanner, s.savedBanner]}>
            <MaterialIcons name="check-circle" size={18} color={Colors.success} />
            <View style={s.flex}>
              <Text style={[s.savingTitle, { color: Colors.success }]}>All saved to inventory</Text>
              <Text style={s.savingSub}>Items are now visible in your Stock screen</Text>
            </View>
            <Pressable onPress={() => router.push('/(tabs)/inventory' as any)} style={s.viewInventoryBtn} hitSlop={6}>
              <Text style={s.viewInventoryBtnTxt}>View Stock</Text>
              <MaterialIcons name="arrow-forward" size={12} color={Colors.success} />
            </Pressable>
          </View>
        ) : completedUnsaved.length > 0 ? (
          <Pressable
            onPress={handleSaveAll}
            style={({ pressed }) => [s.saveAllBanner, pressed && { opacity: 0.85 }]}
          >
            <View style={s.saveAllIcon}>
              <MaterialIcons name="save" size={18} color={Colors.background} />
            </View>
            <View style={s.flex}>
              <Text style={s.saveAllTitle}>Save All to Inventory</Text>
              <Text style={s.saveAllSub}>
                {completedUnsaved.length} identified coin{completedUnsaved.length !== 1 ? 's' : ''} ready · Islamic Silver specialist
              </Text>
            </View>
            <MaterialIcons name="arrow-forward" size={16} color={Colors.background} />
          </Pressable>
        ) : null
      ) : null}

      {/* Status during processing */}
        {processing ? (
          <View style={s.processingCard}>
            <ActivityIndicator size="small" color={Colors.primary} />
            <View style={s.flex}>
              <Text style={s.processingTitle}>Identifying {processedCount + 1} of {pendingItems.length}…</Text>
              <Text style={s.processingSub}>AI analysis + Zeno search + Numista catalogue</Text>
            </View>
            <Pressable onPress={handleStop} style={s.stopBtn}>
              <Text style={s.stopBtnTxt}>Stop</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Items list */}
        {filteredItems.length > 0 ? (
          <View style={s.itemsList}>
            {filteredItems.map(item => (
              <BatchItemCard
                key={item.id}
                item={item}
                onPress={() => setSelectedItem(item)}
                onRemove={item.status === 'pending' ? () => handleRemoveItem(item.id) : undefined}
              />
            ))}
          </View>
        ) : items.length === 0 ? (
          <View style={s.emptyState}>
            <MaterialIcons name="toll" size={36} color={Colors.textTertiary} />
            <Text style={s.emptyTitle}>Add coins to identify</Text>
            <Text style={s.emptySub}>Photograph obverse and reverse of each coin. Weight and diameter improve accuracy significantly.</Text>
          </View>
        ) : null}
      </ScrollView>

      {/* Action bar */}
      {pendingItems.length > 0 && !processing && !saving ? (
        <View style={[s.actionBar, { paddingBottom: insets.bottom + Spacing.sm }]}>
          <View style={s.flex}>
            <Text style={s.actionBarTitle}>{pendingItems.length} coin{pendingItems.length !== 1 ? 's' : ''} ready</Text>
            <Text style={s.actionBarSub}>AI → Zeno → Numista → Evidence</Text>
          </View>
          <Pressable onPress={handleRunBatch} style={s.runBtn}>
            <MaterialIcons name="auto-awesome" size={16} color={Colors.background} />
            <Text style={s.runBtnTxt}>Run Identification</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Result detail modal */}
      <ResultDetailModal
        item={selectedItem}
        visible={selectedItem !== null}
        onClose={() => setSelectedItem(null)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.base, paddingBottom: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  headerBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },
  headerTitle: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  headerSub: { fontSize: 10, color: Colors.textTertiary, marginTop: 1 },
  clearBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.dangerDim, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  progressBar: { height: 3, backgroundColor: Colors.surfaceBorder },
  progressFill: { height: '100%', backgroundColor: Colors.primary },
  content: { padding: Spacing.base, gap: Spacing.lg },
  infoBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: Colors.infoDim ?? Colors.info + '15', borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.info + '30' },
  infoText: { flex: 1, fontSize: Typography.size.xs, color: Colors.info, lineHeight: 17 },
  showAddBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.primary + '40', borderStyle: 'dashed' },
  showAddBtnTxt: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.primary },
  tabBar: { marginHorizontal: -Spacing.base },
  tabContent: { paddingHorizontal: Spacing.base, gap: Spacing.xs, flexDirection: 'row', alignItems: 'center' },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: Spacing.md, paddingVertical: 8, borderRadius: Radius.pill, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder },
  tabActive: { backgroundColor: Colors.primaryDim, borderColor: Colors.primary + '50' },
  tabTxt: { fontSize: Typography.size.xs, color: Colors.textSecondary, fontWeight: Typography.weight.medium },
  tabTxtActive: { color: Colors.primary, fontWeight: Typography.weight.bold },
  tabBadge: { backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.pill, paddingHorizontal: 5, paddingVertical: 1 },
  tabBadgeActive: { backgroundColor: Colors.primaryDim },
  tabBadgeTxt: { fontSize: 9, color: Colors.textTertiary, fontWeight: Typography.weight.bold },
  tabBadgeTxtActive: { color: Colors.primary },
  processingCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.primaryDim, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.primary + '40' },
  processingTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  processingSub: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  stopBtn: { backgroundColor: Colors.surface, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: 7, borderWidth: 1, borderColor: Colors.surfaceBorder },
  stopBtnTxt: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.textSecondary },
  itemsList: { gap: Spacing.sm },
  emptyState: { alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.xxl },
  emptyTitle: { fontSize: Typography.size.lg, fontWeight: Typography.weight.semibold, color: Colors.textSecondary },
  emptySub: { fontSize: Typography.size.sm, color: Colors.textTertiary, textAlign: 'center', lineHeight: 20, maxWidth: 280 },
  actionBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.base, backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.surfaceBorder },
  actionBarTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  actionBarSub: { fontSize: 10, color: Colors.textTertiary },
  runBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, backgroundColor: Colors.primary, borderRadius: Radius.md, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, ...Shadow.glow },
  runBtnTxt: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },

  // Save to inventory
  saveAllBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.success, borderRadius: Radius.xl,
    padding: Spacing.base, marginHorizontal: Spacing.base,
  },
  saveAllIcon: {
    width: 40, height: 40, borderRadius: Radius.md,
    backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center',
  },
  saveAllTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },
  saveAllSub: { fontSize: 10, color: 'rgba(255,255,255,0.8)', marginTop: 1 },
  savingBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.successDim, borderRadius: Radius.xl,
    padding: Spacing.md, marginHorizontal: Spacing.base,
    borderWidth: 1, borderColor: Colors.success + '30',
  },
  savedBanner: {
    borderColor: Colors.success + '50',
  },
  savingTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  savingSub: { fontSize: 10, color: Colors.textTertiary, marginTop: 1 },
  viewInventoryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.success + '20', borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm, paddingVertical: 5,
    borderWidth: 1, borderColor: Colors.success + '40',
  },
  viewInventoryBtnTxt: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.success },
});
