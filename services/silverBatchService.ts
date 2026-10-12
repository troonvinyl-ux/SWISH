// SWISH Silver Batch Service
// Manages bulk silver capture sessions — batch CRUD, coin records,
// commercial decision engine, and listing preparation.
// All data persists to the existing Supabase database.

import { getSupabaseClient } from '@/template';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type SaleStrategy = 'bin' | 'auction' | 'group' | 'mixed_lot' | 'hold';

export type CaptureStatus =
  | 'capturing'      // images/measurements not complete
  | 'ready'          // ready for AI analysis
  | 'analysing'      // AI running
  | 'analysed'       // AI done, awaiting commercial decision
  | 'priced'         // market valuation done
  | 'approved'       // user approved listing strategy
  | 'listed'         // eBay listing created
  | 'error';         // analysis failed

export interface SilverBatch {
  id: string;
  tenantId: string;
  name: string;
  reference?: string;
  notes?: string;
  expectedCount: number;
  status: 'active' | 'processing' | 'complete' | 'cancelled';
  captureCount: number;
  completedCount: number;
  estimatedLow: number;
  estimatedHigh: number;
  createdAt: string;
  updatedAt: string;
}

export interface CoinCapture {
  id: string;
  batchId: string;
  tenantId: string;
  captureRef: string;      // e.g. BATCH-20261003-001
  sequenceNumber: number;
  status: CaptureStatus;
  // Images (local URIs during session, permanent URLs after upload)
  obverseUri?: string;
  reverseUri?: string;
  countermarkUri?: string;
  permanentUrls: string[];
  // Physical measurements
  weightGrams?: number;
  diameterMm?: number;
  thicknessMm?: number;
  magnetic?: boolean;
  notes?: string;
  // AI identification result
  aiTitle?: string;
  aiConfidence?: number;
  aiConfidenceTier?: string;
  aiObjectType?: string;
  aiIdentificationState?: string;
  aiAttributes?: Record<string, any>;
  aiEvidenceSupporting?: string[];
  aiMissingInformation?: string[];
  aiWarnings?: string[];
  aiCountermarkAnalysis?: string;
  numistaN?: string;
  numistaMatchScore?: number;
  numistaMatchTier?: string;
  numistaTitle?: string;
  // Market valuation
  valuationLow?: number;
  valuationMid?: number;
  valuationHigh?: number;
  valuationConfidence?: string;
  valuationComparables?: number;
  valuationMethod?: string;
  recommendedPrice?: number;
  recommendedFormat?: string;
  // Commercial decision
  commercialScore?: number;
  saleStrategy?: SaleStrategy;
  groupId?: string;       // if grouped, which group
  auctionStartPrice?: number;
  listingTitle?: string;
  listingDescription?: string;
  categoryId?: string;
  categoryName?: string;
  // User overrides
  userApproved?: boolean;
  userSaleStrategy?: SaleStrategy;
  userPrice?: number;
  userTitle?: string;
  // Linked SWISH inventory item
  itemId?: string;
  listingId?: string;
  // Timestamps
  createdAt: string;
  updatedAt: string;
}

export interface CaptureGroup {
  id: string;
  label: string;
  captureIds: string[];
  groupTitle: string;
  groupDescription: string;
  recommendedPrice: number;
  strategy: 'group' | 'mixed_lot';
  rationale: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// IN-MEMORY SESSION STORE
// Batches and captures persist locally during a session.
// Heavy data (images, AI results) are stored in the React component's state.
// This service handles Supabase-backed persistence via acquisitions table.
// ─────────────────────────────────────────────────────────────────────────────

// Generate a unique capture reference
export function generateCaptureRef(batchDate: string, sequence: number): string {
  return `BATCH-${batchDate}-${String(sequence).padStart(3, '0')}`;
}

// Generate today's date string for batch refs
export function todayDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// BATCH PERSISTENCE (via acquisitions table)
// ─────────────────────────────────────────────────────────────────────────────

export async function createBatch(
  tenantId: string,
  params: {
    name: string;
    reference?: string;
    notes?: string;
    expectedCount: number;
  }
): Promise<{ batch: SilverBatch | null; error: string | null }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('acquisitions')
    .insert({
      tenant_id: tenantId,
      title: params.name,
      description: params.notes ?? '',
      source: params.reference ?? 'Silver Batch Capture',
      item_count: params.expectedCount,
      status: 'pending',
      acquisition_date: new Date().toISOString().split('T')[0],
      notes: JSON.stringify({ type: 'silver_batch', expected_count: params.expectedCount }),
    })
    .select()
    .single();

