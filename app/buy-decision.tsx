// SWISH — Should I Buy This?
// AI-powered buy decision engine for resellers.
// Upload photos, paste eBay links, or take screenshots of potential acquisitions.
// Gemini analyses the item and returns a buy/pass recommendation with profit estimate.

import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput,
  ActivityIndicator, Platform, Share, Alert,
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
import { getSupabaseClient } from '@/template';
import { NICHES } from '@/constants/niches';

// ── Types ─────────────────────────────────────────────────────────────────────

interface BuyDecisionResult {
  verdict: 'BUY' | 'PASS' | 'INVESTIGATE';
  confidence: 'high' | 'medium' | 'low';
  itemName: string;
  itemType: string;
  condition: string;
  askingPrice: number | null;
  estimatedSellPrice: number | null;
  estimatedProfit: number | null;
  estimatedROI: number | null;
  timeToSell: string;
  platformRecommendation: string;
  buyReasons: string[];
  passReasons: string[];
  investigatePoints: string[];
  marketContext: string;
  pricingBasis: string;
  conditionRisk: string;
  authenticityRisk: string | null;
  profitScenarios: {
    optimistic: number | null;
    realistic: number | null;
    pessimistic: number | null;
  };
  suggestedMaxBuyPrice: number | null;
  listingTitle: string;
  keySellingPoints: string[];
}

// ── Niche colour helper ───────────────────────────────────────────────────────

function getNicheAccent(activeNicheId: string | null): string {
  if (!activeNicheId) return Colors.primary;
  return NICHES[activeNicheId as keyof typeof NICHES]?.color ?? Colors.primary;
}

// ── Verdict config ────────────────────────────────────────────────────────────

const VERDICT_CONFIG = {
  BUY: { color: '#16A34A', bg: '#052e16', icon: 'thumb-up' as const, label: 'BUY IT' },
  PASS: { color: '#EF4444', bg: '#1c0202', icon: 'thumb-down' as const, label: 'PASS' },
  INVESTIGATE: { color: '#F59E0B', bg: '#1c1200', icon: 'search' as const, label: 'INVESTIGATE' },
};

// ── Photo strip ───────────────────────────────────────────────────────────────

function PhotoStrip({ photos, onAdd, onRemove }: {
  photos: string[];
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  return (
    <View style={ps.row}>
      {photos.map((uri, i) => (
        <View key={i} style={ps.thumb}>
          <Image source={{ uri }} style={ps.thumbImg} contentFit="cover" transition={100} />
          <Pressable onPress={() => onRemove(i)} style={ps.removeBtn} hitSlop={4}>
            <MaterialIcons name="close" size={10} color="#fff" />
          </Pressable>
        </View>
      ))}
      {photos.length < 5 ? (
        <Pressable onPress={onAdd} style={ps.addBtn}>
          <MaterialIcons name="add-a-photo" size={22} color={Colors.primary} />
          <Text style={ps.addText}>Add</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const ps = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' },
  thumb: { width: 72, height: 72, borderRadius: Radius.md, overflow: 'hidden', position: 'relative' },
  thumbImg: { width: '100%', height: '100%' },
  removeBtn: { position: 'absolute', top: 3, right: 3, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 8, width: 16, height: 16, alignItems: 'center', justifyContent: 'center' },
  addBtn: { width: 72, height: 72, borderRadius: Radius.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.primary, backgroundColor: Colors.primaryDim, alignItems: 'center', justifyContent: 'center', gap: 3 },
  addText: { fontSize: 10, color: Colors.primary, fontWeight: Typography.weight.semibold },
});

// ── Result card section ───────────────────────────────────────────────────────

function InfoRow({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <View style={ir.row}>
      <Text style={ir.label}>{label}</Text>
      <Text style={[ir.value, accent ? { color: accent } : undefined]}>{value}</Text>
    </View>
  );
}

const ir = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder + '60' },
  label: { fontSize: Typography.size.xs, color: Colors.textTertiary, flex: 1 },
  value: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.textPrimary, flex: 1, textAlign: 'right' },
});

// ── Main screen ───────────────────────────────────────────────────────────────

