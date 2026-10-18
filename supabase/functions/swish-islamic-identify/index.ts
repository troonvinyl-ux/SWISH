// SWISH Islamic & Indian Silver Identification Engine — v1
//
// SOURCE-DRIVEN IDENTIFICATION PIPELINE:
//   PHOTOGRAPHS → VISUAL ANALYSIS → PHYSICAL DATA → INSCRIPTION ANALYSIS
//   → GENERATE CANDIDATES → SEARCH ZENO → SEARCH NUMISTA
//   → COMPARE EVIDENCE → IDENTIFY HOST COIN + COUNTERMARK SEPARATELY
//   → CATALOGUE MATCH → MARKET RESEARCH → VALUATION
//
// ABSOLUTE RULES:
//   1. AI GENERATES CANDIDATES. External sources (Zeno, Numista) provide evidence.
//   2. NEVER accept the first search result without comparing it to the coin.
//   3. NEVER fabricate catalogue references, inscriptions, or prices.
//   4. NEVER treat asking prices or catalogue data as realised sales.
//   5. Host coin and countermark MUST be identified separately.
//   6. "Not established" and "Insufficient evidence" are valid, correct outcomes.
//   7. Valuation is ALWAYS 0 — handled by swish-market-value with real sale data.
//
// Security: JWT required. Tenant verified when provided.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type CountermarkStatus = 'confirmed' | 'possible' | 'none' | 'uncertain';
type IdentificationState = 'observation_only' | 'candidate' | 'source_supported' | 'verified';
type ConfidenceTier = 'high' | 'medium' | 'low' | 'very_low' | 'insufficient';

interface ZenoSearchResult {
  available: boolean;
  query: string;
  candidates: ZenoCandidate[];
  searchUrl: string;
  error?: string;
  totalFound: number;
}

interface ZenoCandidate {
  zenoId: string;
  title: string;
  dynasty?: string;
  ruler?: string;
  denomination?: string;
  mint?: string;
  date?: string;
  weight?: number;
  diameter?: number;
  imageUrl?: string;
  referenceUrl: string;
  description?: string;
  matchScore: number;
  matchFactors: string[];
  contradictions: string[];
}

interface NumistaSearchResult {
  available: boolean;
  query: string;
  candidates: NumistaCandidate[];
  error?: string;
  totalFound: number;
}

interface NumistaCandidate {
  typeId: number;
  numistaN: string;
  numistaUrl: string;
  title: string;
  dynasty?: string;
  ruler?: string;
  denomination?: string;
  mint?: string;
  issuedFrom?: number;
  issuedTo?: number;
  weight?: number;
  diameter?: number;
  composition?: string;
  references: string[];
  matchScore: number;
  matchFactors: string[];
  contradictions: string[];
}

interface CandidateIdentification {
  candidateId: string; // A, B, C...
  label: string; // Brief label
  dynasty?: string;
  ruler?: string;
  denomination?: string;
  mint?: string;
  dateAH?: string;
  dateCE?: string;
  weightStandard?: string;
  sourceEvidence: string[];
  zenoMatches: string[]; // Zeno IDs that support this
  numistaMatches: string[]; // Numista N# that support this
  supportingFeatures: string[];
  contradictions: string[];
  confidence: number;
  confidenceTier: ConfidenceTier;
  notes: string;
}

interface CountermarkAnalysis {
  status: CountermarkStatus;
  description: string;
  possibleAuthority?: string;
  possibleRuler?: string;
  possibleDate?: string;
  possibleType?: string; // punch, stamp, tamga, inscription, symbol
  inscription?: string;
  symbol?: string;
  zenoReference?: string;
  catalogueReference?: string;
  imageQualitySufficient: boolean;
  notes: string;
  requiresBetterImage: boolean;
}

interface IslamicIdentificationResult {
  // Classification
  objectType: string;
  coinFamily: string; // e.g. 'Timurid', 'Delhi Sultanate', 'Indo-Greek'
  denomination?: string;
  approximateDate?: string;
  identificationState: IdentificationState;

  // Identification
  canonicalTitle: string;
  confidence: number;
  confidenceTier: ConfidenceTier;
  confidenceReason: string;

  // Physical observations
  observations: {
    obverse: string;
    reverse: string;
    edge?: string;
    flanism?: string; // flan shape notes
    inscriptionObverse?: string; // exactly as visible
    inscriptionReverse?: string;
    scriptType?: string;
    visibleCharacters?: string;
    estimatedWeight?: string;
    estimatedDiameter?: string;
    metalColour?: string;
    condition: string;
    conditionGrade?: string;
    conditionNotes: string;
  };

  // Countermark
  countermark: CountermarkAnalysis;

  // Host coin (if countermarked)
  hostCoin?: {
    dynasty?: string;
    ruler?: string;
    denomination?: string;
    mint?: string;
    approximateDate?: string;
    catalogueReference?: string;
    confidence: number;
    notes: string;
  };

  // Multiple candidates considered
  candidates: CandidateIdentification[];
  selectedCandidateId?: string;

  // Source evidence
  zenoSearch: ZenoSearchResult[];
  numistaSearch: NumistaSearchResult;
  sourceEvidenceSummary: string[];
  sourceContradictions: string[];

  // Attributes for database
  attributes: Record<string, any>;
  warnings: string[];
  missingInformation: string[];
  evidenceSupporting: string[];
  evidenceContradictory: string[];
  nextActions: string[];

  // Valuation — always empty at identification stage
  valuationLow: 0;
  valuationMid: 0;
  valuationHigh: 0;
  valuationConfidence: 'insufficient_data';
  marketEvidenceNote: string;