  if (error) return { batch: null, error: error.message };

  return {
    batch: mapAcquisitionToBatch(data),
    error: null,
  };
}

export async function getActiveBatches(
  tenantId: string
): Promise<{ batches: SilverBatch[]; error: string | null }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('acquisitions')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) return { batches: [], error: error.message };

  // Filter to silver batches only (those with silver_batch marker in notes)
  const batches = (data ?? [])
    .filter(row => {
      try {
        const n = JSON.parse(row.notes ?? '{}');
        return n.type === 'silver_batch';
      } catch { return false; }
    })
    .map(mapAcquisitionToBatch);

  return { batches, error: null };
}

export async function completeBatch(
  tenantId: string,
  batchId: string,
  stats: {
    totalCoins: number;
    individualCount: number;
    auctionCount: number;
    groupedCount: number;
    mixedLotCount: number;
    estimatedLow: number;
    estimatedHigh: number;
  }
): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('acquisitions')
    .update({
      status: 'active',
      item_count: stats.totalCoins,
      processed_count: stats.totalCoins,
      listed_count: stats.individualCount + stats.auctionCount + stats.groupedCount + stats.mixedLotCount,
      expected_gross_revenue: stats.estimatedHigh,
      updated_at: new Date().toISOString(),
    })
    .eq('id', batchId)
    .eq('tenant_id', tenantId);

  return { error: error?.message ?? null };
}

