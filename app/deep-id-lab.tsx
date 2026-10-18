// Deep ID / Re-ID Lab — non-mutating coin research workspace.
// Uses the existing SWISH identification and valuation Edge Functions.
// It never saves an item, uploads images to inventory storage, or applies prices.
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, TextInput,
  ActivityIndicator, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Colors, Typography, Spacing, Radius } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import {
  CapturedImage, AIIdentificationResult, pickFromLibrary, identifyItemWithAI,
} from '@/services/aiIdentificationService';
import { getMarketValue, MarketValueResult } from '@/services/marketValueService';

type FaceSlot = 'obverse' | 'reverse' | 'edge';
const SLOT_LABELS: Record<FaceSlot, string> = {
  obverse: 'Obverse / front',
  reverse: 'Reverse / back',
  edge: 'Edge / detail',
};

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>{title}</Text>
      {children}
    </View>
  );
}

export default function DeepIdLabScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tenant } = useApp();
  const [images, setImages] = useState<CapturedImage[]>([]);
  const [weight, setWeight] = useState('');
  const [diameter, setDiameter] = useState('');
  const [metal, setMetal] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [identification, setIdentification] = useState<AIIdentificationResult | null>(null);
  const [valuation, setValuation] = useState<MarketValueResult | null>(null);
  const [valuationNote, setValuationNote] = useState('');

  const addImage = useCallback(async (slotId: FaceSlot) => {
    const image = await pickFromLibrary(slotId, SLOT_LABELS[slotId]);
    if (!image) return;
    setImages(current => {
      const next = current.filter(item => item.slotId !== slotId);
      return [...next, { ...image, slotId, slotLabel: SLOT_LABELS[slotId] }];
    });
  }, []);

  const removeImage = useCallback((slotId: FaceSlot) => {
    setImages(current => current.filter(item => item.slotId !== slotId));
  }, []);

  const runLab = useCallback(async () => {
    if (!tenant?.id) {
      setError('Your workspace is not ready. Please return to the app and try again.');
      return;
    }
    if (images.length === 0) {
      setError('Add at least one coin image. Obverse and reverse together give the best result.');
      return;
    }
    setBusy(true);
    setError('');
    setStatus('Comparing coin faces and supplied measurements…');
    setIdentification(null);
    setValuation(null);
    setValuationNote('');
    try {
      const measuredWeight = Number.parseFloat(weight);
      const measuredDiameter = Number.parseFloat(diameter);
      const knownAttributes: Record<string, any> = {
        ...(Number.isFinite(measuredWeight) && measuredWeight > 0 ? { weight: measuredWeight } : {}),
        ...(Number.isFinite(measuredDiameter) && measuredDiameter > 0 ? { diameter: measuredDiameter } : {}),
        ...(metal.trim() ? { material: metal.trim() } : {}),
        ...(notes.trim() ? { customNotes: notes.trim() } : {}),
      };
      const { result, error: identifyError, quotaExceeded } = await identifyItemWithAI(
        images,
        'coins',
        notes.trim() || 'Experimental coin re-identification. Treat every attribution as a candidate until catalogue and physical evidence agree.',
        knownAttributes,
        { tenantId: tenant.id },
      );
      if (!result) {
        setError(quotaExceeded?.message ?? identifyError ?? 'Identification returned no result.');
        return;
      }
      setIdentification(result);
      setStatus('Checking market evidence separately from identification…');
      const attrs = {
        ...(result.attributes ?? {}),
        ...knownAttributes,
        ...(Number.isFinite(measuredWeight) && measuredWeight > 0 ? { measured_weight: measuredWeight } : {}),
        ...(Number.isFinite(measuredDiameter) && measuredDiameter > 0 ? { measured_diameter: measuredDiameter } : {}),
      };
      const { result: valueResult, error: valueError } = await getMarketValue({
        tenantId: tenant.id,
        title: result.canonicalTitle,
        specialistId: 'coins',
        attributes: attrs,
        condition: result.condition ?? '',
        identificationConfidence: result.confidence ?? 0,
        identificationTier: result.confidenceTier ?? 'candidate',
        numistaTypeId: result.numistaVerification?.typeId ?? result.numistaTypeId ?? null,
        numistaMatchScore: result.numistaMatchScore ?? 0,
        numistaMatchTier: result.numistaMatchTier ?? 'no_match',
        applyToItem: false,
      });
      if (valueResult) setValuation(valueResult);
      else setValuationNote(valueError ?? 'Valuation unavailable. Identification result is still available.');
    } catch (e: any) {
      setError(e?.message ?? 'Deep ID Lab failed.');
    } finally {
      setBusy(false);
      setStatus('');
    }
  }, [tenant, images, weight, diameter, metal, notes]);

  const reset = useCallback(() => {
    setImages([]);
    setWeight('');
    setDiameter('');
    setMetal('');
    setNotes('');
    setIdentification(null);
    setValuation(null);
    setValuationNote('');
    setError('');
    setStatus('');
  }, []);

  const pretty = (value: unknown) => JSON.stringify(value ?? {}, null, 2);

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <View style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={styles.back} accessibilityRole="button" accessibilityLabel="Go back">
          <MaterialIcons name="arrow-back" size={21} color={Colors.textPrimary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Deep ID / Re-ID Lab</Text>
          <Text style={styles.subtitle}>Experimental · evidence-led · no inventory changes</Text>
        </View>
        <Pressable onPress={reset} style={styles.reset} accessibilityRole="button">
          <Text style={styles.resetText}>Reset</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.notice}>
          <MaterialIcons name="science" size={18} color={Colors.info} />
          <Text style={styles.noticeText}>This lab calls the existing coin-identification and market-value services. It does not create an inventory item, write to the database, upload photos to item storage, or apply a valuation.</Text>
        </View>

        <Panel title="1 · Coin photographs">
          <Text style={styles.helper}>Add both faces if possible. Each slot can be replaced independently.</Text>
          <View style={styles.imageGrid}>
            {(['obverse', 'reverse', 'edge'] as FaceSlot[]).map(slot => {
              const image = images.find(item => item.slotId === slot);
              return (
                <View key={slot} style={styles.imageSlot}>
                  <Pressable onPress={() => addImage(slot)} style={styles.imageButton} accessibilityRole="button">
                    {image ? <Image source={{ uri: image.uri }} style={styles.preview} contentFit="contain" /> : (
                      <View style={styles.imageEmpty}>
                        <MaterialIcons name="add-a-photo" size={23} color={Colors.textTertiary} />
                        <Text style={styles.imageEmptyText}>Add photo</Text>
                      </View>
                    )}
                  </Pressable>
                  <Text style={styles.slotLabel}>{SLOT_LABELS[slot]}</Text>
                  {image ? <Pressable onPress={() => removeImage(slot)}><Text style={styles.removeText}>Remove / replace above</Text></Pressable> : null}
                </View>
              );
            })}
          </View>
        </Panel>

        <Panel title="2 · Physical evidence">
          <Text style={styles.helper}>Measurements are evidence for candidate ranking, not proof of authenticity.</Text>
          <View style={styles.fieldRow}>
            <View style={styles.field}>
              <Text style={styles.label}>Weight (g)</Text>
              <TextInput value={weight} onChangeText={setWeight} keyboardType="decimal-pad" placeholder="e.g. 7.78" placeholderTextColor={Colors.textTertiary} style={styles.input} />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Diameter (mm)</Text>
              <TextInput value={diameter} onChangeText={setDiameter} keyboardType="decimal-pad" placeholder="e.g. 22.5" placeholderTextColor={Colors.textTertiary} style={styles.input} />
            </View>
          </View>
          <Text style={styles.label}>Possible metal / alloy</Text>
          <TextInput value={metal} onChangeText={setMetal} placeholder="e.g. silver, billon, electrum, uncertain" placeholderTextColor={Colors.textTertiary} style={styles.input} />
          <Text style={styles.label}>Legends, countermarks, edge, provenance or doubts</Text>
          <TextInput value={notes} onChangeText={setNotes} multiline placeholder="Record what you can actually see; separate observations from guesses." placeholderTextColor={Colors.textTertiary} style={[styles.input, styles.notesInput]} />
        </Panel>

        <Pressable onPress={runLab} disabled={busy} style={[styles.runButton, busy && { opacity: 0.65 }]} accessibilityRole="button">
          {busy ? <ActivityIndicator color="#111" /> : <MaterialIcons name="biotech" size={19} color="#111" />}
          <Text style={styles.runText}>{busy ? 'Analysing…' : 'Run Deep ID + Valuation'}</Text>
        </Pressable>
        {busy && status ? <Text style={styles.status}>{status}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {identification ? (
          <>
            <Panel title="3 · Identification result (separate confidence)">
              <Text style={styles.resultTitle}>{identification.canonicalTitle}</Text>
              <Text style={styles.metric}>Identification confidence: {Math.round((identification.confidence ?? 0) * 100)}% · {identification.confidenceTier}</Text>
              {identification.confidenceReason ? <Text style={styles.helper}>{identification.confidenceReason}</Text> : null}
              <Text style={styles.subheading}>Primary candidate and alternatives</Text>
              <Text style={styles.codeText}>{pretty(identification.candidateIdentification ?? { primaryCandidate: identification.canonicalTitle })}</Text>
              <Text style={styles.subheading}>Coin attributes</Text>
              <Text style={styles.codeText}>{pretty(identification.coinFields ?? identification.attributes)}</Text>
              <Text style={styles.subheading}>Numista verification</Text>
              <Text style={styles.codeText}>{pretty(identification.numistaVerification)}</Text>
              <Text style={styles.subheading}>Supporting / contradictory evidence</Text>
              <Text style={styles.codeText}>{pretty({ supporting: identification.evidenceSupporting, contradictory: identification.evidenceContradictory, missing: identification.missingInformation, warnings: identification.warnings })}</Text>
            </Panel>
          </>
        ) : null}

        {valuation ? (
          <Panel title="4 · Valuation evidence (not identification confidence)">
            <Text style={styles.metric}>Valuation confidence: {valuation.valuation?.valuationConfidence ?? valuation.stats?.dataQuality ?? 'unknown'}</Text>
            <Text style={styles.codeText}>{pretty({
              valuation: valuation.valuation,
              verifiedSoldResearch: (valuation as any).verifiedSoldResearch,
              teapeakProductResearch: (valuation as any).teapeakProductResearch,
              activeAskingPrices: valuation.activeAskingPrices,
              CANOAReference: (valuation as any).canoaReference,
              numista: valuation.numista,
              auditTrail: valuation.auditTrail,
              applied: valuation.applied,
            })}</Text>
            <Text style={styles.helper}>Sold evidence, active asking prices, catalogue references and AI estimates are kept distinct. Catalogue references do not establish a coin's identity or market price.</Text>
          </Panel>
        ) : null}
        {valuationNote ? <Text style={styles.helper}>{valuationNote}</Text> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.base, paddingBottom: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  back: { width: 38, height: 38, borderRadius: Radius.md, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: Typography.size.lg, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  subtitle: { fontSize: 10, color: Colors.textTertiary, marginTop: 2 },
  reset: { paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs },
  resetText: { fontSize: Typography.size.xs, color: Colors.info, fontWeight: Typography.weight.semibold },
  content: { padding: Spacing.base, gap: Spacing.md, paddingBottom: 48 },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.infoDim, borderWidth: 1, borderColor: Colors.info + '40' },
  noticeText: { flex: 1, fontSize: Typography.size.xs, lineHeight: 18, color: Colors.textSecondary },
  panel: { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.base, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.surfaceBorder },
  panelTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  helper: { fontSize: Typography.size.xs, lineHeight: 17, color: Colors.textSecondary },
  imageGrid: { flexDirection: 'row', gap: Spacing.sm },
  imageSlot: { flex: 1, minWidth: 0, gap: 5 },
  imageButton: { aspectRatio: 1, borderRadius: Radius.md, overflow: 'hidden', borderWidth: 1, borderColor: Colors.surfaceBorder, backgroundColor: Colors.background },
  preview: { width: '100%', height: '100%' },
  imageEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
  imageEmptyText: { fontSize: 10, color: Colors.textTertiary },
  slotLabel: { fontSize: 10, color: Colors.textSecondary, fontWeight: Typography.weight.semibold },
  removeText: { fontSize: 9, color: Colors.danger },
  fieldRow: { flexDirection: 'row', gap: Spacing.sm },
  field: { flex: 1, gap: 5 },
  label: { fontSize: Typography.size.xs, color: Colors.textSecondary, fontWeight: Typography.weight.semibold },
  input: { borderWidth: 1, borderColor: Colors.surfaceBorder, borderRadius: Radius.md, backgroundColor: Colors.background, color: Colors.textPrimary, paddingHorizontal: Spacing.md, paddingVertical: 10, fontSize: Typography.size.sm },
  notesInput: { minHeight: 84, textAlignVertical: 'top' },
  runButton: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: Spacing.sm, backgroundColor: '#F5C842', borderRadius: Radius.lg, padding: Spacing.md },
  runText: { color: '#111', fontSize: Typography.size.sm, fontWeight: Typography.weight.bold },
  status: { textAlign: 'center', fontSize: Typography.size.xs, color: Colors.info },
  error: { fontSize: Typography.size.xs, color: Colors.danger },
  resultTitle: { fontSize: Typography.size.md, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  metric: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.info },
  subheading: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.textSecondary, marginTop: Spacing.sm },
  codeText: { fontSize: 10, lineHeight: 15, color: Colors.textSecondary, fontFamily: 'monospace' },
});