  // Batch
  batchFlags: {
    requiresSpecialistReview: boolean;
    flagReason?: string;
    priority: 'high' | 'medium' | 'low';
    workflowStatus: 'identification_complete' | 'more_info_required' | 'specialist_review' | 'low_commercial_priority';
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ZENO SEARCH ENGINE
// Zeno.ru is the primary specialist reference for Oriental/Islamic coinage.
// We generate multiple targeted queries, fetch search results, parse HTML,
// and extract coin records for comparison against the physical coin.
// ─────────────────────────────────────────────────────────────────────────────

const ZENO_BASE = 'https://www.zeno.ru';

// Generate search candidates from AI visual analysis output
function buildZenoQueries(aiOutput: any, physicalData: any): string[] {
  const queries: string[] = [];
  const dynasty = aiOutput.coinFamily ?? aiOutput.dynasty ?? '';
  const ruler = aiOutput.ruler ?? aiOutput.possibleRuler ?? '';
  const denomination = aiOutput.denomination ?? '';
  const weight = physicalData?.weight ? `${physicalData.weight}g` : '';
  const countermark = aiOutput.countermarkDetected ? 'countermark' : '';

  // Primary targeted query
  if (dynasty && denomination) {
    queries.push(`${dynasty} ${denomination}${weight ? ' ' + weight : ''}`);
  }
  if (ruler && denomination) {
    queries.push(`${ruler} ${denomination}`);
  }
  if (dynasty && ruler) {
    queries.push(`${dynasty} ${ruler}`);
  }

  // Countermark-specific queries
  if (countermark) {
    if (ruler) queries.push(`${ruler} countermark tanka`);
    if (dynasty) queries.push(`${dynasty} countermarked`);
    if (aiOutput.countermarkAuthority) {
      queries.push(`${aiOutput.countermarkAuthority} countermark`);
    }
  }

  // Denomination-specific queries
  if (denomination) {
    const denomLower = denomination.toLowerCase();
    if (denomLower.includes('tanka')) {
      if (dynasty) queries.push(`${dynasty} tanka silver`);
      if (ruler) queries.push(`${ruler} tanka`);
    }
    if (denomLower.includes('dirham')) {
      if (dynasty) queries.push(`${dynasty} dirham silver`);
      if (ruler) queries.push(`${ruler} dirham`);
    }
    if (denomLower.includes('drachm') || denomLower.includes('drachma')) {
      queries.push(`${dynasty} drachm`);
    }
  }

  // Script/inscription-derived queries
  if (aiOutput.visibleInscription && aiOutput.visibleInscription.length > 2) {
    const inscClean = aiOutput.visibleInscription.replace(/[^a-zA-Z0-9\s]/g, '').trim();
    if (inscClean.length > 3) {
      queries.push(`${inscClean} silver coin`);
    }
  }

  // Fallback broad family query
  if (queries.length === 0 && dynasty) {
    queries.push(`${dynasty} silver`);
  }
  if (queries.length === 0) {
    queries.push('Islamic silver hammered');
  }

  // Deduplicate and limit
  const seen = new Set<string>();
  return queries
    .map(q => q.trim())
    .filter(q => q.length >= 3)
    .filter(q => { if (seen.has(q)) return false; seen.add(q); return true; })
    .slice(0, 6);
}

// Parse Zeno search results from HTML
function parseZenoHTML(html: string, query: string): ZenoCandidate[] {
  const candidates: ZenoCandidate[] = [];

  // Zeno returns coin records in a table or list format
  // We extract key patterns from the HTML
  // Patterns: coin ID, title, weight, date, denomination

  // Match coin entries — Zeno uses /coin/NNNNN pattern for individual records
  const coinIdPattern = /\/coin\/(\d+)/g;
  const titlePattern = /<a[^>]+href="[^"]*\/coin\/(\d+)[^"]*"[^>]*>([^<]+)<\/a>/gi;

  const foundIds = new Set<string>();
  let match;

  // Extract titles and IDs
  while ((match = titlePattern.exec(html)) !== null) {
    const zenoId = match[1];
    const rawTitle = match[2].trim();

    if (foundIds.has(zenoId)) continue;
    if (rawTitle.length < 3) continue;
    foundIds.add(zenoId);

    const referenceUrl = `${ZENO_BASE}/coin/${zenoId}`;

    // Extract weight from nearby text (Zeno often shows weight near coin entry)
    let weight: number | undefined;
    const weightMatch = html.substring(Math.max(0, html.indexOf(`/coin/${zenoId}`) - 200), html.indexOf(`/coin/${zenoId}`) + 500).match(/(\d+\.?\d*)\s*g(?:r|m)?(?:\s|,|<)/i);
    if (weightMatch) weight = parseFloat(weightMatch[1]);

    // Extract date hints
    let date: string | undefined;
    const dateMatch = rawTitle.match(/\b(\d{3,4})\s*(?:AH|CE|AD|BC)?\b/);
    if (dateMatch) date = dateMatch[1];

    // Extract denomination hints from title
    let denomination: string | undefined;
    const denomPatterns = ['tanka', 'dirham', 'drachm', 'rupee', 'fractional', 'half tanka', 'quarter tanka', 'jital', 'billon'];
    for (const d of denomPatterns) {
      if (rawTitle.toLowerCase().includes(d)) { denomination = d; break; }
    }

    const candidate: ZenoCandidate = {
      zenoId,
      title: rawTitle,
      denomination,
      weight,
      date,
      referenceUrl,
      matchScore: 0, // scored separately
      matchFactors: [],
      contradictions: [],
    };

    candidates.push(candidate);

    if (candidates.length >= 8) break;
  }

  return candidates;
}

// Score a Zeno candidate against physical evidence
function scoreZenoCandidate(
  candidate: ZenoCandidate,
  aiOutput: any,
  physicalData: any,
  query: string,
): { score: number; factors: string[]; contradictions: string[] } {
  const factors: string[] = [];
  const contradictions: string[] = [];
  let score = 0;

  const titleLower = candidate.title.toLowerCase();
  const queryTerms = query.toLowerCase().split(/\s+/);

  // Title relevance — how many query terms appear in the result title
  let termMatches = 0;
  for (const term of queryTerms) {
    if (term.length > 2 && titleLower.includes(term)) termMatches++;
  }
  const termScore = Math.min(30, termMatches * 10);
  score += termScore;
  if (termMatches > 0) factors.push(`Title contains ${termMatches} search term${termMatches > 1 ? 's' : ''}`);

  // Dynasty/family match
  const dynasty = (aiOutput.coinFamily ?? aiOutput.dynasty ?? '').toLowerCase();
  if (dynasty.length > 2 && titleLower.includes(dynasty)) {
    score += 20; factors.push(`Dynasty match: ${dynasty}`);
  }

  // Ruler match
  const ruler = (aiOutput.ruler ?? '').toLowerCase();
  if (ruler.length > 2 && titleLower.includes(ruler)) {
    score += 15; factors.push(`Ruler match: ${ruler}`);
  }

  // Denomination match
  const denom = (aiOutput.denomination ?? '').toLowerCase();
  if (denom.length > 2 && titleLower.includes(denom)) {
    score += 15; factors.push(`Denomination match: ${denom}`);
  }
  if (candidate.denomination && denom && !denom.includes(candidate.denomination) && !candidate.denomination.includes(denom)) {
    score -= 10; contradictions.push(`Denomination mismatch: searched "${denom}", found "${candidate.denomination}"`);
  }

  // Weight check
  if (candidate.weight && physicalData?.weight) {
    const diff = Math.abs(candidate.weight - physicalData.weight) / physicalData.weight;
    if (diff <= 0.05) {
      score += 15; factors.push(`Weight match: ${physicalData.weight}g vs Zeno ${candidate.weight}g`);
    } else if (diff <= 0.12) {
      score += 5; factors.push(`Weight approximate: ${physicalData.weight}g vs Zeno ${candidate.weight}g`);
    } else {
      score -= 10; contradictions.push(`Weight mismatch: ${physicalData.weight}g vs Zeno ${candidate.weight}g (${(diff * 100).toFixed(0)}%)`);
    }
  }

  // Countermark relevance
  if (aiOutput.countermarkDetected && titleLower.includes('countermark')) {
    score += 10; factors.push('Countermark reference in Zeno entry');
  }

  return { score: Math.max(0, score), factors, contradictions };
}

async function searchZeno(
  query: string,
  aiOutput: any,
  physicalData: any,
): Promise<ZenoSearchResult> {
  const searchUrl = `${ZENO_BASE}/search/?q=${encodeURIComponent(query)}&category=coins`;

  try {
    const resp = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SWISH-Numismatic-Research/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(12000),
    });

    if (!resp.ok) {
      // Try alternative Zeno search path
      const altUrl = `${ZENO_BASE}/?find=${encodeURIComponent(query)}`;
      const altResp = await fetch(altUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SWISH-Numismatic-Research/1.0)' },
        signal: AbortSignal.timeout(8000),
      });

      if (!altResp.ok) {
        return {
          available: false, query, candidates: [], searchUrl,
          error: `Zeno search returned HTTP ${resp.status}`, totalFound: 0,
        };
      }

      const altHtml = await altResp.text();
      const altCandidates = parseZenoHTML(altHtml, query);
      const scored = altCandidates.map(c => {
        const { score, factors, contradictions } = scoreZenoCandidate(c, aiOutput, physicalData, query);
        return { ...c, matchScore: score, matchFactors: factors, contradictions };
      }).sort((a, b) => b.matchScore - a.matchScore);

      return {
        available: true, query, candidates: scored.slice(0, 5),
        searchUrl: altUrl, totalFound: altCandidates.length,
      };
    }

    const html = await resp.text();
    const rawCandidates = parseZenoHTML(html, query);

    const scored = rawCandidates.map(c => {
      const { score, factors, contradictions } = scoreZenoCandidate(c, aiOutput, physicalData, query);
      return { ...c, matchScore: score, matchFactors: factors, contradictions };
    }).sort((a, b) => b.matchScore - a.matchScore);

    console.log(`[swish-islamic-identify] Zeno "${query}": ${rawCandidates.length} raw, ${scored.length} scored`);

    return {
      available: true, query, candidates: scored.slice(0, 5),
      searchUrl, totalFound: rawCandidates.length,
    };
  } catch (e: any) {
    console.error(`[swish-islamic-identify] Zeno search error for "${query}": ${e.message}`);
    return {
      available: false, query, candidates: [], searchUrl,
      error: `Network error: ${e.message}`, totalFound: 0,
    };
  }
}