function mapAcquisitionToBatch(row: any): SilverBatch {
  let expected = row.item_count ?? 0;
  try {
    const n = JSON.parse(row.notes ?? '{}');
    if (n.expected_count) expected = n.expected_count;
  } catch {}
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.title,
    reference: row.source,
    notes: row.description,
    expectedCount: expected,
    status: row.status === 'active' ? 'complete' : 'active',
    captureCount: row.item_count ?? 0,
    completedCount: row.processed_count ?? 0,
    estimatedLow: 0,
    estimatedHigh: Number(row.expected_gross_revenue ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// COMMERCIAL DECISION ENGINE
// Determines optimal sale strategy for each captured coin.
// Conservative by design — does NOT invent prices.
// ─────────────────────────────────────────────────────────────────────────────

export interface CommercialDecision {
  strategy: SaleStrategy;
  score: number;                 // 0–100 commercial opportunity score
  recommendedPrice: number;      // 0 = insufficient data
  auctionStartPrice?: number;
  rationale: string;
  listingTitle: string;
  timeEstimateMinutes: number;   // estimated listing effort
  expectedNetAfterFees: number;
  groupSuggestion?: string;      // group label if strategy=group/mixed_lot
}

const EBAY_FEE_RATE = 0.1275; // eBay UK ~12.75% final value fee

function netAfterFees(price: number): number {
  return Math.round(price * (1 - EBAY_FEE_RATE) * 100) / 100;
}

export function computeCommercialDecision(capture: CoinCapture): CommercialDecision {
  const conf = capture.aiConfidence ?? 0;
  const tier = capture.aiConfidenceTier ?? 'very_low';
  const comparables = capture.valuationComparables ?? 0;
  const valuationConf = capture.valuationConfidence ?? 'insufficient_data';
  const mid = capture.valuationMid ?? 0;
  const low = capture.valuationLow ?? 0;
  const high = capture.valuationHigh ?? 0;
  const format = capture.recommendedFormat ?? 'BuyItNow';
  const hasNumista = (capture.numistaMatchScore ?? 0) >= 70;
  const hasGoodData = valuationConf === 'high' || valuationConf === 'medium';
  const hasWeightDiameter = !!(capture.weightGrams && capture.diameterMm);
  const hasImages = !!(capture.obverseUri && capture.reverseUri);
  const isIdentified = conf >= 0.60;
  const isHighConf = conf >= 0.80;
  const isGoodValue = mid >= 15;
  const isHighValue = mid >= 40;
  const hasInsuffData = valuationConf === 'insufficient_data' || comparables < 3;

  // Commercial score components (0–100)
  let score = 0;
  if (isHighConf) score += 30;
  else if (isIdentified) score += 15;
  if (hasGoodData) score += 25;
  else if (comparables >= 3) score += 10;
  if (isGoodValue) score += 15;
  if (isHighValue) score += 10;
  if (hasNumista) score += 10;
  if (hasWeightDiameter) score += 5;
  if (capture.countermarkUri) score += 5; // countermarks add interest
  score = Math.min(100, score);

  // Build title
  const title = buildCaptureTitle(capture);

  // STRATEGY DECISION TREE
  // ────────────────────────
  // Rule 1: High confidence + good data + decent value → individual BIN
  if (isHighConf && hasGoodData && mid >= 15) {
    const price = capture.recommendedPrice ?? Math.round(mid * 0.95 * 100) / 100;
    return {
      strategy: 'bin',
      score,
      recommendedPrice: price,
      rationale: `High identification confidence (${Math.round(conf * 100)}%) with ${comparables} sold comparables. Individual BIN maximises return.`,
      listingTitle: title,
      timeEstimateMinutes: 8,
      expectedNetAfterFees: netAfterFees(price),
    };
  }

  // Rule 2: Medium confidence + some data + any value → auction to discover price
  if (isIdentified && comparables >= 3 && mid >= 8) {
    const startPrice = capture.auctionStartPrice ?? Math.max(0.99, Math.round(mid * 0.15 * 100) / 100);
    return {
      strategy: 'auction',
      score,
      recommendedPrice: startPrice,
      auctionStartPrice: startPrice,
      rationale: `Identifiable coin (${Math.round(conf * 100)}% confidence) with limited comparable data. Auction lets the market discover the price.`,
      listingTitle: title,
      timeEstimateMinutes: 6,
      expectedNetAfterFees: netAfterFees(mid * 0.85), // conservative expectation
    };
  }

  // Rule 3: Low-confidence but identified + low value → grouped lot
  if (isIdentified && mid > 0 && mid < 15) {
    return {
      strategy: 'group',
      score: Math.max(score, 20),
      recommendedPrice: 0, // set at group level
      rationale: `Individual value (£${mid.toFixed(2)}) too low to justify individual listing effort. Better grouped with similar coins.`,
      listingTitle: title,
      timeEstimateMinutes: 2, // minimal per-coin when grouped
      expectedNetAfterFees: 0,
      groupSuggestion: buildGroupLabel(capture),
    };
  }

  // Rule 4: High confidence but no market data → auction
  if (isHighConf && !hasGoodData) {
    return {
      strategy: 'auction',
      score: Math.min(score, 50),
      recommendedPrice: 0.99,
      auctionStartPrice: 0.99,
      rationale: `Well-identified coin but insufficient comparable sales data. Starting auction at £0.99 lets collector market set the price.`,
      listingTitle: title,
      timeEstimateMinutes: 6,
      expectedNetAfterFees: 0,
    };
  }

  // Rule 5: Insufficient identification → mixed/study lot
  return {
    strategy: 'mixed_lot',
    score: Math.max(score, 10),
    recommendedPrice: 0,
    rationale: `Insufficient identification confidence (${Math.round(conf * 100)}%) and/or market data. Include in study/mixed lot.`,
    listingTitle: `Unidentified Silver Coin — Collector Study`,
    timeEstimateMinutes: 1,
    expectedNetAfterFees: 0,
    groupSuggestion: 'Unidentified Silver',
  };
}

function buildCaptureTitle(capture: CoinCapture): string {
  const attrs = capture.aiAttributes ?? {};
  const title = capture.aiTitle ?? '';

  // If we have a good AI title already, clean and use it
  if (title && title.length > 10 && !title.toLowerCase().includes('unknown item')) {
    const cleaned = title
      .replace(/^(possible|probable|likely|provisional)\s*/gi, '')
      .replace(/—.*provisional.*$/gi, '')
      .trim();
    // Append weight if available for silver
    const weightNote = capture.weightGrams ? ` (${capture.weightGrams}g)` : '';
    const countermarkNote = capture.countermarkUri ? ' — Countermarked' : '';
    return `${cleaned}${countermarkNote}${weightNote}`.slice(0, 80);
  }

  // Build from attributes
  const parts: string[] = [];
  const denomination = attrs['denomination'] ?? attrs['coinFields_denomination'] ?? '';
  const issuer = attrs['ruler'] ?? attrs['issuer'] ?? '';
  const period = attrs['period'] ?? '';
  const mint = attrs['mint'] ?? '';

  if (denomination && denomination !== 'Not established') parts.push(denomination);
  if (issuer && issuer !== 'Not established') parts.push(issuer);
  if (period && period !== 'Not established') parts.push(period);
  if (mint && mint !== 'Not established') parts.push(`Mint: ${mint}`);

  if (parts.length >= 2) {
    return `Islamic Silver Coin – ${parts.join(' – ')}`.slice(0, 80);
  }

  return `Unidentified Silver Coin – Collector Study${capture.weightGrams ? ` (${capture.weightGrams}g)` : ''}`.slice(0, 80);
}

function buildGroupLabel(capture: CoinCapture): string {
  const attrs = capture.aiAttributes ?? {};
  const period = attrs['period'] ?? '';
  const conf = capture.aiConfidence ?? 0;

  if (period && period !== 'Not established' && conf >= 0.50) {
    return `Islamic Silver – ${period} Period`;
  }
  if (conf >= 0.50 && capture.aiTitle) {
    const titleWords = capture.aiTitle.split(' ').slice(0, 4).join(' ');
    return `Islamic Silver – ${titleWords}`;
  }
  return 'Unidentified Islamic Silver';
}

// ─────────────────────────────────────────────────────────────────────────────
// BATCH GROUPING ALGORITHM
// Groups captures by similarity for lot listings.
// ─────────────────────────────────────────────────────────────────────────────

export function computeBatchGroups(
  captures: CoinCapture[]
): CaptureGroup[] {
  const groupCandidates = captures.filter(
    c => c.saleStrategy === 'group' || c.saleStrategy === 'mixed_lot'
  );

  const groups: Map<string, CoinCapture[]> = new Map();

  for (const capture of groupCandidates) {
    const label = capture.userSaleStrategy === 'group'
      ? (capture.groupId ?? 'default')
      : computeGroupKey(capture);

    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(capture);
  }

  const result: CaptureGroup[] = [];

  for (const [label, members] of groups.entries()) {
    if (members.length === 0) continue;

    const isStudyLot = members.every(m => m.saleStrategy === 'mixed_lot');
    const totalWeight = members.reduce((s, m) => s + (m.weightGrams ?? 0), 0);
    const avgMid = members.reduce((s, m) => s + (m.valuationMid ?? 0), 0) / members.length;

    // Lot price: sum of individual mids × 0.70 (discount for bulk)
    const totalMid = members.reduce((s, m) => s + (m.valuationMid ?? 0), 0);
    const recommendedPrice = totalMid > 0
      ? Math.round(totalMid * 0.70 * 100) / 100
      : 0;

    const groupTitle = isStudyLot
      ? `${members.length}x Unidentified Silver Coins — Collector Study Lot`
      : `${members.length}x ${label.replace(/_/g, ' ')} Silver Coins`;

    result.push({
      id: `group_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      label,
      captureIds: members.map(m => m.id),
      groupTitle: groupTitle.slice(0, 80),
      groupDescription: buildGroupDescription(members, isStudyLot, totalWeight),
      recommendedPrice,
      strategy: isStudyLot ? 'mixed_lot' : 'group',
      rationale: isStudyLot
        ? `${members.length} unidentified/low-confidence coins — individual listing not cost-effective`
        : `${members.length} similar coins with shared characteristics — lot listing maximises overall value`,
    });
  }

  return result;
}

function computeGroupKey(capture: CoinCapture): string {
  const attrs = capture.aiAttributes ?? {};
  const period = attrs['period'] ?? '';
  const conf = capture.aiConfidence ?? 0;

  if (conf < 0.40) return 'unidentified_mixed';
  if (period && period !== 'Not established') {
    return period.toLowerCase().replace(/\s+/g, '_').slice(0, 30);
  }
  return 'islamic_silver_general';
}

function buildGroupDescription(
  members: CoinCapture[],
  isStudyLot: boolean,
  totalWeight: number
): string {
  const count = members.length;
  const weightNote = totalWeight > 0 ? ` Total weight: approximately ${totalWeight.toFixed(1)}g.` : '';

  if (isStudyLot) {
    return `Lot of ${count} unidentified silver coins. These coins have insufficient evidence for confident individual identification. May include various Islamic, ancient, or medieval silver types. Ideal for researchers and collectors.${weightNote} All shown in photographs. Sold as seen.`;
  }

  const periods = [...new Set(members.map(m => m.aiAttributes?.['period']).filter(Boolean))];
  const periodNote = periods.length > 0 ? ` Period(s): ${periods.join(', ')}.` : '';

  return `Lot of ${count} silver coins with broadly similar characteristics.${periodNote}${weightNote} Each coin individually photographed. Identification notes provided where available. Please review all photographs before purchasing.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// BATCH SUMMARY STATISTICS
// ─────────────────────────────────────────────────────────────────────────────

export interface BatchSummary {
  totalCaptures: number;
  individualBIN: number;
  individualAuction: number;
  grouped: number;
  mixedLot: number;
  unprocessed: number;
  estimatedGrossLow: number;
  estimatedGrossHigh: number;
  averageConfidence: number;
  highConfidenceCount: number;
  mediumConfidenceCount: number;
  lowConfidenceCount: number;
  withNumista: number;
  withMeasurements: number;
}

export function computeBatchSummary(captures: CoinCapture[]): BatchSummary {
  const processed = captures.filter(c => c.status === 'priced' || c.status === 'approved');
  const individualBIN = captures.filter(c => c.saleStrategy === 'bin').length;
  const individualAuction = captures.filter(c => c.saleStrategy === 'auction').length;
  const grouped = captures.filter(c => c.saleStrategy === 'group').length;
  const mixedLot = captures.filter(c => c.saleStrategy === 'mixed_lot').length;
  const unprocessed = captures.filter(c => !c.saleStrategy).length;

  const estimatedLow = captures.reduce((s, c) => s + (c.valuationLow ?? 0), 0);
  const estimatedHigh = captures.reduce((s, c) => s + (c.valuationHigh ?? 0), 0);

  const confs = captures.map(c => c.aiConfidence ?? 0).filter(c => c > 0);
  const avgConf = confs.length > 0 ? confs.reduce((s, c) => s + c, 0) / confs.length : 0;

  return {
    totalCaptures: captures.length,
    individualBIN,
    individualAuction,
    grouped,
    mixedLot,
    unprocessed,
    estimatedGrossLow: Math.round(estimatedLow * 100) / 100,
    estimatedGrossHigh: Math.round(estimatedHigh * 100) / 100,
    averageConfidence: Math.round(avgConf * 100),
    highConfidenceCount: captures.filter(c => (c.aiConfidence ?? 0) >= 0.80).length,
    mediumConfidenceCount: captures.filter(c => {
      const c2 = c.aiConfidence ?? 0;
      return c2 >= 0.50 && c2 < 0.80;
    }).length,
    lowConfidenceCount: captures.filter(c => (c.aiConfidence ?? 0) < 0.50).length,
    withNumista: captures.filter(c => (c.numistaMatchScore ?? 0) >= 70).length,
    withMeasurements: captures.filter(c => c.weightGrams && c.diameterMm).length,
  };
}