export default function BuyDecisionScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tenant, activeNicheId } = useApp();
  const { showAlert } = useAlert();
  const accent = getNicheAccent(activeNicheId);

  // Input state
  const [photos, setPhotos] = useState<string[]>([]);
  const [ebayLink, setEbayLink] = useState('');
  const [askingPrice, setAskingPrice] = useState('');
  const [sellerNotes, setSellerNotes] = useState('');
  const [knownCondition, setKnownCondition] = useState('');

  // Result state
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState('');
  const [result, setResult] = useState<BuyDecisionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const nicheConfig = activeNicheId ? NICHES[activeNicheId as keyof typeof NICHES] : null;
  const nicheContext = nicheConfig
    ? `The user is a ${nicheConfig.shortName} reseller. Focus analysis on ${nicheConfig.shortName.toLowerCase()} market: ${nicheConfig.marketplaces.join(', ')}.`
    : 'General resale market analysis.';

  // ── Image capture ──────────────────────────────────────────────────────────

  const handleAddPhoto = useCallback(async () => {
    if (photos.length >= 5) return;
    showAlert('Add Photo', 'Choose source', [
      {
        text: 'Camera', onPress: async () => {
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== 'granted') { showAlert('Permission Required', 'Camera access is needed.'); return; }
          const result = await ImagePicker.launchCameraAsync({ allowsEditing: false, quality: 0.7, base64: true });
          if (!result.canceled && result.assets[0]) {
            setPhotos(prev => [...prev, result.assets[0].uri]);
          }
        },
      },
      {
        text: 'Library / Screenshot', onPress: async () => {
          const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (status !== 'granted') { showAlert('Permission Required', 'Photo library access is needed.'); return; }
          const res = await ImagePicker.launchImageLibraryAsync({ allowsMultipleSelection: false, quality: 0.7, base64: true });
          if (!res.canceled && res.assets[0]) {
            setPhotos(prev => [...prev, res.assets[0].uri]);
          }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [photos.length, showAlert]);

  const handleRemovePhoto = useCallback((index: number) => {
    setPhotos(prev => prev.filter((_, i) => i !== index));
  }, []);

  // ── AI analysis ────────────────────────────────────────────────────────────

  const handleAnalyse = useCallback(async () => {
    if (photos.length === 0 && !ebayLink.trim()) {
      showAlert('Photos or Link Required', 'Add at least one photo or an eBay link to analyse.');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    const apiKey = (globalThis as any).__ONSPACE_AI_API_KEY__ ?? process.env.EXPO_PUBLIC_ONSPACE_AI_KEY;
    // Use the Supabase functions invoke approach for security (keeps API key server-side)
    const supabase = getSupabaseClient();

    try {
      setLoadingStep('Preparing images...');

      // Convert local URIs to base64
      const imageData: string[] = [];
      for (const uri of photos.slice(0, 4)) {
        if (uri.startsWith('https://')) {
          imageData.push(uri);
        } else {
          // Local file — read as base64
          try {
            const { FileSystem } = await import('expo-file-system');
            const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
            imageData.push(`data:image/jpeg;base64,${b64}`);
          } catch {
            imageData.push(uri);
          }
        }
      }

      setLoadingStep('Asking Gemini AI...');

      const prompt = buildBuyDecisionPrompt({
        askingPrice: askingPrice ? parseFloat(askingPrice) : null,
        ebayLink: ebayLink.trim(),
        sellerNotes: sellerNotes.trim(),
        condition: knownCondition.trim(),
        nicheContext,
        niche: nicheConfig?.shortName ?? 'General',
      });

      // Call OnSpace AI via edge function pattern (or directly if available)
      const { data, error: fnError } = await supabase.functions.invoke('swish-identify', {
        body: {
          images: imageData.filter(d => d.startsWith('data:')),
          existingImageUrls: imageData.filter(d => d.startsWith('https://')),
          specialistId: nicheConfig?.defaultSpecialist ?? 'curiosities_collectibles',
          tenantId: tenant?.id ?? '',
          acquisitionContext: `BUY DECISION MODE. ${askingPrice ? `Seller asking £${askingPrice}.` : ''} ${ebayLink ? `eBay link: ${ebayLink}` : ''} ${sellerNotes ? `Notes: ${sellerNotes}` : ''} ${knownCondition ? `Condition: ${knownCondition}` : ''} TASK: Provide a buy/pass decision for a reseller.`,
          knownAttributes: {
            askingPrice: askingPrice ? parseFloat(askingPrice) : undefined,
            ebayLink: ebayLink.trim() || undefined,
            sellerNotes: sellerNotes.trim() || undefined,
            condition: knownCondition.trim() || undefined,
            mode: 'buy_decision',
          },
          buyDecisionMode: true,
        },
      });

      setLoadingStep('Calculating profit...');

      if (fnError || !data?.identification) {
        // Build a basic result from what we have
        throw new Error(fnError?.message ?? 'Analysis returned no data');
      }

      const id = data.identification;
      const parsed = buildBuyDecisionFromIdentification(id, askingPrice ? parseFloat(askingPrice) : null, nicheConfig?.shortName ?? 'General');
      setResult(parsed);

    } catch (e: any) {
      // Fallback: use Gemini directly through OnSpace AI if available
      try {
        setLoadingStep('Running direct AI analysis...');
        const parsed = await runDirectGeminiBuyDecision({
          photos,
          askingPrice: askingPrice ? parseFloat(askingPrice) : null,
          ebayLink: ebayLink.trim(),
          sellerNotes: sellerNotes.trim(),
          condition: knownCondition.trim(),
          nicheContext,
          niche: nicheConfig?.shortName ?? 'General',
          supabase,
        });
        if (parsed) {
          setResult(parsed);
        } else {
          setError('Could not complete analysis. Please try again with clearer photos.');
        }
      } catch (e2: any) {
        setError(e2.message ?? 'Analysis failed. Please try again.');
      }
    }

    setLoading(false);
    setLoadingStep('');
  }, [photos, ebayLink, askingPrice, sellerNotes, knownCondition, tenant, nicheConfig, nicheContext, showAlert]);

  // ── Facebook export ────────────────────────────────────────────────────────

  const handleExportFacebook = useCallback(async () => {
    if (!result) return;
    const price = result.estimatedSellPrice ?? result.suggestedMaxBuyPrice ?? 0;
    const fbText = generateFacebookAd(result, price, nicheConfig?.shortName ?? 'General');
    try {
      await Share.share({ message: fbText, title: `${result.itemName} — Facebook Marketplace` });
    } catch {}
  }, [result, nicheConfig]);

  // ── Reset ──────────────────────────────────────────────────────────────────

  const handleReset = useCallback(() => {
    setPhotos([]);
    setEbayLink('');
    setAskingPrice('');
    setSellerNotes('');
    setKnownCondition('');
    setResult(null);
    setError(null);
  }, []);

  const verdictCfg = result ? VERDICT_CONFIG[result.verdict] : null;

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + Spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={20} color={Colors.textSecondary} />
        </Pressable>
        <View style={s.headerCenter}>
          <MaterialIcons name="savings" size={18} color={accent} />
          <Text style={[s.headerTitle, { color: accent }]}>Should I Buy This?</Text>
        </View>
        {result ? (
          <Pressable onPress={handleReset} style={s.resetBtn} hitSlop={8}>
            <MaterialIcons name="refresh" size={16} color={Colors.textTertiary} />
          </Pressable>
        ) : <View style={{ width: 36 }} />}
      </View>

      <ScrollView
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {!result ? (
          <>
            {/* Hero */}
            <View style={[s.heroCard, { borderColor: accent + '30' }]}>
              <View style={[s.heroIcon, { backgroundColor: accent + '20' }]}>
                <MaterialIcons name="lightbulb" size={28} color={accent} />
              </View>
              <Text style={s.heroTitle}>AI Buy Decision</Text>
              <Text style={s.heroDesc}>
                Upload photos or a screenshot, paste the eBay link, enter the asking price, and get an instant profit analysis from SWISH AI.
              </Text>
              <View style={s.heroChips}>
                <View style={s.heroChip}><MaterialIcons name="photo-camera" size={10} color={Colors.textTertiary} /><Text style={s.heroChipText}>Photos</Text></View>
                <View style={s.heroChip}><MaterialIcons name="screenshot-monitor" size={10} color={Colors.textTertiary} /><Text style={s.heroChipText}>Screenshots</Text></View>
                <View style={s.heroChip}><MaterialIcons name="link" size={10} color={Colors.textTertiary} /><Text style={s.heroChipText}>eBay Link</Text></View>
              </View>
            </View>

            {/* Photos */}
            <View style={s.section}>
              <Text style={s.sectionLabel}>PHOTOS / SCREENSHOTS (up to 5)</Text>
              <Text style={s.sectionHint}>Take photos of the item, or screenshot eBay Seller Hub / Product Research pages</Text>
              <PhotoStrip photos={photos} onAdd={handleAddPhoto} onRemove={handleRemovePhoto} />
            </View>

            {/* eBay Link */}
            <View style={s.section}>
              <Text style={s.sectionLabel}>EBAY LISTING LINK (optional)</Text>
              <TextInput
                style={s.input}
                value={ebayLink}
                onChangeText={setEbayLink}
                placeholder="https://www.ebay.co.uk/itm/..."
                placeholderTextColor={Colors.textTertiary}
                autoCapitalize="none"
                keyboardType="url"
              />
            </View>

            {/* Asking price */}
            <View style={s.section}>
              <Text style={s.sectionLabel}>ASKING PRICE (£)</Text>
              <TextInput
                style={[s.input, s.inputSmall]}
                value={askingPrice}
                onChangeText={setAskingPrice}
                placeholder="e.g. 85.00"
                placeholderTextColor={Colors.textTertiary}
                keyboardType="decimal-pad"
              />
            </View>

            {/* Condition */}
            <View style={s.section}>
              <Text style={s.sectionLabel}>CONDITION (optional)</Text>
              <TextInput
                style={s.input}
                value={knownCondition}
                onChangeText={setKnownCondition}
                placeholder="e.g. Used, running, needs new chain"
                placeholderTextColor={Colors.textTertiary}
              />
            </View>

            {/* Seller notes */}
            <View style={s.section}>
              <Text style={s.sectionLabel}>SELLER NOTES / CONTEXT (optional)</Text>
              <TextInput
                style={[s.input, s.inputMulti]}
                value={sellerNotes}
                onChangeText={setSellerNotes}
                placeholder="Paste listing description, any known history, why they're selling..."
                placeholderTextColor={Colors.textTertiary}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            </View>

            {/* Error */}
            {error ? (
              <View style={s.errorBanner}>
                <MaterialIcons name="error-outline" size={13} color={Colors.danger} />
                <Text style={s.errorText}>{error}</Text>
              </View>
            ) : null}

            {/* Analyse button */}
            <Pressable
              onPress={handleAnalyse}
              disabled={loading || (photos.length === 0 && !ebayLink.trim())}
              style={({ pressed }) => [
                s.analyseBtn,
                { backgroundColor: accent },
                (loading || (photos.length === 0 && !ebayLink.trim())) && s.analyseBtnDisabled,
                pressed && { opacity: 0.85 },
              ]}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#000" />
              ) : (
                <MaterialIcons name="savings" size={18} color="#000" />
              )}
              <Text style={s.analyseBtnText}>
                {loading ? loadingStep || 'Analysing...' : 'Analyse — Should I Buy?'}
              </Text>
            </Pressable>

            {loading ? (
              <Text style={s.loadingHint}>Gemini Vision is analysing your images and calculating profit potential...</Text>
            ) : null}
          </>
        ) : (
          <>
            {/* RESULT VIEW */}

            {/* Verdict hero */}
            <View style={[s.verdictCard, { backgroundColor: verdictCfg!.bg, borderColor: verdictCfg!.color + '50' }]}>
              <View style={[s.verdictIcon, { backgroundColor: verdictCfg!.color + '25' }]}>
                <MaterialIcons name={verdictCfg!.icon} size={28} color={verdictCfg!.color} />
              </View>
              <Text style={[s.verdictLabel, { color: verdictCfg!.color }]}>{verdictCfg!.label}</Text>
              <Text style={s.verdictItem}>{result.itemName}</Text>
              <View style={[s.confPill, { backgroundColor: verdictCfg!.color + '20' }]}>
                <Text style={[s.confText, { color: verdictCfg!.color }]}>{result.confidence.toUpperCase()} CONFIDENCE</Text>
              </View>
            </View>

            {/* Profit summary */}
            {(result.estimatedProfit !== null || result.suggestedMaxBuyPrice !== null) ? (
              <View style={s.profitCard}>
                <Text style={s.cardLabel}>PROFIT ANALYSIS</Text>
                <View style={s.profitRow}>
                  {result.askingPrice !== null ? <View style={s.profitCol}><Text style={s.profitLabel}>Asking</Text><Text style={s.profitValue}>£{result.askingPrice.toFixed(2)}</Text></View> : null}
                  {result.estimatedSellPrice !== null ? <View style={s.profitCol}><Text style={s.profitLabel}>Est. Sell</Text><Text style={[s.profitValue, { color: Colors.success }]}>£{result.estimatedSellPrice.toFixed(0)}</Text></View> : null}
                  {result.estimatedProfit !== null ? (
                    <View style={[s.profitCol, s.profitColMid]}>
                      <Text style={s.profitLabel}>Est. Profit</Text>
                      <Text style={[s.profitValueBig, { color: result.estimatedProfit >= 0 ? Colors.success : Colors.danger }]}>
                        {result.estimatedProfit >= 0 ? '+' : ''}£{result.estimatedProfit.toFixed(0)}
                      </Text>
                    </View>
                  ) : null}
                  {result.estimatedROI !== null ? <View style={s.profitCol}><Text style={s.profitLabel}>ROI</Text><Text style={[s.profitValue, { color: result.estimatedROI >= 0 ? Colors.success : Colors.danger }]}>{result.estimatedROI.toFixed(0)}%</Text></View> : null}
                </View>

                {/* Scenarios */}
                {(result.profitScenarios.optimistic !== null) ? (
                  <View style={s.scenarioRow}>
                    <View style={s.scenarioItem}><MaterialIcons name="trending-up" size={10} color={Colors.success} /><Text style={s.scenarioLabel}>Best</Text><Text style={[s.scenarioValue, { color: Colors.success }]}>£{result.profitScenarios.optimistic?.toFixed(0)}</Text></View>
                    <View style={s.scenarioItem}><MaterialIcons name="trending-flat" size={10} color={Colors.warning} /><Text style={s.scenarioLabel}>Typical</Text><Text style={[s.scenarioValue, { color: Colors.warning }]}>£{result.profitScenarios.realistic?.toFixed(0)}</Text></View>
                    <View style={s.scenarioItem}><MaterialIcons name="trending-down" size={10} color={Colors.danger} /><Text style={s.scenarioLabel}>Worst</Text><Text style={[s.scenarioValue, { color: Colors.danger }]}>£{result.profitScenarios.pessimistic?.toFixed(0)}</Text></View>
                  </View>
                ) : null}

                {result.suggestedMaxBuyPrice !== null ? (
                  <View style={s.maxBuyRow}>
                    <MaterialIcons name="price-check" size={13} color={Colors.primary} />
                    <Text style={s.maxBuyText}>
                      Max buy price for 30%+ ROI: <Text style={{ color: Colors.primary, fontWeight: Typography.weight.bold }}>£{result.suggestedMaxBuyPrice.toFixed(2)}</Text>
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* Key info */}
            <View style={s.infoCard}>
              <Text style={s.cardLabel}>ITEM DETAILS</Text>
              <InfoRow label="Item type" value={result.itemType} />
              <InfoRow label="Condition" value={result.condition} />
              {result.platformRecommendation ? <InfoRow label="Best platform" value={result.platformRecommendation} /> : null}
              {result.timeToSell ? <InfoRow label="Est. time to sell" value={result.timeToSell} /> : null}
              {result.authenticityRisk ? <InfoRow label="Auth risk" value={result.authenticityRisk} accent={Colors.warning} /> : null}
            </View>

            {/* Buy reasons */}
            {result.buyReasons.length > 0 ? (
              <View style={[s.reasonsCard, { borderColor: Colors.success + '30' }]}>
                <View style={s.reasonsHeader}>
                  <MaterialIcons name="check-circle" size={13} color={Colors.success} />
                  <Text style={[s.reasonsTitle, { color: Colors.success }]}>WHY BUY</Text>
                </View>
                {result.buyReasons.map((r, i) => (
                  <View key={i} style={s.reasonRow}>
                    <MaterialIcons name="check" size={11} color={Colors.success} style={{ marginTop: 2 }} />
                    <Text style={s.reasonText}>{r}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {/* Pass reasons */}
            {result.passReasons.length > 0 ? (
              <View style={[s.reasonsCard, { borderColor: Colors.danger + '30' }]}>
                <View style={s.reasonsHeader}>
                  <MaterialIcons name="cancel" size={13} color={Colors.danger} />
                  <Text style={[s.reasonsTitle, { color: Colors.danger }]}>WHY PASS</Text>
                </View>
                {result.passReasons.map((r, i) => (
                  <View key={i} style={s.reasonRow}>
                    <MaterialIcons name="close" size={11} color={Colors.danger} style={{ marginTop: 2 }} />
                    <Text style={s.reasonText}>{r}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {/* Investigate points */}
            {result.investigatePoints.length > 0 ? (
              <View style={[s.reasonsCard, { borderColor: Colors.warning + '30' }]}>
                <View style={s.reasonsHeader}>
                  <MaterialIcons name="search" size={13} color={Colors.warning} />
                  <Text style={[s.reasonsTitle, { color: Colors.warning }]}>INVESTIGATE BEFORE BUYING</Text>
                </View>
                {result.investigatePoints.map((r, i) => (
                  <View key={i} style={s.reasonRow}>
                    <MaterialIcons name="help-outline" size={11} color={Colors.warning} style={{ marginTop: 2 }} />
                    <Text style={s.reasonText}>{r}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {/* Market context */}
            {result.marketContext ? (
              <View style={s.contextCard}>
                <Text style={s.cardLabel}>MARKET CONTEXT</Text>
                <Text style={s.contextText}>{result.marketContext}</Text>
                {result.pricingBasis ? <Text style={s.pricingBasis}>Pricing basis: {result.pricingBasis}</Text> : null}
              </View>
            ) : null}

            {/* Key selling points for listing */}
            {result.keySellingPoints.length > 0 ? (
              <View style={s.contextCard}>
                <Text style={s.cardLabel}>KEY SELLING POINTS (for your listing)</Text>
                {result.keySellingPoints.map((sp, i) => (
                  <View key={i} style={s.reasonRow}>
                    <MaterialIcons name="star" size={10} color={Colors.gold} style={{ marginTop: 3 }} />
                    <Text style={s.reasonText}>{sp}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {/* Suggested listing title */}
            {result.listingTitle ? (
              <View style={s.contextCard}>
                <Text style={s.cardLabel}>SUGGESTED LISTING TITLE</Text>
                <Text style={s.listingTitle}>{result.listingTitle}</Text>
              </View>
            ) : null}

            {/* Actions */}
            <View style={s.actionRow}>
              <Pressable onPress={handleExportFacebook} style={[s.actionBtn, { backgroundColor: '#1877F2' }]}>
                <MaterialIcons name="share" size={15} color="#fff" />
                <Text style={s.actionBtnText}>Facebook Ad</Text>
              </Pressable>
              <Pressable onPress={handleReset} style={[s.actionBtn, { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder }]}>
                <MaterialIcons name="refresh" size={15} color={Colors.textSecondary} />
                <Text style={[s.actionBtnText, { color: Colors.textSecondary }]}>New Analysis</Text>
              </Pressable>
            </View>

            {/* Disclaimer */}
            <Text style={s.disclaimer}>
              AI estimate — not financial advice. Verify prices on eBay before purchasing. Actual profit depends on condition, fees, and market conditions.
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildBuyDecisionPrompt(params: {
  askingPrice: number | null;
  ebayLink: string;
  sellerNotes: string;
  condition: string;
  nicheContext: string;
  niche: string;
}): string {
  return `BUY DECISION ANALYSIS — ${params.niche} reseller context.
${params.nicheContext}
Asking price: ${params.askingPrice ? `£${params.askingPrice}` : 'Not specified'}
eBay link: ${params.ebayLink || 'Not provided'}
Condition: ${params.condition || 'Not specified'}
Seller notes: ${params.sellerNotes || 'None'}
Analyse the item and return a buy/pass decision with profit estimate.`;
}

function buildBuyDecisionFromIdentification(id: any, askingPrice: number | null, niche: string): BuyDecisionResult {
  const title = id.canonicalTitle ?? 'Unknown Item';
  const confidence = id.confidence >= 0.75 ? 'high' : id.confidence >= 0.50 ? 'medium' : 'low';

  // Basic profit estimate from valuation
  const mid = id.valuationMid ?? 0;
  const asking = askingPrice ?? 0;
  const profit = mid > 0 && asking > 0 ? mid * 0.87 - asking : null;
  const roi = profit !== null && asking > 0 ? (profit / asking) * 100 : null;

  const verdict: BuyDecisionResult['verdict'] =
    profit !== null ? (profit >= 20 && roi !== null && roi >= 25 ? 'BUY' : profit >= 0 ? 'INVESTIGATE' : 'PASS') :
    id.confidence >= 0.6 ? 'INVESTIGATE' : 'PASS';

  return {
    verdict,
    confidence,
    itemName: title,
    itemType: id.objectType ?? niche,
    condition: id.condition ?? 'Unknown',
    askingPrice,
    estimatedSellPrice: mid > 0 ? mid : null,
    estimatedProfit: profit,
    estimatedROI: roi,
    timeToSell: mid > 50 ? '2–6 weeks on eBay' : '1–3 weeks',
    platformRecommendation: 'eBay UK',
    buyReasons: id.evidenceSupporting?.slice(0, 3) ?? [],
    passReasons: id.confidence < 0.5 ? ['Low identification confidence — hard to price accurately'] : [],
    investigatePoints: id.missingInformation?.slice(0, 3) ?? [],
    marketContext: `AI identification confidence: ${Math.round(id.confidence * 100)}%. ${id.confidenceReason ?? ''}`,
    pricingBasis: 'Gemini Vision estimate — verify on eBay Sold',
    conditionRisk: id.conditionNotes ?? 'Unknown',
    authenticityRisk: id.clothingFields?.authenticityRiskLevel ?? null,
    profitScenarios: {
      optimistic: mid > 0 ? Math.round((mid * 1.15 * 0.87 - (asking || 0)) * 100) / 100 : null,
      realistic: profit,
      pessimistic: mid > 0 ? Math.round((mid * 0.70 * 0.87 - (asking || 0)) * 100) / 100 : null,
    },
    suggestedMaxBuyPrice: mid > 0 ? Math.round(mid * 0.87 * 0.67 * 100) / 100 : null,
    listingTitle: title.slice(0, 80),
    keySellingPoints: id.evidenceSupporting?.slice(0, 4) ?? [],
  };
}

async function runDirectGeminiBuyDecision(params: {
  photos: string[];
  askingPrice: number | null;
  ebayLink: string;
  sellerNotes: string;
  condition: string;
  nicheContext: string;
  niche: string;
  supabase: ReturnType<typeof getSupabaseClient>;
}): Promise<BuyDecisionResult | null> {
  // Use swish-market-value edge function repurposed with Gemini vision
  // Pass photos as imageUrls and let the function analyse them
  const { data, error } = await params.supabase.functions.invoke('swish-market-value', {
    body: {
      tenantId: 'system',
      title: `Buy Decision: ${params.niche} item`,
      specialistId: params.niche.toLowerCase() === 'mx' ? 'motocross' :
        params.niche.toLowerCase() === 'bikes' ? 'bicycles' :
        params.niche.toLowerCase() === 'clothing' ? 'clothing' : 'coins',
      condition: params.condition,
      imageUrls: params.photos.filter(p => p.startsWith('https://')),
      buyDecisionMode: true,
    },
  });

  if (error || !data?.geminiMarketResearch?.available) return null;

  const gemini = data.geminiMarketResearch;
  const asking = params.askingPrice;
  const mid = gemini.estimatedRange?.mid ?? 0;
  const profit = mid > 0 && asking !== null ? mid * 0.87 - asking : null;
  const roi = profit !== null && asking !== null && asking > 0 ? (profit / asking) * 100 : null;

  const verdict: BuyDecisionResult['verdict'] =
    profit !== null ? (profit >= 20 && roi !== null && roi >= 25 ? 'BUY' : profit >= 0 ? 'INVESTIGATE' : 'PASS') : 'INVESTIGATE';

  return {
    verdict,
    confidence: gemini.confidence as any ?? 'medium',
    itemName: gemini.comparableDescription ?? `${params.niche} item`,
    itemType: params.niche,
    condition: params.condition || 'Unknown',
    askingPrice: asking,
    estimatedSellPrice: mid > 0 ? mid : null,
    estimatedProfit: profit,
    estimatedROI: roi,
    timeToSell: mid > 100 ? '2–6 weeks on eBay' : '1–3 weeks',
    platformRecommendation: 'eBay UK',
    buyReasons: profit !== null && profit > 0 ? [`Estimated profit £${profit.toFixed(0)} at asking price £${asking}`, gemini.marketContext ?? ''] : [],
    passReasons: profit !== null && profit <= 0 ? [`Insufficient margin at £${asking} — estimated sell price £${mid.toFixed(0)}`] : [],
    investigatePoints: ['Verify condition in person', 'Check recent eBay sold listings', 'Confirm authenticity before buying'],
    marketContext: gemini.marketContext ?? '',
    pricingBasis: gemini.valuationBasis ?? 'Gemini Vision estimate',
    conditionRisk: params.condition || 'Unknown — inspect carefully',
    authenticityRisk: null,
    profitScenarios: {
      optimistic: mid > 0 ? Math.round((gemini.estimatedRange.high * 0.87 - (asking ?? 0)) * 100) / 100 : null,
      realistic: profit,
      pessimistic: mid > 0 ? Math.round((gemini.estimatedRange.low * 0.87 - (asking ?? 0)) * 100) / 100 : null,
    },
    suggestedMaxBuyPrice: mid > 0 ? Math.round(mid * 0.87 * 0.65 * 100) / 100 : null,
    listingTitle: gemini.comparableDescription?.slice(0, 80) ?? '',
    keySellingPoints: [],
  };
}

function generateFacebookAd(result: BuyDecisionResult, price: number, niche: string): string {
  const lines = [
    `📦 ${result.itemName}`,
    '',
    result.condition && result.condition !== 'Unknown' ? `Condition: ${result.condition}` : '',
    '',
    result.keySellingPoints.length > 0
      ? result.keySellingPoints.slice(0, 3).map(sp => `✅ ${sp}`).join('\n')
      : '',
    '',
    price > 0 ? `💰 Asking: £${price.toFixed(2)}` : '',
    '',
    '📍 Collection / can post',
    '',
    `#${niche.replace(/\s+/g, '')} #ForSale #SWISH`,
  ].filter(l => l !== undefined).join('\n').replace(/\n{3,}/g, '\n\n').trim();

  return lines;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.base, paddingBottom: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  backBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs },
  headerTitle: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold },
  resetBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },
  content: { padding: Spacing.base, gap: Spacing.lg },

  heroCard: { backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.lg, alignItems: 'center', gap: Spacing.sm, borderWidth: 1, ...Shadow.sm },
  heroIcon: { width: 56, height: 56, borderRadius: Radius.xl, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary, textAlign: 'center' },
  heroDesc: { fontSize: Typography.size.sm, color: Colors.textTertiary, textAlign: 'center', lineHeight: 20 },
  heroChips: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap', justifyContent: 'center' },
  heroChip: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: Colors.surfaceBorder },
  heroChipText: { fontSize: 10, color: Colors.textTertiary },

  section: { gap: Spacing.sm },
  sectionLabel: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionHint: { fontSize: Typography.size.xs, color: Colors.textTertiary + '80', lineHeight: 15 },

  input: { backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.surfaceBorder, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, fontSize: Typography.size.sm, color: Colors.textPrimary, includeFontPadding: false },
  inputSmall: { maxWidth: 160 },
  inputMulti: { minHeight: 72, textAlignVertical: 'top' },

  analyseBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, borderRadius: Radius.lg, paddingVertical: Spacing.md + 2, ...Shadow.glow },
  analyseBtnDisabled: { opacity: 0.45 },
  analyseBtnText: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: '#000' },
  loadingHint: { fontSize: Typography.size.xs, color: Colors.textTertiary, textAlign: 'center', lineHeight: 17 },

  errorBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: Colors.dangerDim, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.danger + '40' },
  errorText: { flex: 1, fontSize: Typography.size.xs, color: Colors.danger, lineHeight: 16 },

  // Result styles
  verdictCard: { borderRadius: Radius.xl, padding: Spacing.xl, alignItems: 'center', gap: Spacing.sm, borderWidth: 1.5 },
  verdictIcon: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  verdictLabel: { fontSize: 24, fontWeight: Typography.weight.extrabold, letterSpacing: 1 },
  verdictItem: { fontSize: Typography.size.sm, color: Colors.textSecondary, textAlign: 'center' },
  confPill: { borderRadius: Radius.pill, paddingHorizontal: Spacing.md, paddingVertical: 4 },
  confText: { fontSize: 10, fontWeight: Typography.weight.bold, letterSpacing: 0.5 },

  profitCard: { backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.md, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.surfaceBorder, ...Shadow.sm },
  cardLabel: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  profitRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-start' },
  profitCol: { alignItems: 'center', gap: 3, flex: 1 },
  profitColMid: { backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, paddingVertical: Spacing.xs, paddingHorizontal: Spacing.sm },
  profitLabel: { fontSize: 9, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.3 },
  profitValue: { fontSize: Typography.size.md, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  profitValueBig: { fontSize: Typography.size.xl, fontWeight: Typography.weight.extrabold },
  scenarioRow: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, padding: Spacing.sm },
  scenarioItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 3 },
  scenarioLabel: { flex: 1, fontSize: 9, color: Colors.textTertiary },
  scenarioValue: { fontSize: 10, fontWeight: Typography.weight.bold },
  maxBuyRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, backgroundColor: Colors.primaryDim, borderRadius: Radius.md, padding: Spacing.sm, borderWidth: 1, borderColor: Colors.primary + '30' },
  maxBuyText: { flex: 1, fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 16 },

  infoCard: { backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.md, gap: 0, borderWidth: 1, borderColor: Colors.surfaceBorder },

  reasonsCard: { backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.md, gap: Spacing.sm, borderWidth: 1 },
  reasonsHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  reasonsTitle: { fontSize: 10, fontWeight: Typography.weight.bold, textTransform: 'uppercase', letterSpacing: 0.5 },
  reasonRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.xs },
  reasonText: { flex: 1, fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 17 },

  contextCard: { backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.md, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.surfaceBorder },
  contextText: { fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 18 },
  pricingBasis: { fontSize: 10, color: Colors.textTertiary, fontStyle: 'italic' },
  listingTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.primary, lineHeight: 20 },

  actionRow: { flexDirection: 'row', gap: Spacing.sm },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, borderRadius: Radius.md, paddingVertical: Spacing.md },
  actionBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: '#fff' },

  disclaimer: { fontSize: 10, color: Colors.textTertiary, textAlign: 'center', lineHeight: 14, fontStyle: 'italic' },
});