// Run multiple Zeno searches with different queries, returning all results
async function runZenoSearchPipeline(
  queries: string[],
  aiOutput: any,
  physicalData: any,
): Promise<ZenoSearchResult[]> {
  const results: ZenoSearchResult[] = [];

  // Run up to 4 queries (staggered to be polite to the server)
  for (const q of queries.slice(0, 4)) {
    const r = await searchZeno(q, aiOutput, physicalData);
    results.push(r);
    // Brief pause between requests
    await new Promise(resolve => setTimeout(resolve, 400));
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// NUMISTA SEARCH — extended for Islamic/Indian denominations
// ─────────────────────────────────────────────────────────────────────────────

const NUMISTA_API = 'https://api.numista.com/api/v3';

async function searchNumistaIslamicSilver(
  aiOutput: any,
  physicalData: any,
  apiKey: string,
): Promise<NumistaSearchResult> {
  if (!apiKey) {
    return { available: false, query: '', candidates: [], error: 'Numista API key not configured', totalFound: 0 };
  }

  const dynasty = aiOutput.coinFamily ?? aiOutput.dynasty ?? '';
  const ruler = aiOutput.ruler ?? '';
  const denomination = aiOutput.denomination ?? '';

  // Do not let a possibly wrong AI dynasty/ruler narrow catalogue search to a
  // single family. Search the specific candidate AND broader denomination/family
  // variants, then merge and deduplicate before ranking by independent evidence.
  const queryParts: string[] = [];
  if (ruler && ruler.length > 2) queryParts.push(ruler);
  if (denomination && denomination.length > 2) queryParts.push(denomination);
  if (dynasty && dynasty.length > 2) queryParts.push(dynasty);
  const primaryQuery = queryParts.slice(0, 3).join(' ').trim();
  const weight = Number(physicalData?.weight);
  const queries = [
    primaryQuery,
    [denomination, dynasty].filter(Boolean).join(' ').trim(),
    [denomination, ruler].filter(Boolean).join(' ').trim(),
    // Broad query is intentionally not tied to a single dynasty. Specific
    // Deccan/Bijapur records should be surfaced by source evidence, not injected
    // as a special-case preferred answer.
    'Islamic copper falus India Deccan',
    'Islamic copper coin',
    Number.isFinite(weight) && weight > 0 ? `Islamic coin ${weight.toFixed(2)}g` : '',
  ].filter((q, i, all) => q.length > 2 && all.indexOf(q) === i).slice(0, 5);
  const query = queries.join(' | ') || 'Islamic coin';

  const candidateMap = new Map<number, any>();
  let successfulQueries = 0;
  let firstError = '';

  try {
    for (const q of queries) {
      const resp = await fetch(
        `${NUMISTA_API}/types?q=${encodeURIComponent(q)}&lang=en&count=20`,
        { headers: { 'Numista-API-Key': apiKey }, signal: AbortSignal.timeout(10000) },
      );
      if (!resp.ok) {
        firstError ||= `Numista API error: ${resp.status}`;
        continue;
      }
      successfulQueries++;
      const data = await resp.json();
      for (const t of (data.types ?? [])) {
        if (t?.id != null) candidateMap.set(Number(t.id), t);
      }
    }

    if (successfulQueries === 0) {
      return { available: false, query, candidates: [], error: firstError || 'Numista search unavailable', totalFound: 0 };
    }

    const candidates = [...candidateMap.values()]
      .map(t => scoreNumistaIslamic(t, aiOutput, physicalData))
      .sort((a, b) => b.matchScore - a.matchScore);

    console.log(`[swish-islamic-identify] Numista multi-query search: ${queries.length} queries, ${candidateMap.size} unique types, top score=${candidates[0]?.matchScore ?? 0}`);

    return { available: true, query, candidates: candidates.slice(0, 12), totalFound: candidateMap.size };
  } catch (e: any) {
    return { available: successfulQueries > 0, query, candidates: [...candidateMap.values()].map(t => scoreNumistaIslamic(t, aiOutput, physicalData)).sort((a, b) => b.matchScore - a.matchScore).slice(0, 12), error: `Numista error: ${e.message}`, totalFound: candidateMap.size };
  }
}

function scoreNumistaIslamic(
  type: any,
  aiOutput: any,
  physicalData: any,
): NumistaCandidate {
  const factors: string[] = [];
  const contradictions: string[] = [];
  let score = 0;

  const titleLower = (type.title ?? '').toLowerCase();
  const dynasty = (aiOutput.coinFamily ?? aiOutput.dynasty ?? '').toLowerCase();
  const ruler = (aiOutput.ruler ?? '').toLowerCase();
  const denomination = (aiOutput.denomination ?? '').toLowerCase();
  const candidateText = [
    type.title,
    type.description,
    type.obverse?.description,
    type.reverse?.description,
    type.min_unit?.name,
  ].filter((v: unknown) => typeof v === 'string').join(' ').toLowerCase();
  const normalize = (v: string) => v.normalize('NFKD').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

  // Reward reliable ruler/denomination evidence, but do not let a potentially
  // mistaken first-pass dynasty overwhelm hard physical or catalogue evidence.
  if (dynasty.length > 2 && normalize(candidateText).includes(normalize(dynasty))) {
    score += 18; factors.push(`Dynasty/family text match: ${dynasty}`);
  }
  if (ruler.length > 2 && normalize(candidateText).includes(normalize(ruler))) {
    score += 22; factors.push(`Ruler match: ${ruler}`);
  }
  const unitText = (type.min_unit?.name ?? '').toLowerCase();
  if (denomination.length > 2 && (normalize(candidateText).includes(normalize(denomination)) || normalize(unitText).includes(normalize(denomination)))) {
    score += 18; factors.push(`Denomination match: ${denomination}`);
  }

  // Islamic/Deccan fallback cues let catalogued candidates survive an incorrect
  // AI dynasty guess long enough for measurements and source details to decide.
  const deccanTerms = ['bijapur', 'ibrahim adil shah', 'adil shah', 'deccan', 'falus'];
  const candidateNorm = normalize(candidateText);
  const hasDeccanCue = deccanTerms.some(term => candidateNorm.includes(normalize(term)));
  if (hasDeccanCue && !dynasty && !ruler) {
    score += 8; factors.push('Relevant Deccan/Islamic fallback candidate');
  }
  // Do not special-case a remembered coin/weight here. Every candidate must
  // earn its score from the supplied measurement against its own catalogue spec.

  // Compare physical specs with asymmetric wear tolerance; hard mismatches
  // should penalize rather than be outweighed by a vague family-text match.
  if (physicalData?.weight && type.weight) {
    const diff = Math.abs(physicalData.weight - type.weight) / type.weight;
    if (diff <= 0.05) {
      score += 18; factors.push(`Weight match: ${physicalData.weight}g vs catalogue ${type.weight}g`);
    } else if (diff <= 0.12) {
      score += 7; factors.push(`Weight approximate: ${physicalData.weight}g vs ${type.weight}g`);
    } else {
      score -= 18; contradictions.push(`Weight mismatch: ${physicalData.weight}g vs catalogue ${type.weight}g`);
    }
  }
  if (physicalData?.diameter && type.diameter) {
    const diffMm = Math.abs(physicalData.diameter - type.diameter);
    if (diffMm <= 1.5) {
      score += 12; factors.push(`Diameter match: ${physicalData.diameter}mm vs catalogue ${type.diameter}mm`);
    } else if (diffMm <= 3) {
      score += 4; factors.push(`Diameter approximate: ${physicalData.diameter}mm vs catalogue ${type.diameter}mm`);
    } else {
      score -= 12; contradictions.push(`Diameter mismatch: ${physicalData.diameter}mm vs catalogue ${type.diameter}mm`);
    }
  }
  const material = (type.composition?.material ?? '').toLowerCase();
  if (material && /copper|bronze|brass/.test(material)) {
    if (/copper|bronze|brass/.test(String(aiOutput.metalColour ?? aiOutput.composition ?? '').toLowerCase())) {
      score += 5; factors.push('Material consistent with observed metal description');
    }
  }

  const refs: string[] = (type.references ?? []).map((r: any) => `${r.catalogue?.code ?? ''} ${r.number ?? ''}`.trim()).filter(Boolean);

  return {
    typeId: type.id,
    numistaN: `N#${type.id}`,
    numistaUrl: `https://en.numista.com/catalogue/index.php?r=${type.id}`,
    title: type.title ?? '',
    denomination: type.min_unit?.name,
    issuedFrom: type.issued_from,
    issuedTo: type.issued_to,
    weight: type.weight,
    diameter: type.diameter,
    composition: type.composition?.material,
    references: refs,
    matchScore: Math.max(0, score),
    matchFactors: factors,
    contradictions,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AI VISION ANALYSIS PROMPT — Islamic/Indian Silver Specialist
// ─────────────────────────────────────────────────────────────────────────────

const ISLAMIC_SILVER_SYSTEM_PROMPT = `You are a specialist numismatist with deep expertise in:
- Islamic coinage (Timurid, Ilkhanid, Safavid, Ottoman, Abbasid, Umayyad, Ghaznavid, Seljuk)
- Indo-Islamic coinage (Delhi Sultanate, Bengal Sultanate, Gujarat Sultanate, Malwa, Deccan)
- Mughal and pre-Mughal Indian silver
- Central Asian coinage (Transoxiana, Khorasan, Khwarazm)
- Indo-Greek, Indo-Scythian, Kushan, and related Hellenistic-derived Indian coinages
- Countermarked coins of all the above traditions

YOUR ROLE IS OBSERVATION AND CANDIDATE GENERATION.
Zeno.ru and Numista will then be searched to corroborate or reject your candidates.
You are NOT the primary evidence source — you are the analytical layer that reads the image.

ABSOLUTE RULES:
1. NEVER invent inscriptions. Copy only characters you can actually see.
2. NEVER assign a ruler, mint, or date you cannot support from the visible image.
3. NEVER fabricate a catalogue reference.
4. COUNTERMARK DETECTION IS MANDATORY. Inspect every coin for secondary punches, stamps, tamgas, symbols.
5. SEPARATE host coin from countermark. Never assume the countermarking authority struck the host.
6. Weight is HARD EVIDENCE. State explicitly if a candidate is incompatible with supplied weight.
7. PARTIAL INSCRIPTION is the correct response for worn coins — never complete unseen text.
8. If you cannot identify: observation_only is the correct state. Never force an identification.

SCRIPT IDENTIFICATION GUIDE:
- Arabic Kufic: angular, early Islamic
- Arabic Naskh: flowing, later Islamic  
- Persian Nastaliq: cursive, Timurid/Safavid
- Devanagari: distinctive rounded script with top bar
- Brahmi-derived: various South Asian scripts
- If uncertain: state "Script present but type uncertain"

DENOMINATION WEIGHT STANDARDS (approximate — allow for wear/clipping):
- Full tanka: ~9.8-11g (varies by period and issuer)
- Half tanka: ~4.9-5.5g
- Quarter tanka: ~2.4-2.8g  
- Fractional: <2g
- Full dirham: ~2.8-3.2g (Abbasid standard), varies widely
- Full drachm: ~4g (Sasanian standard), varies
- Rupee (early): ~11.5g
- Heavy tanka (Bengal): ~10.5-11.5g
These are guidance ranges only — actual coins vary significantly.

COUNTERMARK TYPES TO DETECT:
- Punch marks (simple indentations)
- Stamp marks (flat face stamps)
- Tamgas (tribal symbols, often abstract)
- Arabic/Persian letter stamps
- Square cartouche stamps  
- Circular stamps
- Religious symbols (crescent, star, etc.)
- Overstruck dies
- Multiple countermarks from different authorities

Return ONLY valid JSON — no markdown fences:`;

const ISLAMIC_OUTPUT_SCHEMA = `{
  "objectType": "coin|medal|token|unknown",
  "coinFamily": "Timurid|Delhi Sultanate|Bengal Sultanate|Gujarat Sultanate|Mughal|Indo-Greek|Indo-Scythian|Kushan|Ilkhanid|Abbasid|Unknown Islamic|Unknown Indian|Other",
  "identificationState": "observation_only|candidate|source_supported|verified",
  "canonicalTitle": "Conservative title. If uncertain: prefix with 'Possible' or 'Probable'. Never fabricate specifics.",
  
  "possibleDynasty": "Most likely dynasty from visual evidence — or null",
  "possibleRuler": "Most likely ruler if determinable — or null. Do NOT guess from partial inscription.",
  "denomination": "Denomination if determinable — or null. Use weight standard ranges for guidance.",
  "approximateDate": "Date range if estimable — or null",
  "approximateDateAH": "AH date if Islamic calendar date is visible — or null",
  
  "inscriptionAnalysis": {
    "obverseScript": "Script type detected or 'Not determinable'",
    "reverseScript": "Script type detected or 'Not determinable'",
    "obverseText": "Exact characters visible — copy precisely. Partial is correct. Never complete unseen text.",
    "reverseText": "Exact characters visible — or 'Not legible'",
    "inscriptionQuality": "clear|partial|very worn|illegible",
    "languageHint": "Arabic|Persian|Devanagari|Brahmi|Greek|Mixed|Not determinable"
  },
  
  "physicalObservations": {
    "obverse": "Description of visible obverse design, portrait, inscription",
    "reverse": "Description of visible reverse design, inscription",
    "edge": "Observations on edge/flan shape",
    "flanism": "Flan shape: round|irregular|planchet|test cut|description",
    "metalColour": "Silver|Billon|Debased silver|White metal|Other",
    "estimatedCondition": "VF|Fine|VG|Good|Poor|Fair — or describe if non-standard scale",
    "wearLevel": "Lightly worn|Moderately worn|Heavily worn|Very heavily worn",
    "hasCorrosion": false,
    "hasTestCut": false,
    "hasGraffiti": false
  },
  
  "countermarkAssessment": {
    "countermarkDetected": false,
    "countermarkStatus": "confirmed|possible|none|uncertain",
    "countermarkDescription": "Description of any secondary punch, stamp, tamga, symbol",
    "countermarkType": "punch|stamp|tamga|inscription|symbol|overstrike|multiple|none|uncertain",
    "countermarkInscription": "Any text in countermark — exact visible characters only",
    "countermarkSymbol": "Description of any symbol/tamga",
    "countermarkPosition": "obverse|reverse|edge|unknown",
    "possibleCountermarkAuthority": "Authority if determinable — or null",
    "possibleCountermarkRuler": "Ruler if determinable — or null",
    "possibleCountermarkDate": "Date range if estimable — or null",
    "imageResolutionSufficient": true,
    "requiresBetterImage": false,
    "countermarkNotes": "Notes on countermark analysis"
  },
  
  "hostCoinAssessment": {
    "applicable": false,
    "possibleDynasty": null,
    "possibleRuler": null,
    "possibleDenomination": null,
    "possibleMint": null,
    "possibleDate": null,
    "catalogueHint": null,
    "confidence": 0.0,
    "notes": "Assessment of the host coin prior to countermarking"
  },
  
  "candidates": [
    {
      "candidateId": "A",
      "label": "Brief descriptive label",
      "dynasty": "Dynasty or null",
      "ruler": "Ruler or null",
      "denomination": "Denomination or null",
      "mint": "Mint or null",
      "approximateDateAH": "AH date range or null",
      "approximateDateCE": "CE date range or null",
      "weightCompatible": true,
      "weightNote": "Assessment of weight compatibility",
      "supportingFeatures": ["Feature 1 that supports this candidate"],
      "contradictions": ["Feature that contradicts this candidate"],
      "confidence": 0.0,
      "notes": "Why this candidate was considered"
    }
  ],
  "selectedCandidateId": "A",
  
  "zenoSearchQueries": ["Query 1", "Query 2", "Query 3"],
  
  "confidence": 0.0,
  "confidenceReason": "Specific explanation of confidence level based on visible evidence",
  
  "evidenceSupporting": ["Visible feature supporting identification"],
  "evidenceContradictory": ["Feature not fitting identification"],
  "missingInformation": ["What cannot be determined — be specific"],
  "warnings": ["Specific factual warnings"],
  
  "condition": "Based on visible characteristics only",
  "conditionGrade": "Grade if assessable — null if not",
  "conditionNotes": "Specific observations: wear, strike, flan quality, damage",
  
  "hasHole": false,
  "hasAlteration": false,
  "alterationNotes": null,
  
  "valuationLow": 0,
  "valuationMid": 0,
  "valuationHigh": 0,
  "valuationConfidence": "insufficient_data"
}`;

// ─────────────────────────────────────────────────────────────────────────────
// COMPARE AI CANDIDATES AGAINST SEARCH RESULTS
// ─────────────────────────────────────────────────────────────────────────────

function reconcileCandidatesWithSources(
  aiCandidates: any[],
  zenoResults: ZenoSearchResult[],
  numistaResult: NumistaSearchResult,
  physicalData: any,
): { enhancedCandidates: CandidateIdentification[]; sourceContradictions: string[]; sourceEvidence: string[] } {
  const enhancedCandidates: CandidateIdentification[] = [];
  const sourceEvidence: string[] = [];
  const sourceContradictions: string[] = [];

  // Collect all Zeno candidates with decent scores
  const allZenoCandidates: (ZenoCandidate & { query: string })[] = [];
  for (const zr of zenoResults) {
    if (!zr.available) continue;
    for (const zc of zr.candidates.filter(c => c.matchScore >= 20)) {
      allZenoCandidates.push({ ...zc, query: zr.query });
    }
  }

  // Collect Numista candidates with decent scores
  const topNumistaCandidates = numistaResult.candidates.filter(c => c.matchScore >= 20);

  for (const aiCand of aiCandidates) {
    const candId = aiCand.candidateId ?? 'A';
    const zenoSupport: string[] = [];
    const numistaSupport: string[] = [];
    const allContradictions = [...(aiCand.contradictions ?? [])];

    // Check each Zeno result against this candidate
    for (const zc of allZenoCandidates) {
      const titleLower = zc.title.toLowerCase();
      const dynasty = (aiCand.dynasty ?? '').toLowerCase();
      const ruler = (aiCand.ruler ?? '').toLowerCase();
      const denom = (aiCand.denomination ?? '').toLowerCase();

      let zenoMatchScore = 0;
      if (dynasty.length > 2 && titleLower.includes(dynasty)) zenoMatchScore += 2;
      if (ruler.length > 2 && titleLower.includes(ruler)) zenoMatchScore += 2;
      if (denom.length > 2 && titleLower.includes(denom)) zenoMatchScore += 1;

      if (zenoMatchScore >= 2) {
        // The same Zeno record can appear in multiple search queries.
        // Count a record once; query repetition is not independent corroboration.
        if (!zenoSupport.some(existing => existing.startsWith(`Zeno #${zc.zenoId}:`))) {
          zenoSupport.push(`Zeno #${zc.zenoId}: "${zc.title}" (query: "${zc.query}")`);
        }
        if (!sourceEvidence.includes(`Zeno reference: ${zc.title}`)) {
          sourceEvidence.push(`Zeno reference: ${zc.title} — ${zc.referenceUrl}`);
        }
      }

      // Weight contradiction check
      if (zc.weight && physicalData?.weight) {
        const diff = Math.abs(zc.weight - physicalData.weight) / physicalData.weight;
        if (diff > 0.15 && zenoMatchScore >= 2) {
          allContradictions.push(`Zeno example weight (${zc.weight}g) differs from supplied weight (${physicalData.weight}g)`);
        }
      }
    }

    // Check Numista candidates
    for (const nc of topNumistaCandidates) {
      const titleLower = nc.title.toLowerCase();
      const dynasty = (aiCand.dynasty ?? '').toLowerCase();
      const ruler = (aiCand.ruler ?? '').toLowerCase();
      const denom = (aiCand.denomination ?? '').toLowerCase();

      let numistaMatchScore = 0;
      if (dynasty.length > 2 && titleLower.includes(dynasty)) numistaMatchScore += 2;
      if (ruler.length > 2 && titleLower.includes(ruler)) numistaMatchScore += 2;
      if (denom.length > 2 && (titleLower.includes(denom) || (nc.denomination ?? '').toLowerCase().includes(denom))) numistaMatchScore += 1;

      if (numistaMatchScore >= 2) {
        // A catalogue type returned by several queries remains one source record.
        if (!numistaSupport.some(existing => existing.startsWith(`${nc.numistaN}:`))) {
          numistaSupport.push(`${nc.numistaN}: "${nc.title}"`);
        }
        if (!sourceEvidence.includes(`Numista: ${nc.title}`)) {
          sourceEvidence.push(`Numista ${nc.numistaN}: "${nc.title}" — ${nc.numistaUrl}`);
        }
      }
    }

    // Adjust confidence based on source support
    let baseConfidence = aiCand.confidence ?? 0.3;
    if (zenoSupport.length >= 2) baseConfidence = Math.min(0.80, baseConfidence + 0.20);
    else if (zenoSupport.length === 1) baseConfidence = Math.min(0.70, baseConfidence + 0.12);

    if (numistaSupport.length >= 2) baseConfidence = Math.min(0.85, baseConfidence + 0.15);
    else if (numistaSupport.length === 1) baseConfidence = Math.min(0.75, baseConfidence + 0.08);

    // Deduct for contradictions from sources
    baseConfidence -= allContradictions.filter(c => c.includes('Zeno') || c.includes('Numista')).length * 0.08;

    const finalConfidence = Math.max(0.05, Math.min(0.90, baseConfidence));

    let tier: ConfidenceTier;
    if (finalConfidence >= 0.75) tier = 'high';
    else if (finalConfidence >= 0.55) tier = 'medium';
    else if (finalConfidence >= 0.35) tier = 'low';
    else if (finalConfidence >= 0.15) tier = 'very_low';
    else tier = 'insufficient';

    const enhanced: CandidateIdentification = {
      candidateId: candId,
      label: aiCand.label ?? `Candidate ${candId}`,
      dynasty: aiCand.dynasty,
      ruler: aiCand.ruler,
      denomination: aiCand.denomination,
      mint: aiCand.mint,
      dateAH: aiCand.approximateDateAH,
      dateCE: aiCand.approximateDateCE,
      sourceEvidence: [...zenoSupport, ...numistaSupport],
      zenoMatches: zenoSupport,
      numistaMatches: numistaSupport,
      supportingFeatures: aiCand.supportingFeatures ?? [],
      contradictions: allContradictions,
      confidence: finalConfidence,
      confidenceTier: tier,
      notes: aiCand.notes ?? '',
    };

    enhancedCandidates.push(enhanced);
  }

  // Contradictions from source searches
  for (const zr of zenoResults) {
    if (!zr.available && zr.error) {
      // Not a true contradiction — just availability note
    }
  }

  return { enhancedCandidates, sourceContradictions, sourceEvidence };
}

// ─────────────────────────────────────────────────────────────────────────────
// DETERMINE FINAL IDENTIFICATION STATE
// ─────────────────────────────────────────────────────────────────────────────

function determineIdentificationState(
  enhancedCandidates: CandidateIdentification[],
  zenoResults: ZenoSearchResult[],
  numistaResult: NumistaSearchResult,
  aiOutput: any,
): IdentificationState {
  const selected = enhancedCandidates.find(c => c.candidateId === aiOutput.selectedCandidateId)
    ?? enhancedCandidates[0];

  if (!selected) return 'observation_only';

  const hasZenoSupport = selected.zenoMatches.length > 0;
  const hasNumistaSupport = selected.numistaMatches.length > 0;
  const hasAnySourceSupport = hasZenoSupport || hasNumistaSupport;

  if (selected.confidence >= 0.75 && hasAnySourceSupport) return 'source_supported';
  if (selected.confidence >= 0.50 && hasAnySourceSupport) return 'source_supported';
  if (selected.confidence >= 0.35) return 'candidate';
  return 'observation_only';
}

// ─────────────────────────────────────────────────────────────────────────────
// BUILD BATCH FLAGS
// ─────────────────────────────────────────────────────────────────────────────

function buildBatchFlags(
  aiOutput: any,
  selectedCandidate: CandidateIdentification | undefined,
  identificationState: IdentificationState,
): IslamicIdentificationResult['batchFlags'] {
  const countermarkDetected = aiOutput.countermarkAssessment?.countermarkDetected;
  const requiresBetterImage = aiOutput.countermarkAssessment?.requiresBetterImage
    || aiOutput.inscriptionAnalysis?.inscriptionQuality === 'illegible';

  if (countermarkDetected) {
    return {
      requiresSpecialistReview: true,
      flagReason: 'Countermarked coin — host coin and countermark require separate identification',
      priority: 'high',
      workflowStatus: 'specialist_review',
    };
  }

  if (requiresBetterImage || identificationState === 'observation_only') {
    return {
      requiresSpecialistReview: false,
      flagReason: requiresBetterImage ? 'Better images required for identification' : 'Insufficient evidence for identification',
      priority: 'medium',
      workflowStatus: 'more_info_required',
    };
  }

  if (selectedCandidate && selectedCandidate.confidence >= 0.65) {
    // Check if potentially rare/unusual
    const rareIndicators = ['unique', 'rare', 'unusual mint', 'unusual ruler', 'undocumented', 'unpublished'];
    const isRare = rareIndicators.some(r =>
      (selectedCandidate.notes ?? '').toLowerCase().includes(r) ||
      (aiOutput.warnings ?? []).some((w: string) => w.toLowerCase().includes(r))
    );

    if (isRare) {
      return {
        requiresSpecialistReview: true,
        flagReason: 'Potentially rare or unusual — specialist review recommended',
        priority: 'high',
        workflowStatus: 'specialist_review',
      };
    }

    return {
      requiresSpecialistReview: false,
      priority: 'medium',
      workflowStatus: 'identification_complete',
    };
  }

  if (selectedCandidate && selectedCandidate.confidence < 0.35) {
    return {
      requiresSpecialistReview: false,
      flagReason: 'Low confidence — more information required',
      priority: 'medium',
      workflowStatus: 'more_info_required',
    };
  }

  return {
    requiresSpecialistReview: false,
    priority: 'low',
    workflowStatus: 'identification_complete',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get('ONSPACE_AI_API_KEY');
    const baseUrl = Deno.env.get('ONSPACE_AI_BASE_URL');
    const numistaApiKey = Deno.env.get('NUMISTA_API_KEY') ?? '';

    if (!apiKey || !baseUrl) {
      return new Response(
        JSON.stringify({ error: 'OnSpace AI not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // JWT auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Authentication required.' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const token = authHeader.replace('Bearer ', '').trim();
    if (!token || token === Deno.env.get('SUPABASE_ANON_KEY')) {
      return new Response(JSON.stringify({ error: 'Authentication required.' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired authentication token.' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const body = await req.json();
    const {
      images,           // base64 or URLs
      existingImageUrls,
      weight,           // grams (number)
      diameter,         // mm (number)
      notes,            // user notes
      tenantId,
      itemId,
      isBatch,          // boolean
      batchIndex,       // number
    } = body;

    // ── ENTITLEMENT & QUOTA CHECK (mirrors swish-identify v6) ─────────────────
    // Premium tiers bypass quota entirely. Free users are limited to 5/month.
    const STRIPE_PRODUCT_ID_ISLAMIC = 'prod_VQ0JxUCL29SZPQ';
    const FREE_MONTHLY_QUOTA_ISLAMIC = 5;
    const FEATURE_KEY_ISLAMIC = 'identify';
    const PREMIUM_TIERS_ISLAMIC = new Set(['professional', 'business', 'enterprise', 'lifetime']);

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const monthKeyNow = new Date();
    const monthKey = `${monthKeyNow.getUTCFullYear()}-${String(monthKeyNow.getUTCMonth() + 1).padStart(2, '0')}`;

    // Resolve tenant tier (authoritative — service role, cannot be spoofed)
    let isPremiumIslamic = false;
    if (tenantId) {
      try {
        const { data: membership } = await adminClient.from('tenant_memberships')
          .select('id').eq('tenant_id', tenantId).eq('user_id', user.id).maybeSingle();
        if (membership) {
          const { data: tenantRow } = await adminClient.from('tenants')
            .select('subscription_tier').eq('id', tenantId).maybeSingle();
          if (tenantRow?.subscription_tier && PREMIUM_TIERS_ISLAMIC.has(tenantRow.subscription_tier)) {
            isPremiumIslamic = true;
            console.log(`[swish-islamic-identify] Premium via tenant tier: ${tenantRow.subscription_tier}`);
          }
        }
      } catch (e: any) { console.error('[swish-islamic-identify] Tier lookup error:', e.message); }
    }

    // Secondary: Stripe check (only if no qualifying tier)
    if (!isPremiumIslamic && user.email) {
      try {
        const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
        if (stripeKey) {
          const custRes = await fetch(
            `https://api.stripe.com/v1/customers?email=${encodeURIComponent(user.email)}&limit=1`,
            { headers: { Authorization: `Bearer ${stripeKey}` }, signal: AbortSignal.timeout(5000) },
          );
          if (custRes.ok) {
            const custData = await custRes.json();
            const customerId = custData.data?.[0]?.id;
            if (customerId) {
              const subsRes = await fetch(
                `https://api.stripe.com/v1/subscriptions?customer=${customerId}&status=active&limit=5`,
                { headers: { Authorization: `Bearer ${stripeKey}` }, signal: AbortSignal.timeout(5000) },
              );
              if (subsRes.ok) {
                const subsData = await subsRes.json();
                for (const sub of subsData.data ?? []) {
                  // This dedicated endpoint belongs to Coin Flipper. A paid
                  // subscription for MX, bikes, or clothing must not unlock it.
                  // Legacy subscriptions without niche metadata remain Coins.
                  const subscribedNiche = String(sub.metadata?.niche_id ?? 'coins').toLowerCase();
                  if (subscribedNiche !== 'coins') continue;
                  for (const item of sub.items?.data ?? []) {
                    if (item.price?.product === STRIPE_PRODUCT_ID_ISLAMIC) { isPremiumIslamic = true; break; }
                  }
                  if (isPremiumIslamic) break;
                }
              }
            }
          }
        }
      } catch (e: any) { console.error('[swish-islamic-identify] Stripe check error (non-blocking):', e.message); }
    }

    // Quota check
    if (!isPremiumIslamic && tenantId) {
      const { data: usageRow } = await adminClient.from('ai_usage')
        .select('count').eq('tenant_id', tenantId).eq('user_id', user.id)
        .eq('feature', FEATURE_KEY_ISLAMIC).eq('month_key', monthKey).maybeSingle();
      const usedCount = Number(usageRow?.count ?? 0);
      if (usedCount >= FREE_MONTHLY_QUOTA_ISLAMIC) {
        return new Response(
          JSON.stringify({
            error: 'FREE_QUOTA_EXCEEDED',
            message: `You have used all ${FREE_MONTHLY_QUOTA_ISLAMIC} free AI identifications for this month. Upgrade to SWISH Premium for unlimited identifications.`,
            quotaUsed: usedCount, quotaLimit: FREE_MONTHLY_QUOTA_ISLAMIC, upgradeRequired: true,
          }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      // Increment before expensive AI call
      await adminClient.rpc('upsert_ai_usage', {
        p_tenant_id: tenantId, p_user_id: user.id, p_feature: FEATURE_KEY_ISLAMIC, p_month_key: monthKey,
      }).catch(() => {});
    }
    console.log(`[swish-islamic-identify] isPremium=${isPremiumIslamic} tenant=${tenantId ?? 'none'}`);
    // ── END ENTITLEMENT CHECK ──────────────────────────────────────────────────

    const hasNewImages = Array.isArray(images) && images.length > 0;
    const hasExistingUrls = Array.isArray(existingImageUrls) && existingImageUrls.length > 0;

    if (!hasNewImages && !hasExistingUrls) {
      return new Response(
        JSON.stringify({ error: 'At least one image is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const physicalData = { weight: weight ?? null, diameter: diameter ?? null, notes: notes ?? '' };

    // ── STEP 1: AI Visual Analysis ──────────────────────────────────────────

    console.log(`[swish-islamic-identify] Step 1: AI visual analysis (batch=${isBatch}, idx=${batchIndex ?? 0})`);

    const userContent: any[] = [{
      type: 'text',
      text: [
        `SWISH Islamic & Indian Silver Identification Request`,
        ``,
        `Physical data supplied:`,
        weight ? `Weight: ${weight}g (HARD EVIDENCE — must be used to evaluate candidates)` : 'Weight: Not supplied',
        diameter ? `Diameter: ${diameter}mm (HARD EVIDENCE)` : 'Diameter: Not supplied',
        notes ? `User notes: ${notes}` : '',
        ``,
        `TASK: Perform the following in order:`,
        `1. Classify object type (coin / medal / token / unknown)`,
        `2. Identify coin family / dynasty if possible from visual evidence`,
        `3. Analyse inscription(s) — record ONLY what you can actually see`,
        `4. Inspect separately for countermark — treat as mandatory step`,
        `5. If countermarked: identify host coin and countermark SEPARATELY`,
        `6. Generate 2-3 candidates with supporting/contradicting evidence`,
        `7. Provide Zeno search queries for external verification`,
        ``,
        `REMEMBER: You are generating candidates for external verification.`,
        `Do NOT declare a definitive identification — that requires Zeno/Numista evidence.`,
        ``,
        ISLAMIC_OUTPUT_SCHEMA,
      ].filter(Boolean).join('\n'),
    }];

    // Add images
    if (hasExistingUrls) {
      for (const url of existingImageUrls) {
        if (typeof url === 'string' && url.startsWith('https://')) {
          userContent.push({ type: 'image_url', image_url: { url } });
        }
      }
    }
    if (hasNewImages) {
      for (const img of images) {
        if (!img || img.length < 10) continue; // skip empty/invalid
        if (img.startsWith('https://') || img.startsWith('http://')) {
          userContent.push({ type: 'image_url', image_url: { url: img } });
        } else if (img.startsWith('data:image/')) {
          // Already a valid base64 data URI — use directly
          userContent.push({ type: 'image_url', image_url: { url: img } });
        } else if (img.startsWith('file://') || img.startsWith('/')) {
          // Local file URI — cannot be accessed server-side, skip with warning
          console.warn(`[swish-islamic-identify] Skipping local file URI (not accessible server-side): ${img.slice(0, 60)}`);
        } else {
          // Assume raw base64 string
          const dataUri = `data:image/jpeg;base64,${img}`;
          userContent.push({ type: 'image_url', image_url: { url: dataUri } });
        }
      }
    }

    // Safety check: ensure at least one image was added
    const imageCount = userContent.filter(c => c.type === 'image_url').length;
    if (imageCount === 0) {
      return new Response(
        JSON.stringify({ error: 'No valid images could be processed. Please capture images using the camera or photo library — local file paths are not supported.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const aiResp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: `${ISLAMIC_SILVER_SYSTEM_PROMPT}\n${ISLAMIC_OUTPUT_SCHEMA}` },
          { role: 'user', content: userContent },
        ],
        temperature: 0.05,
        max_tokens: 3500,
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      return new Response(
        JSON.stringify({ error: `OnSpace AI error: ${errText}` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const aiData = await aiResp.json();
    const rawContent = aiData.choices?.[0]?.message?.content ?? '';

    let aiOutput: any;
    try {
      // Models may wrap JSON in Markdown fences or double-encode it with
      // literal \n and \" sequences. Normalize those common wrappers first.
      const stripFence = (value: string) => value
        .trim()
        .replace(/^\x60\x60\x60(?:json)?(?:\\r?\\n|\\n|\r?\n)?/i, '')
        .replace(/(?:\\n)?\x60\x60\x60\s*$/i, '')
        .trim();

      const cleaned = stripFence(String(rawContent ?? ''));
      const candidates: string[] = [cleaned];

      // Some model gateways return a JSON string whose contents are the object.
      try {
        const decoded = JSON.parse(cleaned);
        if (typeof decoded === 'string') candidates.push(stripFence(decoded));
        else if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) aiOutput = decoded;
      } catch {
        // Continue with normalized candidates.
      }

      if (!aiOutput) {
        candidates.push(cleaned
          .replace(/\\r\\n/g, '\n')
          .replace(/\\n/g, '\n')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"')
          .trim());
      }

      for (const candidate of candidates) {
        if (aiOutput) break;
        try {
          const parsed = JSON.parse(candidate);
          if (typeof parsed === 'string') {
            const nested = JSON.parse(stripFence(parsed));
            if (nested && typeof nested === 'object' && !Array.isArray(nested)) aiOutput = nested;
          } else if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            aiOutput = parsed;
          }
        } catch {
          // Continue through the normalization candidates.
        }
      }

      if (!aiOutput || typeof aiOutput !== 'object' || Array.isArray(aiOutput)) {
        throw new Error('Parsed response was not a JSON object');
      }
    } catch {
      console.error('[swish-islamic-identify] Invalid AI JSON response; length:', String(rawContent ?? '').length);
      return new Response(
        JSON.stringify({ error: 'AI returned invalid JSON after normalization. Please retry.' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── STEP 2: Build Zeno Search Queries ──────────────────────────────────

    console.log(`[swish-islamic-identify] Step 2: Generating Zeno queries`);

    const zenoQueries = (aiOutput.zenoSearchQueries && aiOutput.zenoSearchQueries.length > 0)
      ? aiOutput.zenoSearchQueries as string[]
      : buildZenoQueries(aiOutput, physicalData);

    // ── STEP 3: Search Zeno ─────────────────────────────────────────────────

    console.log(`[swish-islamic-identify] Step 3: Searching Zeno with ${zenoQueries.length} queries`);

    const zenoResults = await runZenoSearchPipeline(zenoQueries, aiOutput, physicalData);

    const zenoFound = zenoResults.filter(r => r.available && r.candidates.length > 0).length;
    console.log(`[swish-islamic-identify] Zeno: ${zenoFound}/${zenoResults.length} queries returned results`);

    // ── STEP 4: Search Numista ──────────────────────────────────────────────

    console.log(`[swish-islamic-identify] Step 4: Searching Numista`);

    const numistaResult = await searchNumistaIslamicSilver(aiOutput, physicalData, numistaApiKey);

    console.log(`[swish-islamic-identify] Numista: ${numistaResult.totalFound} results, top score=${numistaResult.candidates[0]?.matchScore ?? 0}`);

    // ── STEP 5: Reconcile Candidates with Source Evidence ──────────────────

    console.log(`[swish-islamic-identify] Step 5: Reconciling candidates`);

    const aiCandidates = Array.isArray(aiOutput.candidates) ? aiOutput.candidates : [];
    const { enhancedCandidates, sourceContradictions, sourceEvidence } = reconcileCandidatesWithSources(
      aiCandidates, zenoResults, numistaResult, physicalData,
    );

    // ── STEP 6: Determine Final Identification State ────────────────────────

    const identificationState = determineIdentificationState(
      enhancedCandidates, zenoResults, numistaResult, aiOutput,
    );

    // ── STEP 7: Build Final Result ──────────────────────────────────────────

    const selectedCandidate = enhancedCandidates.find(c => c.candidateId === aiOutput.selectedCandidateId)
      ?? enhancedCandidates[0];

    const finalConfidence = selectedCandidate?.confidence ?? (aiOutput.confidence ?? 0.1);

    // Countermark
    const cmAssessment = aiOutput.countermarkAssessment ?? {};
    const countermark: CountermarkAnalysis = {
      status: cmAssessment.countermarkStatus ?? 'none',
      description: cmAssessment.countermarkDescription ?? '',
      possibleAuthority: cmAssessment.possibleCountermarkAuthority ?? undefined,
      possibleRuler: cmAssessment.possibleCountermarkRuler ?? undefined,
      possibleDate: cmAssessment.possibleCountermarkDate ?? undefined,
      possibleType: cmAssessment.countermarkType ?? undefined,
      inscription: cmAssessment.countermarkInscription ?? undefined,
      symbol: cmAssessment.countermarkSymbol ?? undefined,
      imageQualitySufficient: cmAssessment.imageResolutionSufficient ?? true,
      requiresBetterImage: cmAssessment.requiresBetterImage ?? false,
      notes: cmAssessment.countermarkNotes ?? '',
    };

    // Host coin
    const hostAssessment = aiOutput.hostCoinAssessment ?? {};
    const hostCoin = hostAssessment.applicable ? {
      dynasty: hostAssessment.possibleDynasty ?? undefined,
      ruler: hostAssessment.possibleRuler ?? undefined,
      denomination: hostAssessment.possibleDenomination ?? undefined,
      mint: hostAssessment.possibleMint ?? undefined,
      approximateDate: hostAssessment.possibleDate ?? undefined,
      catalogueReference: hostAssessment.catalogueHint ?? undefined,
      confidence: hostAssessment.confidence ?? 0.1,
      notes: hostAssessment.notes ?? '',
    } : undefined;

    // Build attributes record for database
    const attributes: Record<string, any> = {
      object_type: aiOutput.objectType ?? 'coin',
      coin_family: aiOutput.coinFamily ?? '',
      identification_state: identificationState,
      countermark_detected: cmAssessment.countermarkDetected ?? false,
      countermark_status: countermark.status,
    };
    if (selectedCandidate?.dynasty) attributes['dynasty'] = selectedCandidate.dynasty;
    if (selectedCandidate?.ruler) attributes['ruler'] = selectedCandidate.ruler;
    if (selectedCandidate?.denomination) attributes['denomination'] = selectedCandidate.denomination;
    if (selectedCandidate?.mint) attributes['mint'] = selectedCandidate.mint;
    if (selectedCandidate?.dateAH) attributes['date_ah'] = selectedCandidate.dateAH;
    if (selectedCandidate?.dateCE) attributes['date_ce'] = selectedCandidate.dateCE;
    if (aiOutput.inscriptionAnalysis?.obverseText) attributes['inscription_obverse'] = aiOutput.inscriptionAnalysis.obverseText;
    if (aiOutput.inscriptionAnalysis?.reverseText) attributes['inscription_reverse'] = aiOutput.inscriptionAnalysis.reverseText;
    if (aiOutput.inscriptionAnalysis?.obverseScript) attributes['script_type'] = aiOutput.inscriptionAnalysis.obverseScript;

    // Add best Zeno reference
    const bestZeno = zenoResults.flatMap(r => r.candidates).sort((a, b) => b.matchScore - a.matchScore)[0];
    if (bestZeno && bestZeno.matchScore >= 25) {
      attributes['zeno_reference'] = bestZeno.zenoId;
      attributes['zeno_url'] = bestZeno.referenceUrl;
      attributes['zeno_title'] = bestZeno.title;
    }

    // Add best Numista reference
    const bestNumista = numistaResult.candidates[0];
    if (bestNumista && bestNumista.matchScore >= 25) {
      attributes['numista_candidate_id'] = String(bestNumista.typeId);
      attributes['numista_n'] = bestNumista.numistaN;
      attributes['numista_url'] = bestNumista.numistaUrl;
      attributes['numista_candidate_score'] = bestNumista.matchScore;
    }

    // Persist the ranked evidence trail, not just the winning reference. Keep
    // a compact candidate record so later review/valuation can inspect why a
    // candidate was suggested without treating it as a confirmed attribution.
    attributes['identification_candidates'] = enhancedCandidates.slice(0, 8).map(candidate => ({
      candidateId: candidate.candidateId,
      label: candidate.label,
      dynasty: candidate.dynasty ?? null,
      ruler: candidate.ruler ?? null,
      denomination: candidate.denomination ?? null,
      mint: candidate.mint ?? null,
      dateAH: candidate.dateAH ?? null,
      dateCE: candidate.dateCE ?? null,
      confidence: candidate.confidence,
      confidenceTier: candidate.confidenceTier,
      sourceEvidence: candidate.sourceEvidence.slice(0, 8),
      zenoMatches: candidate.zenoMatches.slice(0, 8),
      numistaMatches: candidate.numistaMatches.slice(0, 8),
      supportingFeatures: candidate.supportingFeatures.slice(0, 8),
      contradictions: candidate.contradictions.slice(0, 8),
      notes: candidate.notes,
      status: 'candidate',
    }));
    attributes['source_evidence_summary'] = sourceEvidence.slice(0, 20);
    attributes['source_contradictions'] = sourceContradictions.slice(0, 20);
    attributes['zeno_search_status'] = zenoResults.map(result => ({
      query: result.query,
      available: result.available,
      totalFound: result.totalFound,
      error: result.error ?? null,
    }));
    attributes['numista_search_status'] = {
      available: numistaResult.available,
      query: numistaResult.query,
      totalFound: numistaResult.totalFound,
      error: numistaResult.error ?? null,
    };

    // Warnings
    const warnings: string[] = [...(aiOutput.warnings ?? [])];
    if (countermark.status === 'confirmed' || countermark.status === 'possible') {
      warnings.push('Countermark detected — host coin and countermark must be identified separately. Value depends on both components.');
    }
    if (countermark.requiresBetterImage) {
      warnings.push('Countermark present but image resolution insufficient for identification. A close macro photograph of the countermark is required.');
    }
    if (aiOutput.hasHole) {
      warnings.push('Object has been pierced/holed — this is an alteration significantly affecting collectability and value. Piercing date: not established.');
    }
    if (finalConfidence < 0.45) {
      warnings.push(`Low confidence identification (${Math.round(finalConfidence * 100)}%) — do not list on eBay until identification is strengthened`);
    }
    if (!zenoResults.some(r => r.available && r.candidates.length > 0)) {
      warnings.push('Zeno search returned no matching records — identification is AI-only, not externally corroborated');
    }

    // Missing information
    const missingInfo: string[] = [...(aiOutput.missingInformation ?? [])];
    if (!weight) missingInfo.push('Weight not supplied — weight is critical evidence for this category. Measure and enter for more precise identification.');
    if (!diameter) missingInfo.push('Diameter not supplied — diameter helps narrow denomination and dynasty candidates.');
    if (aiOutput.inscriptionAnalysis?.inscriptionQuality === 'illegible') {
      missingInfo.push('Inscription is illegible — a close macro photograph of each face is required');
    }

    const batchFlags = buildBatchFlags(aiOutput, selectedCandidate, identificationState);

    const result: IslamicIdentificationResult = {
      objectType: aiOutput.objectType ?? 'coin',
      coinFamily: aiOutput.coinFamily ?? '',
      denomination: selectedCandidate?.denomination ?? aiOutput.denomination,
      approximateDate: selectedCandidate?.dateCE ?? aiOutput.approximateDate,
      identificationState,
      canonicalTitle: aiOutput.canonicalTitle ?? 'Unidentified Islamic/Indian Silver Coin',
      confidence: finalConfidence,
      confidenceTier: selectedCandidate?.confidenceTier ?? 'insufficient',
      confidenceReason: aiOutput.confidenceReason ?? '',
      observations: {
        obverse: aiOutput.physicalObservations?.obverse ?? '',
        reverse: aiOutput.physicalObservations?.reverse ?? '',
        edge: aiOutput.physicalObservations?.edge ?? undefined,
        flanism: aiOutput.physicalObservations?.flanism ?? undefined,
        inscriptionObverse: aiOutput.inscriptionAnalysis?.obverseText ?? undefined,
        inscriptionReverse: aiOutput.inscriptionAnalysis?.reverseText ?? undefined,
        scriptType: aiOutput.inscriptionAnalysis?.obverseScript ?? undefined,
        visibleCharacters: [aiOutput.inscriptionAnalysis?.obverseText, aiOutput.inscriptionAnalysis?.reverseText].filter(Boolean).join(' / ') || undefined,
        estimatedWeight: weight ? `${weight}g` : 'Not supplied',
        estimatedDiameter: diameter ? `${diameter}mm` : 'Not supplied',
        metalColour: aiOutput.physicalObservations?.metalColour ?? undefined,
        condition: aiOutput.condition ?? '',
        conditionGrade: aiOutput.conditionGrade ?? undefined,
        conditionNotes: aiOutput.conditionNotes ?? '',
      },
      countermark,
      hostCoin,
      candidates: enhancedCandidates,
      selectedCandidateId: selectedCandidate?.candidateId,
      zenoSearch: zenoResults,
      numistaSearch: numistaResult,
      sourceEvidenceSummary: sourceEvidence,
      sourceContradictions,
      attributes,
      warnings,
      missingInformation: missingInfo,
      evidenceSupporting: aiOutput.evidenceSupporting ?? [],
      evidenceContradictory: [...(aiOutput.evidenceContradictory ?? []), ...sourceContradictions],
      nextActions: buildNextActions(identificationState, countermark, missingInfo, selectedCandidate, finalConfidence),
      valuationLow: 0,
      valuationMid: 0,
      valuationHigh: 0,
      valuationConfidence: 'insufficient_data',
      marketEvidenceNote: 'Valuation requires confirmed identification followed by separate market evidence search (auction records, realised sales). Run Re-Value after identification is confirmed.',
      batchFlags,
    };

    // Save to database if itemId provided
    if (itemId && tenantId) {
      try {
        const adminClient = createClient(
          Deno.env.get('SUPABASE_URL') ?? '',
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
        );
        await adminClient.from('items').update({
          canonical_title: result.canonicalTitle,
          specialist_id: 'islamic_silver',
          identification_confidence: result.confidence,
          condition: result.observations.condition || null,
          condition_grade: result.observations.conditionGrade || null,
          condition_notes: result.observations.conditionNotes || null,
          attributes: result.attributes,
          warnings: result.warnings,
          updated_at: new Date().toISOString(),
        }).eq('id', itemId).eq('tenant_id', tenantId);
      } catch (e: any) {
        console.error(`[swish-islamic-identify] DB save error: ${e.message}`);
      }
    }

    console.log(
      `[swish-islamic-identify] Complete: "${result.canonicalTitle}" ` +
      `confidence=${result.confidence.toFixed(2)} state=${identificationState} ` +
      `zeno=${zenoFound}/${zenoResults.length} queries ` +
      `countermark=${countermark.status} batch_flag=${batchFlags.workflowStatus}`
    );

    return new Response(
      JSON.stringify({ identification: result }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    console.error('[swish-islamic-identify] Error:', err);
    return new Response(
      JSON.stringify({ error: err.message ?? 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// NEXT ACTIONS GENERATOR
// ─────────────────────────────────────────────────────────────────────────────

function buildNextActions(
  state: IdentificationState,
  countermark: CountermarkAnalysis,
  missingInfo: string[],
  selected: CandidateIdentification | undefined,
  confidence: number,
): string[] {
  const actions: string[] = [];

  if (countermark.requiresBetterImage) {
    actions.push('Capture a close macro photograph of the countermark to enable identification');
  }

  if (state === 'observation_only') {
    actions.push('Identification insufficient — capture clearer images of obverse and reverse with better lighting');
  }

  if (missingInfo.some(m => m.includes('Weight'))) {
    actions.push('Measure weight precisely — weight is critical evidence for Islamic/Indian silver denomination identification');
  }

  if (missingInfo.some(m => m.includes('Diameter'))) {
    actions.push('Measure diameter — helps narrow dynasty and denomination candidates');
  }

  if (countermark.status === 'confirmed' || countermark.status === 'possible') {
    actions.push('Research countermark separately using Zeno.ru search and specialist references (e.g. Brion, Mitchiner)');
    if (countermark.possibleAuthority) {
      actions.push(`Cross-reference countermark authority "${countermark.possibleAuthority}" against known countermark catalogues`);
    }
  }

  if (confidence < 0.55 && state === 'candidate') {
    actions.push('Search Zeno.ru manually with additional search terms to find comparative examples');
    actions.push('Consider consulting a specialist dealer or reference work (e.g. Mitchiner, Album, Goron & Goenka)');
  }

  if (confidence >= 0.55) {
    actions.push('Run Re-Value to search for market evidence (auction results and realised sales)');
  }

  if (selected?.dynasty?.toLowerCase().includes('timurid') || selected?.coinFamily?.toLowerCase().includes('timurid')) {
    actions.push('For Timurid attribution: verify against Davidovich "Denezhnoe khozyaystvo Sredney Azii" or Brion "Monnaies timourides"');
  }

  return actions.slice(0, 5);
}
