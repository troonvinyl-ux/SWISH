// SWISH AI Item Identification — Edge Function v6
//
// v6 CHANGES — PREMIUM ENTITLEMENT FIX:
//   - Tenant subscription_tier is now the AUTHORITATIVE premium source.
//     PREMIUM_TIERS (lifetime, professional, business, enterprise) bypass Stripe entirely.
//   - Stripe is a secondary check for users without a qualifying tenant tier.
//   - Transient Stripe errors NEVER downgrade a lifetime member.
//   - swish-islamic-identify-style calls also inherit consistent entitlement.
//   - getMonthlyQuota on the client is now accurate (isPremium reflects tier).
//
// v5 CHANGES — THREE PRODUCTION NICHES:
//   COINS / CLOTHING / MX — see full comments in v5

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const NUMISTA_API = 'https://api.numista.com/api/v3';

type ObjectType = 'coin' | 'medal' | 'token' | 'jeton' | 'commemorative_piece' |
  'banknote' | 'jewellery' | 'motorcycle' | 'motorcycle_part' |
  'garment' | 'footwear' | 'accessory' | 'replica_reproduction' | 'unknown';

const CONFIDENCE_TIER_CAPS: Record<string, number> = {
  observation_only: 0.25,
  candidate: 0.69,
  verified: 1.0,
};

const MIN_SUPPORTING_EVIDENCE_FOR_MEDIUM = 2;
const MIN_SUPPORTING_EVIDENCE_FOR_HIGH   = 4;

function isCoinLikeSpecialist(sid: string): boolean {
  // Only route to coin/numismatic pipeline for explicitly coin-related specialists.
  // curiosities_collectibles is a GENERIC specialist used for bikes, clothing, etc.
  // Do NOT route those through the Numista coin verification pipeline.
  return sid === 'coins' || sid === 'coins_uk' || sid === 'coins_currency' || sid === 'coins_world' ||
    sid === 'islamic_silver' || sid === 'banknotes' || sid === 'gold' || sid === 'silver' ||
    sid === 'ancient_artefacts' || sid === 'jewellery_precious_metals' ||
    (sid?.includes('coin') && sid !== 'curiosities_collectibles') ||
    sid?.includes('numismatic');
}

// Resolve the paid product from the requested specialist, never from a client-supplied
// nicheId. Generic/unknown specialists do not inherit another niche's subscription.
function nicheForSpecialist(sid: string): 'coins' | 'motocross' | 'bicycles' | 'clothing' | null {
  if (isCoinLikeSpecialist(sid)) return 'coins';
  if (sid === 'motocross') return 'motocross';
  if (sid === 'bicycles') return 'bicycles';
  if (sid === 'clothing' || sid === 'trainers_sneakers') return 'clothing';
  return null;
}
function isVehicleSpecialist(sid: string): boolean { return sid === 'motocross'; }
function isClothingSpecialist(sid: string): boolean { return sid === 'clothing' || sid === 'trainers_sneakers'; }
function shouldRunNumista(objectType: ObjectType): boolean { return objectType === 'coin'; }

// Numista responses can expose country/issuer values as either a string or an
// object. Keep persisted catalogue metadata scalar and display-safe.
function catalogueName(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') {
    const item = value as Record<string, unknown>;
    for (const key of ['name', 'title', 'label', 'country']) {
      if (typeof item[key] === 'string' && (item[key] as string).trim()) return (item[key] as string).trim();
    }
  }
  return '';
}

// ── COINS: 10-step identification pipeline prompt ─────────────────────────────
const COINS_SYSTEM_PROMPT = `You are an expert numismatist. Identification follows a strict 10-step priority pipeline.

COINS IDENTIFICATION PIPELINE (must follow in order):
1. OBJECT CLASSIFICATION — coin, medal, token, jeton, commemorative piece, banknote, jewellery, replica, unknown?
   A medal is NOT a coin. If unsure, default to most conservative classification.
2. VISUAL OBSERVATIONS — record exactly what is visible: shape, size estimate, colour/metal appearance,
   obverse/reverse features, edge type, condition indicators, any legends (copy EXACTLY as visible).
3. USER-SUPPLIED PHYSICAL MEASUREMENTS — if weight or diameter supplied, record as HARD EVIDENCE.
   These take absolute priority over any visual estimate.
4. VISIBLE LEGENDS & INSCRIPTIONS — copy character by character. NEVER complete partial text.
   State unreadable characters as "?" not assumed letters.
5. DESIGN & FEATURE ANALYSIS — portrait type, reverse device, border style, die axis, mint marks visible.
6. NUMISTA CANDIDATE SEARCH — based on visible evidence, what type might this be?
   State clearly as "CANDIDATE — not verified". List alternative candidates if plausible.
7. PHYSICAL MEASUREMENT COMPARISON — if user supplied weight/diameter, compare against candidate specs.
   Major discrepancy (>12% weight, >3mm diameter): state "CONTRADICTION — candidate less likely".
8. NUMISTA VERIFICATION — candidate will be cross-checked against Numista catalogue automatically.
   Your job is to provide the evidence; verification happens server-side.
9. ALTERNATIVE CANDIDATES — list other plausible types if evidence is ambiguous.
10. CONFIDENCE DECISION — based on evidence count and quality:
    - 0.85-1.0: 4+ independent verifiable characteristics all match
    - 0.70-0.84: 2-3 strong characteristics, minor uncertainty
    - 0.50-0.69: Plausible but alternatives exist
    - 0.30-0.49: Broad identification only
    - Below 0.30: Cannot reliably identify

ABSOLUTE RULES:
- Medals: NEVER assign denomination, ruler (as coin), mint, or coin catalogue numbers
- Legends: NEVER complete partial text — return only visible characters
- Catalogue numbers (Spink, KM, RIC): NEVER assign without visual confirmation
- Holes/piercings: ALWAYS record — state "Piercing date: not established"
- Physical measurements: HARD EVIDENCE — contradictions must be explicit
- A correct UNIDENTIFIED result is better than an invented identification

MEDAL VS COIN: If the object has no denomination inscription and appears commemorative, classify as MEDAL first.
Do not try to force it into the coin structure.`;

// ── MX: dedicated motocross identification prompt ────────────────────────────
const MOTOCROSS_SYSTEM_PROMPT = `You are an expert motocross, enduro, and off-road motorcycle specialist.
You have deep knowledge of KTM, Husqvarna, Yamaha, Honda, Kawasaki, Suzuki, Beta, Sherco, Gas Gas, TM, Fantic, and other manufacturers.

MX IDENTIFICATION PIPELINE:
1. VEHICLE TYPE — motocross / enduro / trail / supermoto / pit bike / minibike / off-road competition / parts
2. MANUFACTURER — from tank badge, shroud graphics, frame colour (KTM orange, Husky blue/white, Yamaha blue, Honda red, Kawasaki green, Suzuki yellow/blue)
3. MODEL FAMILY — SX vs XC vs XCW (KTM), FC vs FE vs TE (Husky), YZ vs WR (Yamaha), CRF vs CR (Honda), KX vs KLX (Kawasaki), RM vs RMZ (Suzuki)
4. YEAR RANGE — from plastics generation, tank shape, frame design, graphics (always a range e.g. "2019-2021" — NEVER a single year without VIN/frame confirmation)
5. ENGINE SIZE — from visible decals, displacement badges, or engine size markings
6. STROKE TYPE — 2-stroke vs 4-stroke from exhaust design, engine configuration, model naming conventions
7. VISIBLE NUMBERS — VIN plate, frame stamps, engine number (copy EXACTLY, do not complete partial numbers)
8. CONDITION ASSESSMENT — frame, forks, shock, wheels, tyres, plastics, exhaust, chain, controls
9. MODIFICATIONS — list ONLY what you can actually see (non-standard exhaust, different bars, aftermarket suspension)
10. RUNNING STATUS — declare ONLY from direct evidence (seller description, visible warm engine etc.)
    Default: "Unknown from images alone" — NEVER assume a bike runs from photographs

ABSOLUTE RULES:
- NEVER invent VIN, frame number, or engine number you cannot clearly read
- NEVER state a single model year without VIN/frame evidence — always use a range
- NEVER confuse similar models (KTM 250SX vs 300XC look similar from the side)
- Frame/engine numbers are HARD EVIDENCE — read exactly as visible
- Running status "Starts and runs" requires stated evidence — never assumed
- Modifications: only list what is VISIBLE
- Engine hours: NEVER establish from photographs
- Distinguish explicitly: motocross vs enduro vs trail vs supermoto vs pit bike
- A correct "probable [manufacturer] [family], year range [x-y], uncertain model" is better than an invented specific model

COMMERCIAL CONTEXT FOR MX:
Running status is the single most important commercial variable.
A running vs non-running bike can differ by 40-60% in value.
Always record running status as one of:
  "Runs and rides (stated)" / "Runs (stated)" / "Non-running (stated)" / "Non-running (visible — engine open/seized/damaged)" / "Unknown from images alone"`;

// ── CLOTHING: full fashion identification prompt ──────────────────────────────
const CLOTHING_SYSTEM_PROMPT = `You are an expert clothing and fashion specialist. You identify garments for commercial resale.
You have deep knowledge of vintage clothing, designer authentication, brand identification, era dating, and condition assessment.

CLOTHING IDENTIFICATION PIPELINE:
1. GARMENT TYPE — jacket, coat, shirt, t-shirt, dress, skirt, trousers, jeans, hoodie, sweatshirt, knitwear, shorts, etc.
2. BRAND LABEL — read EXACTLY as shown, character by character. State "Not legible" if obscured. Do not guess brand from style alone.
3. CARE/COMPOSITION LABEL — fibre composition (100% cotton, polyester/cotton blend etc.), country of manufacture, care symbols
4. GENDER CATEGORY — menswear, womenswear, unisex, childrenswear (from label or design)
5. SIZE — from label exactly. Note regional convention (US/UK/EU/Italian/Japanese sizing)
6. ERA ESTIMATION — from label font/style, care symbol era (pre-1971=no symbols), country of origin changes, composition types, construction details
   Always state your ERA EVIDENCE explicitly — what specifically dates it
7. COLOUR & STYLE — accurate colour description from photograph
8. CONDITION — from visible evidence: any stains, holes, fading, pilling, seam integrity, zip condition, missing hardware
9. AUTHENTICATION RISK — for designer/branded items:
   - Visible authentication markers: stitching quality, font accuracy, hardware quality, label placement, copyright tags
   - Risk level: LOW (strong evidence authentic) / MEDIUM (some markers present but inconclusive) / HIGH (suspicious markers, incorrect typography, hardware quality)
   - NEVER confirm authenticity from photographs alone — "Appears authentic — physical inspection required"
10. COMMERCIAL ASSESSMENT — best marketplace, condition grade, selling points, authenticity risk impact on price`;

// ── Generic specialists ───────────────────────────────────────────────────────
const SPECIALIST_SYSTEM_PROMPTS: Record<string, string> = {
  coins: COINS_SYSTEM_PROMPT,
  islamic_silver: `${COINS_SYSTEM_PROMPT}

ADDITIONAL: ISLAMIC & INDIAN SILVER SPECIALIST
Apply the 10-step coin pipeline with these Islamic/Indian additions:
- Script identification: Kufic vs Naskhi vs Nastaliq vs Devanagari vs other scripts
- Dynasty identification from calligraphy style and formulae (shahada placement, ruler titles)
- Countermark analysis: overlay marks, punch types, host coin dynasty vs countermark authority
- Zeno.ru search evidence: use Zeno reference numbers if clearly matching
- Never invent Arabic/Persian/Hindi inscription text — transcribe only visible characters
- Weight standards: Dirham (2.97g), Tanka (10-12g), Rupee (11.5g) — use as candidate evidence`,
  banknotes: `You are an expert banknote specialist. Identify from VISIBLE evidence only.
Identify: country, denomination (from printed text), year/series, signatures only if legible.
State explicitly what cannot be read. Note repair, pressing, washing only if visually evident.`,
  pokemon_cards: `You are an expert Pokémon TCG grader. Identify from VISIBLE evidence only.
Card name, set name, set number, rarity symbol — only if clearly visible.
Grade conservatively. Do not guess set if logo is not clearly identifiable.`,
  trading_cards: `You are an expert sports and trading card specialist. Identify from VISIBLE evidence only.
Player/subject name, year (if printed), brand, set name, card number from visible labels only.`,
  stamps: `You are an expert philatelist. Identify from VISIBLE evidence only.
Country, denomination, year (if printed), SG/Scott number ONLY if clearly identifiable.
Do not guess perforation gauge from a photograph.`,
  antiques: `You are an expert antiques appraiser. Identify from VISIBLE evidence only.
Object type, likely maker/origin from visible marks only, period/style.
Only attribute maker marks if clearly legible. Use conservative period dating.`,
  gold: `You are an expert precious metals specialist. Identify from VISIBLE evidence only.
Object type, visible hallmarks (only if legible), estimated fineness from visible marks.
Do not estimate weight from photographs. Flag plating indicators if visible.`,
  motocross: MOTOCROSS_SYSTEM_PROMPT,
  clothing: CLOTHING_SYSTEM_PROMPT,
  trainers_sneakers: `${CLOTHING_SYSTEM_PROMPT}

ADDITIONAL: TRAINERS & SNEAKERS SPECIALIST
- Model identification: from visible branding, sole unit design, upper construction
- Colourway: describe exactly as visible
- Size: from label exactly (note US/UK/EU)
- Condition: sole yellowing, creasing, sole separation, upper damage, midsole condition
- Box: document if present, condition, sticker details
- Deadstock: ONLY if unworn with tags — never assume from photographs alone
- Authentication: sole shape, stitching, material quality, font accuracy, serial tag
- HIGH risk brands: Supreme, Off-White Nike, Travis Scott colabs — state "professional authentication recommended"`,
  curiosities_collectibles: `You are an expert generalist collectibles appraiser. Identify from VISIBLE evidence only.
CRITICAL: First classify the object type (coin, medal, token, jewellery, motorcycle, garment, etc.).
Be conservative — state what you cannot determine. Never invent attributions.`,
};

// ── Master evidence rules (appended to all) ───────────────────────────────────
const MASTER_EVIDENCE_RULES = `

=== SWISH MANDATORY EVIDENCE RULES ===

OBJECT CLASSIFICATION (mandatory first step):
Classify as: coin / medal / token / jeton / commemorative_piece / banknote / jewellery / motorcycle / motorcycle_part / garment / footwear / accessory / replica_reproduction / unknown.
This classification CONTROLS which fields you populate.

CONFIDENCE FRAMEWORK:
- 0.85–1.0: Multiple independent verifiable characteristics all match
- 0.70–0.84: Strong visual match with 2+ characteristics, minor uncertainty
- 0.50–0.69: Plausible but alternatives exist
- 0.30–0.49: Broad category identification only
- Below 0.30: Cannot reliably identify — return UNIDENTIFIED

MANDATORY "NOT ESTABLISHED" POLICY:
Return "Not established" for any field you cannot confirm from VISIBLE evidence or user-supplied data.

PHYSICAL MEASUREMENT POLICY:
User-supplied weight or diameter = HARD EVIDENCE. Takes priority over visual estimates.
Major discrepancy with candidate spec (>12% weight, >3mm diameter) = state contradiction explicitly.

HOLE/PIERCING POLICY: Record in warnings. State "Piercing date: not established."

VALUATION POLICY: ALL price fields MUST be 0. Valuation handled by swish-market-value.

=== END SWISH RULES ===
`;

// ── JSON output schema ─────────────────────────────────────────────────────────
const OUTPUT_SCHEMA = `Return ONLY valid JSON (no markdown, no prose outside JSON):
{
  "objectType": "coin|medal|token|jeton|commemorative_piece|banknote|jewellery|motorcycle|motorcycle_part|garment|footwear|accessory|replica_reproduction|unknown",
  "identificationState": "observation_only|candidate|verified",
  "canonicalTitle": "Accurate title.",
  "specialistId": "specialist_id_used",
  "confidence": 0.00,
  "confidenceTier": "very_high|high|medium|low|very_low|unknown",
  "confidenceReason": "Specific evidence count and quality explanation",
  "identificationSource": "detected|inferred|researched|verified|unknown",
  "condition": "Visible condition assessment",
  "conditionGrade": "Grade if assessable — null if not",
  "conditionNotes": "Specific visible observations only",
  "hasHole": false,
  "hasAlteration": false,
  "alterationNotes": null,
  "observedCharacteristics": {
    "primary": "Main visible characteristics",
    "secondary": "Additional visible details",
    "edge": "Edge type if visible — or 'Not visible'",
    "visibleText": "Exact characters visible",
    "estimatedSize": "User-supplied dimensions — or 'Not supplied'",
    "estimatedWeight": "User-supplied weight — or 'Not supplied'",
    "colorAndMaterial": "Observable colour and material"
  },
  "candidateIdentification": {
    "primaryCandidate": "Best candidate — labelled PROVISIONAL",
    "alternativeCandidates": [],
    "whyCandidateSelected": "Specific evidence",
    "whyUncertain": "Specific uncertainty reasons"
  },
  "coinFields": {
    "useThisBlock": "ONLY if objectType is coin",
    "denomination": "Not established",
    "issuer": "Not established",
    "country": "Not established",
    "period": "Not established",
    "mint": "Not established",
    "composition": "Not established",
    "obverseDescription": "What is actually visible",
    "reverseDescription": "What is actually visible",
    "legendFragment": "Exact visible text — or 'Not legible'",
    "catalogueHint": "Only if clearly evidenced — or 'Not established'"
  },
  "medalFields": {
    "useThisBlock": "ONLY if objectType is medal/token/jeton/commemorative_piece",
    "subject": "Not established",
    "personsDepicted": "Not established",
    "issuer": "Not established",
    "approximateDate": "Not established",
    "inscription": "Exact visible inscription",
    "material": "Not established",
    "reference": "Not established"
  },
  "evidenceSupporting": ["Specific visible characteristic"],
  "evidenceContradictory": ["Anything that does not fit"],
  "missingInformation": ["What cannot be determined"],
  "attributesConfirmed": {},
  "attributesInferred": {},
  "coinCandidates": [],
  "valuationLow": 0,
  "valuationMid": 0,
  "valuationHigh": 0,
  "valuationConfidence": "insufficient_data",
  "valuationNote": "Run Re-Value for evidence-based market pricing",
  "saleProb30d": null,
  "warnings": [],
  "suggestedDisposition": "Brief evidence-based recommendation",
  "dispositionDecision": "sell_individual|bundle|lot|wholesale|hold|scrap|precious_metal_recovery|investigate|human_review|dispose"
}`;

// ── MX supplemental fields ────────────────────────────────────────────────────
const MX_SUPPLEMENTAL_SCHEMA = `
Also populate these vehicle fields in your JSON:
{
  "vehicleFields": {
    "manufacturer": "Brand from badges — or 'Not established'",
    "modelFamily": "e.g. 'KTM SX series' — or 'Not established'",
    "modelName": "Specific model if determinable — NEVER invent — or 'Not established'",
    "yearRange": "e.g. '2019-2021' — NEVER single year without VIN — or 'Not established'",
    "engineSize": "e.g. '250cc' from visible decals — or 'Not established'",
    "strokeType": "'2-stroke' | '4-stroke' | 'Not established'",
    "bikeType": "'motocross' | 'enduro' | 'trail' | 'supermoto' | 'pit_bike' | 'minibike' | 'unknown'",
    "frameNumber": "Exact characters visible — or 'Not visible'",
    "engineNumber": "Exact characters visible — or 'Not visible'",
    "visibleModifications": ["Only what you can actually see"],
    "suspensionForks": "Brand/type if identifiable — or 'Standard' or 'Not established'",
    "rearShock": "Brand/type if identifiable — or 'Standard' or 'Not established'",
    "exhaustSystem": "Brand if visible — or 'Standard' or 'Not established'",
    "plasticsCondition": "Specific assessment from visible evidence",
    "tyresCondition": "Front/rear tyre condition assessment",
    "runningStatus": "'Runs and rides (stated)' | 'Runs (stated)' | 'Non-running (stated)' | 'Non-running (visible evidence)' | 'Unknown from images alone'",
    "engineHours": "NEVER from photographs — 'Not established'"
  },
  "mxCommercialAssessment": {
    "runningStatusImpact": "Brief explanation of how running status affects value",
    "primaryDamageRisks": ["Visible damage items that affect value"],
    "buyerAttentionPoints": ["Key things a buyer should inspect"],
    "estimatedPreparationNeeded": "None / Minor / Moderate / Major — from visible evidence"
  }
}`;

// ── Clothing supplemental fields ──────────────────────────────────────────────
const CLOTHING_SUPPLEMENTAL_SCHEMA = `
Also populate these clothing fields in your JSON:
{
  "clothingFields": {
    "brand": "Exactly as shown on label — or 'Not legible'",
    "garmentType": "e.g. 'jacket', 't-shirt', 'dress', 'jeans'",
    "genderCategory": "'menswear' | 'womenswear' | 'unisex' | 'childrenswear' | 'Not established'",
    "labelledSize": "Exactly as shown — or 'Not legible'",
    "fiberComposition": "From care label exactly — or 'Not legible'",
    "countryManufacture": "From label — or 'Not legible'",
    "eraEstimate": "Decade or range e.g. '1990s' or '1985-1995' — or 'Not established'",
    "eraEvidence": "Specific evidence for era: label font, care symbols, country, composition, construction",
    "colourDescription": "Accurate colour from photograph",
    "primaryMaterial": "Main fibre type if legible",
    "isVintage": "true | false | 'Uncertain' — true only if pre-1995 with evidence",
    "isDeadstock": "true | false — true only if unworn with tags visible",
    "visibleDamage": ["Each damage item: type, location, severity"],
    "authenticityRiskLevel": "'LOW' | 'MEDIUM' | 'HIGH' | 'NOT_APPLICABLE'",
    "authenticityRiskReason": "Specific reasons for risk level — or null",
    "authenticityMarkers": ["Visible markers supporting or questioning authenticity"],
    "keySellingPoints": ["Features increasing resale value"],
    "recommendedMarketplace": "'eBay' | 'Depop' | 'Vinted' | 'Etsy' | 'multiple'",
    "recommendedMarketplaceReason": "Why this marketplace suits this item"
  }
}`;

// ── Known attributes context ───────────────────────────────────────────────────
function buildKnownAttributesContext(attrs: Record<string, any>): string {
  const hard: string[] = [];
  const soft: string[] = [];

  if (attrs.weight) hard.push(`Weight: ${attrs.weight}g — USER-MEASURED HARD EVIDENCE`);
  if (attrs.diameter) hard.push(`Diameter: ${attrs.diameter}mm — USER-MEASURED HARD EVIDENCE`);
  if (attrs.edgeLegend) hard.push(`Edge legend / inscription transcribed by user: ${attrs.edgeLegend} — EXACT TEXT EVIDENCE; compare with visible coin and do not silently normalize or complete missing characters`);
  if (attrs.ruler) hard.push(`Ruler: ${attrs.ruler} — USER-SUPPLIED CATALOGUE CLAIM; cross-check against inscriptions and design`);
  if (attrs.denomination) hard.push(`Denomination: ${attrs.denomination} — USER-SUPPLIED CATALOGUE CLAIM; cross-check against inscriptions and design`);
  if (attrs.catalogueNumber) hard.push(`Catalogue reference: ${attrs.catalogueNumber} — USER-SUPPLIED CLAIM; do not treat as independently verified`);
  if (attrs.material) hard.push(`Material: ${attrs.material}`);
  if (attrs.frameNumber || attrs.frame_number) hard.push(`Frame number: ${attrs.frameNumber ?? attrs.frame_number}`);
  if (attrs.vin) hard.push(`VIN: ${attrs.vin}`);

  if (attrs.manufacturer || attrs.brand) soft.push(`Known maker: ${attrs.manufacturer ?? attrs.brand}`);
  if (attrs.model) soft.push(`Known model: ${attrs.model}`);
  if (attrs.yearMade || attrs.year_made) soft.push(`Known year: ${attrs.yearMade ?? attrs.year_made}`);
  if (attrs.countryOfOrigin || attrs.country_of_origin) soft.push(`Country: ${attrs.countryOfOrigin ?? attrs.country_of_origin}`);
  if (attrs.condition) soft.push(`Condition: ${attrs.condition}`);
  if (attrs.existingTitle) soft.push(`Previously identified as: ${attrs.existingTitle} — treat as contextual hint only`);
  if (attrs.customNotes) soft.push(`Owner notes / additional specification data: ${attrs.customNotes}`);
  if (attrs.existingAttributes && typeof attrs.existingAttributes === 'object') {
    const useful = Object.entries(attrs.existingAttributes)
      .filter(([key, value]) => value != null && String(value).trim() !== '' && !/confidence|valuation|numista_match_score|image|url/i.test(key))
      .slice(0, 35)
      .map(([key, value]) => `${key}: ${String(value).slice(0, 180)}`);
    if (useful.length) soft.push(`Existing listing/inventory specifics (context only; independently verify):\\n${useful.map(v => `  - ${v}`).join('\\n')}`);
  }
  if (attrs.period) soft.push(`Period: ${attrs.period}`);
  if (attrs.mint) soft.push(`Mint: ${attrs.mint}`);

  if (hard.length === 0 && soft.length === 0) return '';
  let ctx = 'KNOWN ATTRIBUTES:\n';
  if (hard.length > 0) ctx += 'HARD EVIDENCE (user-measured — must not be contradicted without explicit justification):\n' + hard.map(p => `  - ${p}`).join('\n') + '\n';
  if (soft.length > 0) ctx += 'CONTEXTUAL INFORMATION:\n' + soft.map(p => `  - ${p}`).join('\n') + '\n';
  return ctx + '\n';
}

// ── Learning layer ────────────────────────────────────────────────────────────
async function fetchLearningCorrections(supabaseAdmin: ReturnType<typeof createClient>, tenantId: string, specialistId: string): Promise<string> {
  try {
    const { data } = await supabaseAdmin
      .from('ai_id_feedback')
      .select('ai_canonical_title, original_canonical_title, correction_notes, error_category, ai_confidence')
      .eq('tenant_id', tenantId)
      .eq('specialist_id', specialistId)
      .in('feedback', ['incorrect', 'partial'])
      .order('created_at', { ascending: false })
      .limit(8);

    if (!data || data.length === 0) return '';
    const categoryGroups: Record<string, any[]> = {};
    for (const row of data as any[]) {
      const cat = row.error_category ?? 'other';
      if (!categoryGroups[cat]) categoryGroups[cat] = [];
      categoryGroups[cat].push(row);
    }
    const lines: string[] = [];
    for (const [cat, rows] of Object.entries(categoryGroups)) {
      lines.push(`PAST ERROR — ${cat.replace(/_/g, ' ').toUpperCase()} (${rows.length}x):`);
      for (const row of rows.slice(0, 3)) {
        const note = row.correction_notes ? ` Correct: "${row.correction_notes}"` : ` Correct was: "${row.original_canonical_title}"`;
        lines.push(`  - Incorrectly identified as: "${row.ai_canonical_title}"${note}`);
      }
    }
    return `\nPAST IDENTIFICATION ERRORS (do not repeat):\n${lines.join('\n')}\n\n`;
  } catch { return ''; }
}

// ══════════════════════════════════════════════════════════════════════════════
// NUMISTA VERIFICATION ENGINE — unchanged from v5
// ══════════════════════════════════════════════════════════════════════════════
export interface NumistaVerificationResult {
  status: 'verified' | 'strong_match' | 'candidate' | 'weak_match' | 'no_match' | 'unavailable';
  typeId?: number; numistaId?: number; numistaN?: string; numistaUrl?: string;
  title?: string; matchScore: number;
  matchTier: 'verified' | 'very_strong' | 'strong' | 'plausible' | 'weak' | 'rejected';
  matchFactors: string[]; contradictions: string[];
  issuedFrom?: number; issuedTo?: number;
  composition?: string; weight?: number; diameter?: number; thickness?: number;
  mint?: string; issuer?: string; denomination?: string; country?: string; obverse?: string; reverse?: string;
  references: string[];
  suppliedWeight?: number; suppliedDiameter?: number;
  weightDifferencePercent?: number; diameterDifferenceMm?: number;
  physicalMatchGood: boolean;
}

function scoreNumistaCandidate(
  candidate: any, typeDetail: any | null,
  suppliedWeight: number | null, suppliedDiameter: number | null, suppliedMaterial: string | null,
  denomination: string, issuer: string, year: string, period: string, mint: string, aiCandidates: any[],
): { score: number; factors: string[]; contradictions: string[] } {
  const factors: string[] = [];
  const contradictions: string[] = [];
  let score = 0;
  const src = typeDetail ?? candidate;
  const candTitle = (src.title ?? candidate.title ?? '').toLowerCase();

  if (denomination && denomination.length > 1 && denomination !== 'Not established') {
    const denomLower = denomination.toLowerCase().trim();
    const candDenom = (src.min_unit?.name ?? src.denomination_name ?? '').toLowerCase();
    if (candTitle.includes(denomLower) || candDenom.includes(denomLower) || denomLower.includes(candDenom)) {
      score += 30; factors.push(`Denomination match: ${denomination}`);
    } else { score -= 25; contradictions.push(`Denomination mismatch: target="${denomination}" candidate="${src.min_unit?.name ?? 'unknown'}"`); }
  }
  if (issuer && issuer.length > 2 && issuer !== 'Not established') {
    const issuerLower = issuer.toLowerCase();
    const issuerLastName = issuerLower.split(/[\s,]+/).pop() ?? issuerLower;
    const candIssuer = (src.issuer?.name ?? src.issuer ?? '').toLowerCase();
    if (candTitle.includes(issuerLastName) || candIssuer.includes(issuerLastName)) {
      score += 25; factors.push(`Issuer match: ${issuer}`);
    } else { score -= 15; contradictions.push(`Issuer mismatch: target="${issuer}" candidate="${src.issuer?.name ?? 'unknown'}"`); }
  }
  const yearNum = year && year !== 'Not established' ? parseInt(year) : NaN;
  const issFrom = src.issued_from ?? candidate.issued_from ?? 0;
  const issTo = src.issued_to ?? candidate.issued_to ?? 9999;
  if (!isNaN(yearNum) && yearNum > 0) {
    if (yearNum >= issFrom - 3 && yearNum <= issTo + 3) { score += 20; factors.push(`Year ${year} within issue range ${issFrom}–${issTo}`); }
    else if (yearNum >= issFrom - 10 && yearNum <= issTo + 10) { score += 5; factors.push(`Year ${year} near issue range`); }
    else if (issFrom > 0 && issTo < 9999) { score -= 20; contradictions.push(`Year ${year} outside issue range ${issFrom}–${issTo}`); }
  }
  const candWeight = src.weight ?? candidate.weight ?? null;
  if (suppliedWeight !== null && suppliedWeight > 0 && candWeight !== null && candWeight > 0) {
    const diff = Math.abs(suppliedWeight - candWeight);
    const diffPct = diff / candWeight;
    if (diffPct <= 0.03) { score += 15; factors.push(`Weight STRONG match: ${suppliedWeight}g vs ${candWeight}g`); }
    else if (diffPct <= 0.07) { score += 8; factors.push(`Weight moderate match`); }
    else if (diffPct <= 0.12) { score += 2; factors.push(`Weight weak match: ${(diffPct * 100).toFixed(1)}% diff`); }
    else { score -= 25; contradictions.push(`Weight MAJOR CONTRADICTION: ${suppliedWeight}g vs catalogue ${candWeight}g (${(diffPct * 100).toFixed(1)}% — exceeds 12%)`); }
  }
  const candDiam = src.diameter ?? candidate.diameter ?? null;
  if (suppliedDiameter !== null && suppliedDiameter > 0 && candDiam !== null && candDiam > 0) {
    const diffMm = Math.abs(suppliedDiameter - candDiam);
    if (diffMm <= 0.5) { score += 10; factors.push(`Diameter STRONG match: ${suppliedDiameter}mm vs ${candDiam}mm`); }
    else if (diffMm <= 1.5) { score += 5; }
    else if (diffMm <= 3.0) { score += 1; }
    else { score -= 15; contradictions.push(`Diameter CONTRADICTION: ${suppliedDiameter}mm vs ${candDiam}mm (${diffMm.toFixed(1)}mm)`); }
  }
  if (suppliedMaterial && suppliedMaterial.length > 2) {
    const matLower = suppliedMaterial.toLowerCase();
    const candComp = (src.composition?.material ?? src.material ?? candidate.composition ?? '').toLowerCase();
    if (candComp.includes(matLower) || matLower.includes(candComp.slice(0, 4))) { score += 5; factors.push(`Composition match: ${suppliedMaterial}`); }
  }
  if (mint && mint.length > 1 && mint !== 'Not established') {
    const mintLower = mint.toLowerCase();
    const candMint = (src.mint?.name ?? src.mint ?? '').toLowerCase();
    if (candMint.includes(mintLower) || mintLower.includes(candMint.slice(0, 4))) { score += 5; factors.push(`Mint match: ${mint}`); }
  }
  return { score: Math.max(-50, score), factors, contradictions };
}

function scoreToMatchTier(score: number): NumistaVerificationResult['matchTier'] {
  if (score >= 95) return 'verified';
  if (score >= 90) return 'very_strong';
  if (score >= 80) return 'strong';
  if (score >= 70) return 'plausible';
  if (score >= 50) return 'weak';
  return 'rejected';
}
function matchTierToStatus(tier: NumistaVerificationResult['matchTier']): NumistaVerificationResult['status'] {
  switch (tier) {
    case 'verified': return 'verified';
    case 'very_strong': case 'strong': return 'strong_match';
    case 'plausible': return 'candidate';
    case 'weak': return 'weak_match';
    default: return 'no_match';
  }
}

async function fetchNumistaTypeDetail(typeId: number, apiKey: string): Promise<any | null> {
  try {
    const resp = await fetch(`${NUMISTA_API}/types/${typeId}`, { headers: { 'Numista-API-Key': apiKey }, signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return null;
    return await resp.json();
  } catch { return null; }
}

async function verifyWithNumista(aiIdentification: any, knownAttributes: Record<string, any>, isAncient: boolean): Promise<NumistaVerificationResult> {
  const noApiKey: NumistaVerificationResult = { status: 'unavailable', matchScore: 0, matchTier: 'rejected', matchFactors: ['Numista API key not configured'], contradictions: [], physicalMatchGood: false, references: [] };
  const apiKey = Deno.env.get('NUMISTA_API_KEY') ?? '';
  if (!apiKey) {
    const suppliedReferenceText = [
      knownAttributes?.catalogueNumber,
      knownAttributes?.catalogue_number,
      knownAttributes?.numistaN,
      knownAttributes?.numista_n,
      knownAttributes?.numistaUrl,
      knownAttributes?.numista_url,
      knownAttributes?.customNotes,
      ...Object.entries(knownAttributes?.existingAttributes ?? {})
        .filter(([key]) => /catalogue.?number|numista.?n|numista.?url/i.test(key))
        .map(([, value]) => String(value ?? '')),
    ].filter(Boolean).join(' ');
    const suppliedReference =
      suppliedReferenceText.match(/\bN\s*#\s*(\d{1,9})\b/i) ??
      suppliedReferenceText.match(/numista\.com\/(?:catalogue\/index\.php\?r=)?(\d{1,9})/i) ??
      suppliedReferenceText.match(/\bnumista\s*(?:type\s*)?(?:id\s*[:#=]?\s*)(\d{1,9})\b/i);
    const suppliedId = suppliedReference ? Number(suppliedReference[1]) : null;
    return {
      ...noApiKey,
      matchFactors: suppliedId
        ? [`Reference N#${suppliedId} was supplied, but NUMISTA_API_KEY is not configured; catalogue lookup and verification could not run.`]
        : noApiKey.matchFactors,
      ...(suppliedId ? {
        numistaN: `N#${suppliedId}`,
        numistaUrl: `https://en.numista.com/catalogue/index.php?r=${suppliedId}`,
      } : {}),
    };
  }

  const aiCandidates: any[] = Array.isArray(aiIdentification.coinCandidates) ? aiIdentification.coinCandidates : [];
  const primaryCandidate = aiCandidates[0] ?? {};
  const coinFields = aiIdentification.coinFields ?? {};

  const denomination = String(knownAttributes?.denomination ?? (coinFields.denomination !== 'Not established' ? coinFields.denomination : '') ?? primaryCandidate.denomination ?? '').trim().replace(/not established/gi, '');
  const issuer = String(knownAttributes?.ruler ?? (coinFields.issuer !== 'Not established' ? coinFields.issuer : '') ?? primaryCandidate.issuer ?? '').trim().replace(/not established/gi, '');
  const year = String(knownAttributes?.yearMade ?? (coinFields.period !== 'Not established' ? coinFields.period : '') ?? primaryCandidate.period ?? '').trim().replace(/not established/gi, '').slice(0, 10);
  const period = String(knownAttributes?.period ?? (coinFields.period !== 'Not established' ? coinFields.period : '') ?? primaryCandidate.period ?? '').trim().replace(/not established/gi, '');
  const mint = String(knownAttributes?.mint ?? (coinFields.mint !== 'Not established' ? coinFields.mint : '') ?? primaryCandidate.mint ?? '').trim().replace(/not established/gi, '');
  const suppliedWeight = knownAttributes?.weight ? Number(knownAttributes.weight) : null;
  const suppliedDiameter = knownAttributes?.diameter ? Number(knownAttributes.diameter) : null;
  const suppliedMaterial = String(knownAttributes?.material ?? (coinFields.composition !== 'Not established' ? coinFields.composition : '') ?? primaryCandidate.composition ?? '').trim().replace(/not established/gi, '') || null;

  // A user-entered Numista reference is a catalogue lookup instruction, not
  // ordinary prompt text. Resolve it directly before broad text search so the
  // exact type is checked even when the AI's current denomination/ruler is wrong.
  const referenceText = [
    knownAttributes?.catalogueNumber,
    knownAttributes?.catalogue_number,
    knownAttributes?.numistaN,
    knownAttributes?.numista_n,
    knownAttributes?.numistaUrl,
    knownAttributes?.numista_url,
    knownAttributes?.customNotes,
    ...Object.entries(knownAttributes?.existingAttributes ?? {})
      .filter(([key]) => /catalogue.?number|numista.?n|numista.?url/i.test(key))
      .map(([, value]) => String(value ?? '')),
  ].filter(Boolean).join(' ');
  const directReferenceMatch =
    referenceText.match(/\bN\s*#\s*(\d{1,9})\b/i) ??
    referenceText.match(/numista\.com\/(?:catalogue\/index\.php\?r=)?(\d{1,9})/i) ??
    referenceText.match(/\bnumista\s*(?:type\s*)?(?:id\s*[:#=]?\s*)(\d{1,9})\b/i);
  const directNumistaId = directReferenceMatch ? Number(directReferenceMatch[1]) : null;

  if (directNumistaId && Number.isSafeInteger(directNumistaId) && directNumistaId > 0) {
    const directDetail = await fetchNumistaTypeDetail(directNumistaId, apiKey);
    if (!directDetail || !directDetail.id) {
      return {
        status: 'unavailable', matchScore: 0, matchTier: 'rejected',
        matchFactors: [`Direct Numista reference N#${directNumistaId} was supplied, but the catalogue type could not be retrieved; it has NOT been verified.`],
        contradictions: [], physicalMatchGood: false, references: [],
        numistaN: `N#${directNumistaId}`,
        numistaUrl: `https://en.numista.com/catalogue/index.php?r=${directNumistaId}`,
      };
    }

    const directCandidate = {
      id: directDetail.id,
      title: directDetail.title ?? '',
      issued_from: directDetail.issued_from,
      issued_to: directDetail.issued_to,
      weight: directDetail.weight,
      diameter: directDetail.diameter,
      composition: directDetail.composition,
      issuer: directDetail.issuer,
      mint: directDetail.mint,
    };
    const directScore = scoreNumistaCandidate(
      directCandidate, directDetail, suppliedWeight, suppliedDiameter, suppliedMaterial,
      denomination, issuer, year, period, mint, aiCandidates,
    );
    let directPoints = directScore.score;
    const directFactors = [...directScore.factors];
    const directContradictions = [...directScore.contradictions];
    const titleWords = (value: unknown) => String(value ?? '').toLowerCase()
      .replace(/[^a-z0-9\\s]/g, ' ').split(/\\s+/)
      .filter((word: string) => word.length > 3 && !['coin', 'type', 'silver', 'copper', 'bronze'].includes(word));
    const catalogueWords = new Set(titleWords(directDetail.title));
    const aiTitles = [
      aiIdentification.canonicalTitle,
      ...aiCandidates.map((candidate: any) => candidate.title ?? candidate.name ?? ''),
    ];
    const aiTitleWords = new Set(aiTitles.flatMap((title: unknown) => titleWords(title)));
    const sharedTitleWords = [...catalogueWords].filter(word => aiTitleWords.has(word));
    if (sharedTitleWords.length > 0) {
      const titlePoints = Math.min(25, sharedTitleWords.length * 8);
      directPoints += titlePoints;
      directFactors.push(`Catalogue title agrees with AI candidate on: ${sharedTitleWords.join(', ')} (+${titlePoints})`);
    } else {
      directContradictions.push('Catalogue title does not share identifying terms with the AI candidate/title');
      directPoints -= 10;
    }
    directPoints = Math.max(-50, Math.min(100, directPoints));
    const directTier = scoreToMatchTier(directPoints);
    const directStatus = matchTierToStatus(directTier);
    const directPhysicalMatchGood = !directContradictions.some(c => /MAJOR|CONTRADICTION/i.test(c));
    const directReferences: string[] = (directDetail.references ?? [])
      .map((r: any) => `${r.catalogue?.code ?? r.code ?? ''} ${r.number ?? ''}`.trim())
      .filter(Boolean);
    return {
      status: directStatus,
      typeId: directDetail.id,
      numistaId: directDetail.id,
      numistaN: `N#${directDetail.id}`,
      numistaUrl: `https://en.numista.com/catalogue/index.php?r=${directDetail.id}`,
      title: directDetail.title ?? '',
      matchScore: Math.round(Math.max(0, directPoints)),
      matchTier: directTier,
      matchFactors: [`Exact user-supplied catalogue reference N#${directDetail.id} retrieved directly from Numista API`, ...directFactors],
      contradictions: directContradictions,
      issuedFrom: directDetail.issued_from,
      issuedTo: directDetail.issued_to,
      composition: directDetail.composition?.material ?? directDetail.material ?? '',
      denomination: directDetail.min_unit?.name ?? directDetail.denomination?.name ?? directDetail.denomination_name ?? '',
      country: catalogueName(directDetail.country) || catalogueName(directDetail.issuer?.country),
      weight: directDetail.weight ?? null,
      diameter: directDetail.diameter ?? null,
      thickness: directDetail.thickness ?? null,
      mint: directDetail.mint?.name ?? directDetail.mint ?? '',
      issuer: directDetail.issuer?.name ?? directDetail.issuer ?? '',
      obverse: directDetail.obverse?.description ?? directDetail.obverse?.lettering ?? '',
      reverse: directDetail.reverse?.description ?? directDetail.reverse?.lettering ?? '',
      references: directReferences,
      suppliedWeight: suppliedWeight ?? undefined,
      suppliedDiameter: suppliedDiameter ?? undefined,
      weightDifferencePercent: (suppliedWeight && directDetail.weight)
        ? Math.round(Math.abs(suppliedWeight - directDetail.weight) / directDetail.weight * 1000) / 10 : undefined,
      diameterDifferenceMm: (suppliedDiameter && directDetail.diameter)
        ? Math.round(Math.abs(suppliedDiameter - directDetail.diameter) * 10) / 10 : undefined,
      physicalMatchGood: directPhysicalMatchGood,
    };
  }

  const searchParts: string[] = [];
  if (denomination && denomination.length > 1) searchParts.push(denomination);
  if (issuer && issuer.length > 2) searchParts.push(issuer);
  const yearMatch = year.match(/\d{2,4}/);
  if (yearMatch && !isAncient) searchParts.push(yearMatch[0]);

  if (searchParts.length === 0 && primaryCandidate.obverseDescription) {
    const keywords = primaryCandidate.obverseDescription.split(/\s+/).filter((w: string) => w.length > 4 && !/not|established|legible|visible|unknown/i.test(w)).slice(0, 3);
    searchParts.push(...keywords);
  }

  const searchQuery = searchParts.join(' ').slice(0, 80);
  if (searchQuery.length < 3) {
    return { status: 'no_match', matchScore: 0, matchTier: 'rejected', matchFactors: ['Insufficient confirmed evidence for Numista search'], contradictions: [], physicalMatchGood: false, references: [] };
  }

  const queriesToTry: string[] = [searchQuery];
  const titleForSearch = aiIdentification.canonicalTitle ?? '';
  if (titleForSearch && titleForSearch.length > 5) {
    const cleanTitle = titleForSearch.replace(/^(possible|likely|probable|provisional|candidate|circa|c\.|ca\.)\s+/gi, '').replace(/—.*$/g, '').trim().slice(0, 60);
    if (cleanTitle !== searchQuery && cleanTitle.length > 3) queriesToTry.push(cleanTitle);
  }

  let allCandidates: any[] = [];
  for (const q of queriesToTry.slice(0, 2)) {
    try {
      const resp = await fetch(`${NUMISTA_API}/types?q=${encodeURIComponent(q)}&lang=en&count=8`, { headers: { 'Numista-API-Key': apiKey }, signal: AbortSignal.timeout(8000) });
      if (!resp.ok) {
        if (resp.status === 401 || resp.status === 403) return { ...noApiKey, matchFactors: [`Numista API authentication failed (${resp.status})`] };
        continue;
      }
      const data = await resp.json();
      for (const t of data.types ?? []) { if (!allCandidates.find(c => c.id === t.id)) allCandidates.push(t); }
      if (allCandidates.length >= 8) break;
    } catch (e: any) {
      return { status: 'unavailable', matchScore: 0, matchTier: 'rejected', matchFactors: [`Numista API error: ${e.message}`], contradictions: [], physicalMatchGood: false, references: [] };
    }
  }

  if (allCandidates.length === 0) return { status: 'no_match', matchScore: 0, matchTier: 'rejected', matchFactors: [`No Numista candidates for: "${searchQuery}"`], contradictions: [], physicalMatchGood: false, references: [] };

  let bestScore = -100, bestCandidate: any = null, bestFactors: string[] = [], bestContradictions: string[] = [];
  for (const cand of allCandidates.slice(0, 8)) {
    const { score, factors, contradictions } = scoreNumistaCandidate(cand, null, suppliedWeight, suppliedDiameter, suppliedMaterial, denomination, issuer, year, period, mint, aiCandidates);
    if (score > bestScore) { bestScore = score; bestCandidate = cand; bestFactors = factors; bestContradictions = contradictions; }
  }

  if (bestScore < 30 || !bestCandidate) return { status: 'no_match', matchScore: Math.max(0, bestScore), matchTier: 'rejected', matchFactors: bestFactors, contradictions: bestContradictions.length > 0 ? bestContradictions : ['No candidate scored above threshold'], physicalMatchGood: false, references: [] };

  let typeDetail: any = null;
  if (bestScore >= 50) {
    typeDetail = await fetchNumistaTypeDetail(bestCandidate.id, apiKey);
    if (typeDetail) {
      const { score, factors, contradictions } = scoreNumistaCandidate(bestCandidate, typeDetail, suppliedWeight, suppliedDiameter, suppliedMaterial, denomination, issuer, year, period, mint, aiCandidates);
      bestScore = score; bestFactors = factors; bestContradictions = contradictions;
    }
  }

  const finalMatchTier = scoreToMatchTier(bestScore);
  const finalStatus = matchTierToStatus(finalMatchTier);
  const physicalMatchGood = !bestContradictions.some(c => c.includes('MAJOR') || c.includes('CONTRADICTION'));
  const src = typeDetail ?? bestCandidate;
  const typeId = src.id ?? bestCandidate.id;
  const references: string[] = (src.references ?? []).map((r: any) => `${r.catalogue?.code ?? r.code ?? ''} ${r.number ?? ''}`.trim()).filter(Boolean);

  return {
    status: finalStatus, typeId, numistaId: typeId, numistaN: `N#${typeId}`,
    numistaUrl: `https://en.numista.com/catalogue/index.php?r=${typeId}`,
    title: src.title ?? bestCandidate.title ?? '',
    matchScore: Math.round(Math.max(0, Math.min(100, bestScore))),
    matchTier: finalMatchTier, matchFactors: bestFactors, contradictions: bestContradictions,
    issuedFrom: src.issued_from ?? bestCandidate.issued_from,
    issuedTo: src.issued_to ?? bestCandidate.issued_to,
    composition: src.composition?.material ?? src.material ?? '',
    weight: src.weight ?? null, diameter: src.diameter ?? null, thickness: src.thickness ?? null,
    mint: src.mint?.name ?? src.mint ?? '', issuer: src.issuer?.name ?? src.issuer ?? '',
    denomination: src.min_unit?.name ?? src.denomination?.name ?? src.denomination_name ?? '',
    country: catalogueName(src.country) || catalogueName(src.issuer?.country),
    obverse: typeDetail?.obverse?.description ?? typeDetail?.obverse?.lettering ?? '',
    reverse: typeDetail?.reverse?.description ?? typeDetail?.reverse?.lettering ?? '',
    references, suppliedWeight: suppliedWeight ?? undefined, suppliedDiameter: suppliedDiameter ?? undefined,
    weightDifferencePercent: (suppliedWeight && src.weight) ? Math.round(Math.abs(suppliedWeight - src.weight) / src.weight * 1000) / 10 : undefined,
    diameterDifferenceMm: (suppliedDiameter && src.diameter) ? Math.round(Math.abs(suppliedDiameter - src.diameter) * 10) / 10 : undefined,
    physicalMatchGood,
  };
}

function applyNumistaToIdentification(identification: any, numista: NumistaVerificationResult): any {
  const result = { ...identification };
  result.numistaVerification = numista;
  result.numistaStatus = numista.status;
  result.numistaTypeId = numista.typeId ?? null;
  result.numistaN = numista.numistaN ?? null;
  result.numistaTitle = numista.title ?? null;
  result.numistaUrl = numista.numistaUrl ?? null;
  result.numistaMatchScore = numista.matchScore;
  result.numistaMatchTier = numista.matchTier;
  // Keep catalogue fields as explicit suggestions even when the match is not
  // strong enough to confirm the coin identity. Consumers can review these
  // without confusing them with user-measured or user-confirmed attributes.
  result.attributes = result.attributes ?? {};
  if (numista.typeId || numista.numistaN) {
    result.attributes.numista_catalogue_suggestions = {
      reference: numista.numistaN ?? (numista.typeId ? `N#${numista.typeId}` : null),
      url: numista.numistaUrl ?? null, title: numista.title ?? null,
      matchScore: numista.matchScore, matchTier: numista.matchTier, status: numista.status,
      denomination: numista.denomination || null, issuer: numista.issuer || null,
      country: numista.country || null, issuedFrom: numista.issuedFrom ?? null,
      issuedTo: numista.issuedTo ?? null,
      period: numista.issuedFrom != null || numista.issuedTo != null ? `${numista.issuedFrom ?? '?'}–${numista.issuedTo ?? '?'}` : null,
      mint: numista.mint || null, material: numista.composition || null,
      catalogueWeightGrams: numista.weight ?? null, catalogueDiameterMm: numista.diameter ?? null,
      catalogueThicknessMm: numista.thickness ?? null, catalogueReferences: numista.references ?? [],
      contradictions: numista.contradictions ?? [],
    };
  }

  if (!Array.isArray(result.warnings)) result.warnings = [];
  for (const contra of numista.contradictions) { if (!result.warnings.includes(contra)) result.warnings.push(contra); }

  if (numista.status === 'verified' || numista.status === 'strong_match') {
    if (numista.title && numista.title.length > 5 && numista.matchScore >= 80) {
      if (result.confidence < 0.75) result.confidence = Math.min(0.85, result.confidence + 0.15);
      if (numista.numistaId) {
        result.attributes = result.attributes ?? {};
        result.attributes['numista_type_id'] = String(numista.numistaId);
        result.attributes['numista_n'] = numista.numistaN;
        result.attributes['numista_url'] = numista.numistaUrl;
        result.attributes['numista_match_score'] = numista.matchScore;
        result.attributes['numista_status'] = numista.status;
        if (numista.references?.length) result.attributes['numista_references'] = numista.references.join(', ');
        if (!result.attributes.weight && numista.weight) result.attributes['catalogue_weight'] = numista.weight;
        if (!result.attributes.diameter && numista.diameter) result.attributes['catalogue_diameter'] = numista.diameter;
        if (!result.attributes.composition && numista.composition) result.attributes['composition'] = numista.composition;
        if (!result.attributes.mint && numista.mint) result.attributes['mint'] = numista.mint;
      }
      result.evidenceSupporting = result.evidenceSupporting ?? [];
      result.evidenceSupporting.push(`Numista: ${numista.title} (${numista.numistaN}, score ${numista.matchScore}/100)`);
    }
  } else if (numista.status === 'candidate') {
    result.missingInformation = result.missingInformation ?? [];
    result.missingInformation.push(`Numista candidate (${numista.numistaN}) — match not fully confirmed (score ${numista.matchScore}/100)`);
    result.confidence = Math.min(result.confidence, 0.65);
    if (numista.numistaId) { result.attributes = result.attributes ?? {}; result.attributes['numista_candidate_id'] = String(numista.numistaId); result.attributes['numista_candidate_score'] = numista.matchScore; }
  } else if (numista.status === 'no_match') {
    result.missingInformation = result.missingInformation ?? [];
    result.missingInformation.push('No matching Numista catalogue type — identification is AI-only');
    result.confidence = Math.min(result.confidence, 0.60);
    result.warnings.push('No Numista catalogue match — research before listing');
  } else if (numista.status === 'weak_match') {
    result.confidence = Math.min(result.confidence, 0.50);
    result.missingInformation = result.missingInformation ?? [];
    result.missingInformation.push(`Numista weak match (${numista.numistaN}, score ${numista.matchScore}/100) — specialist verification required`);
  }
  if (!numista.physicalMatchGood && numista.status !== 'unavailable' && numista.status !== 'no_match') {
    result.confidence = Math.min(result.confidence, 0.40);
    result.warnings.push('Physical measurements contradict Numista data — specialist verification required');
  }
  if (numista.status !== 'unavailable' && numista.status !== 'no_match') result.identificationSource = 'verified';
  return result;
}

function enforceEvidenceConstraints(identification: any, vehicleMode: boolean, clothingMode: boolean): any {
  const result = { ...identification };

  result.valuationLow = 0; result.valuationMid = 0; result.valuationHigh = 0;
  result.valuationConfidence = 'insufficient_data'; result.saleProb30d = null;
  result.valuationNote = vehicleMode
    ? 'Run Re-Value for evidence-based MX market pricing from eBay sold data'
    : clothingMode
    ? 'Run Re-Value for current market pricing from eBay/Depop sold data'
    : 'Run Re-Value for evidence-based market pricing from eBay sold data';

  const confirmed = result.attributesConfirmed ?? {};
  const inferred = result.attributesInferred ?? {};
  const merged: Record<string, any> = {};
  for (const [k, v] of Object.entries(confirmed)) {
    if (v && String(v).toLowerCase() !== 'not established' && String(v).toLowerCase() !== 'not supplied' && String(v).toLowerCase() !== 'not legible' && String(v).toLowerCase() !== 'not visible') merged[k] = v;
  }
  for (const [k, v] of Object.entries(inferred)) {
    if (v && String(v).toLowerCase() !== 'not established' && String(v).toLowerCase() !== 'not supplied') {
      if (!(k in confirmed)) { merged[`_inferred_${k}`] = v; merged[k] = v; }
    }
  }
  result.attributes = { ...merged, ...(result.attributes ?? {}) };
  if (result.objectType) result.attributes['object_type'] = result.objectType;
  if (result.identificationState) result.attributes['identification_state'] = result.identificationState;

  if (result.objectType === 'medal' || result.objectType === 'token' || result.objectType === 'jeton' || result.objectType === 'commemorative_piece') {
    const mf = result.medalFields ?? {};
    if (mf.subject && mf.subject !== 'Not established') result.attributes['medal_subject'] = mf.subject;
    if (mf.issuer && mf.issuer !== 'Not established') result.attributes['medal_issuer'] = mf.issuer;
    if (mf.approximateDate && mf.approximateDate !== 'Not established') result.attributes['medal_approximate_date'] = mf.approximateDate;
    if (mf.inscription && mf.inscription !== 'Not legible') result.attributes['medal_inscription'] = mf.inscription;
  }

  if (result.hasHole) result.attributes['has_hole'] = true;
  if (result.hasAlteration) result.attributes['has_alteration'] = true;
  if (result.alterationNotes) result.attributes['alteration_notes'] = result.alterationNotes;

  const supportingEvidence = Array.isArray(result.evidenceSupporting) ? result.evidenceSupporting.filter((e: string) => e && e.length > 5) : [];
  const contradictoryEvidence = Array.isArray(result.evidenceContradictory) ? result.evidenceContradictory.filter((e: string) => e && e.length > 5) : [];
  const missingEvidence = Array.isArray(result.missingInformation) ? result.missingInformation.filter((e: string) => e && e.length > 5) : [];
  const supporting = new Set(supportingEvidence.map((e: string) => e.trim().toLowerCase())).size;
  const contradictory = new Set(contradictoryEvidence.map((e: string) => e.trim().toLowerCase())).size;
  const missing = new Set(missingEvidence.map((e: string) => e.trim().toLowerCase())).size;

  // Do not treat an empty evidence list as an explicit contradiction: keep the
  // model's conservative raw assessment and require concrete evidence for higher tiers.
  const evidenceRatio = supporting + contradictory > 0 ? supporting / (supporting + contradictory) : 1;
  const missingPenalty = Math.min(0.35, missing * 0.05);
  const rawConf = Math.max(0.05, Math.min(1.0, Number(result.confidence ?? 0.3)));

  let maxConf = 1.0;
  if (result.objectType === 'unknown') maxConf = 0.25;
  if (result.identificationState === 'observation_only') maxConf = 0.22;
  const catalogueBacked = ['verified', 'strong_match'].includes(String(result.numistaStatus ?? result.numistaVerification?.status ?? '')) && Number(result.numistaMatchScore ?? result.numistaVerification?.matchScore ?? 0) >= 80;
  if (result.identificationState === 'candidate' && !result.numistaVerification && !catalogueBacked && !vehicleMode && !clothingMode) maxConf = 0.68;
  // A candidate needs explicit support. However, catalogue verification itself
  // is independently scored and must not be discarded just because the model's
  // prose evidence list is short. Preserve low confidence whenever there are
  // meaningful contradictions.
  if (catalogueBacked) {
    maxConf = Math.max(maxConf, 0.85);
  } else if (supporting < MIN_SUPPORTING_EVIDENCE_FOR_MEDIUM) {
    maxConf = Math.min(maxConf, 0.45);
  } else if (supporting < MIN_SUPPORTING_EVIDENCE_FOR_HIGH) {
    maxConf = Math.min(maxConf, 0.72);
  }
  if (contradictory > 0 && contradictory >= Math.max(1, supporting)) maxConf = Math.min(maxConf, 0.45);

  // When no evidence strings are returned, rely on the model's bounded raw
  // score rather than multiplying it by zero. This is not a confidence boost.
  const adjustedConf = Math.min(maxConf, rawConf * evidenceRatio - missingPenalty);
  result.confidence = Math.max(0.05, adjustedConf);

  const c = result.confidence;
  if (c >= 0.85) result.confidenceTier = 'very_high';
  else if (c >= 0.70) result.confidenceTier = 'high';
  else if (c >= 0.50) result.confidenceTier = 'medium';
  else if (c >= 0.30) result.confidenceTier = 'low';
  else if (c >= 0.10) result.confidenceTier = 'very_low';
  else result.confidenceTier = 'unknown';

  if (!Array.isArray(result.warnings)) result.warnings = [];

  if (result.confidence < 0.5) {
    if (!result.warnings.some((w: string) => /confidence|provisional/i.test(w))) {
      result.warnings.push(`Low confidence identification (${Math.round(result.confidence * 100)}%) — manual review recommended before listing`);
    }
  }

  if (result.identificationState === 'observation_only' && result.confidence < 0.20) {
    if (!/provisional|possible|likely|candidate|unidentified|unknown/i.test(String(result.canonicalTitle ?? ''))) {
      const typeLabel = vehicleMode ? 'Vehicle' : clothingMode ? 'Garment' : result.objectType !== 'unknown' ? (result.objectType || 'Object') : 'Object';
      result.canonicalTitle = `Unidentified ${typeLabel} — requires further verification`;
    }
    result.missingInformation = result.missingInformation ?? [];
    result.missingInformation.push('Insufficient visible evidence for reliable identification. Provide clearer images and any known measurements.');
  }

  if (result.hasHole && !result.warnings.some((w: string) => /pierced|hole/i.test(w))) {
    result.warnings.push('Object has been pierced/holed — alteration affecting collectability. Piercing date: not established.');
  }
  if ((result.objectType === 'medal' || result.objectType === 'token') && result.confidence < 0.80 && !result.warnings.some((w: string) => /medal|provisional/i.test(w))) {
    result.warnings.push(`${result.objectType === 'medal' ? 'Medal' : 'Token'} identification is provisional — not externally verified`);
  }

  if (clothingMode && result.clothingFields?.authenticityRiskLevel === 'HIGH') {
    result.warnings.push('HIGH AUTHENTICATION RISK — professional authentication strongly recommended before listing');
  }

  return result;
}

function isAncientCoin(identification: any, knownAttributes: Record<string, any>): boolean {
  const period = String(knownAttributes?.period ?? identification?.coinFields?.period ?? identification?.attributesConfirmed?.period ?? '').toLowerCase();
  const title = String(identification?.canonicalTitle ?? '').toLowerCase();
  return ['roman', 'ancient', 'greek', 'byzantine', 'medieval', 'hammered', 'celtic', 'persian', 'islamic', 'provincial'].some(h => period.includes(h) || title.includes(h));
}

// ══════════════════════════════════════════════════════════════════════════════
// ENTITLEMENT ENGINE v6 — AUTHORITATIVE PREMIUM DETERMINATION
// ══════════════════════════════════════════════════════════════════════════════
//
// Priority order (highest wins):
//   1. Tenant subscription_tier in PREMIUM_TIERS → PREMIUM (no Stripe check needed)
//   2. Active Stripe subscription for SWISH product → PREMIUM
//   3. Otherwise → FREE (quota enforced)
//
// A transient Stripe error NEVER downgrades a tenant-tier premium member.
// A Stripe check failure is treated as "unknown" (not "not premium") for
// free-tier users — quota is still enforced conservatively.

const STRIPE_PRODUCT_ID = 'prod_VQ0JxUCL29SZPQ';
const FREE_MONTHLY_QUOTA = 5;
const FEATURE_KEY = 'identify';

// These tier names match the CHECK CONSTRAINT in the tenants table.
// If you add new tiers, update both here and the DB constraint.
const PREMIUM_TIERS = new Set(['professional', 'business', 'enterprise', 'lifetime']);

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Resolve the tenant's subscription_tier from the database.
 * Uses service-role key — immune to RLS, cannot be spoofed by client.
 * Returns null if tenantId is missing or DB lookup fails.
 */
async function resolveTenantTier(
  admin: ReturnType<typeof createClient>,
  userId: string,
  tenantId: string,
): Promise<string | null> {
  if (!tenantId) return null;
  try {
    // Verify the user is actually a member of this tenant first
    const { data: membership } = await admin
      .from('tenant_memberships')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!membership) {
      console.warn(`[swish-identify] User ${userId} is NOT a member of tenant ${tenantId} — ignoring tenant tier`);
      return null;
    }
    const { data: tenantRow } = await admin
      .from('tenants')
      .select('subscription_tier')
      .eq('id', tenantId)
      .maybeSingle();
    return tenantRow?.subscription_tier ?? null;
  } catch (e: any) {
    console.error(`[swish-identify] Tenant tier lookup failed: ${e.message}`);
    return null;
  }
}

/**
 * Check Stripe subscription as a secondary entitlement source.
 * Returns false on any error — does NOT throw.
 */
async function checkStripeSubscription(userEmail: string, nicheId: string | null): Promise<boolean> {
  if (!nicheId) return false;
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeKey) return false;
  try {
    const customersRes = await fetch(
      `https://api.stripe.com/v1/customers?email=${encodeURIComponent(userEmail)}&limit=1`,
      { headers: { Authorization: `Bearer ${stripeKey}` }, signal: AbortSignal.timeout(5000) },
    );
    if (!customersRes.ok) return false;
    const customersData = await customersRes.json();
    const customerId = customersData.data?.[0]?.id;
    if (!customerId) return false;

    const subsRes = await fetch(
      `https://api.stripe.com/v1/subscriptions?customer=${customerId}&status=active&limit=5`,
      { headers: { Authorization: `Bearer ${stripeKey}` }, signal: AbortSignal.timeout(5000) },
    );
    if (!subsRes.ok) return false;
    const subsData = await subsRes.json();
    for (const sub of subsData.data ?? []) {
      // Existing subscriptions without metadata remain mapped to Coins so
      // legacy Coin Flipper subscribers do not lose access during migration.
      const subscribedNiche = String(sub.metadata?.niche_id ?? 'coins').toLowerCase();
      if (subscribedNiche !== nicheId) continue;
      for (const item of sub.items?.data ?? []) {
        if (item.price?.product === STRIPE_PRODUCT_ID) return true;
      }
    }
    return false;
  } catch (e) {
    console.error('[swish-identify] Stripe check error (non-blocking):', e);
    return false;
  }
}

/**
 * Determine premium status using authoritative two-source check.
 * Tenant tier always wins. Stripe is secondary for users without a qualifying tier.
 */
async function determineIsPremium(
  admin: ReturnType<typeof createClient>,
  userId: string,
  userEmail: string | undefined,
  tenantId: string,
  nicheId: string | null,
): Promise<{ isPremium: boolean; source: string; tier: string | null }> {
  // Step 1: Check tenant tier (authoritative, server-side, cannot be spoofed)
  const tier = await resolveTenantTier(admin, userId, tenantId);
  if (tier && PREMIUM_TIERS.has(tier)) {
    console.log(`[swish-identify] Premium via tenant tier: ${tier} (tenant=${tenantId}, user=${userId})`);
    return { isPremium: true, source: 'tenant_tier', tier };
  }

  // Step 2: Check Stripe (secondary — only if no qualifying tier)
  if (userEmail) {
    const stripeActive = await checkStripeSubscription(userEmail, nicheId);
    if (stripeActive) {
      console.log(`[swish-identify] Premium via Stripe subscription (user=${userId})`);
      return { isPremium: true, source: 'stripe', tier };
    }
  }

  return { isPremium: false, source: 'none', tier };
}

async function incrementUsage(
  admin: ReturnType<typeof createClient>,
  tenantId: string,
  userId: string,
  monthKey: string,
): Promise<{ count: number; error: string | null }> {
  const { data, error } = await admin.rpc(
    'upsert_ai_usage',
    { p_tenant_id: tenantId, p_user_id: userId, p_feature: FEATURE_KEY, p_month_key: monthKey },
  );
  if (error) {
    const { data: row } = await admin
      .from('ai_usage')
      .select('count')
      .eq('tenant_id', tenantId).eq('user_id', userId).eq('feature', FEATURE_KEY).eq('month_key', monthKey)
      .maybeSingle();
    return { count: Number(row?.count ?? 1), error: null };
  }
  return { count: Number(data ?? 1), error: null };
}

async function getUsage(
  admin: ReturnType<typeof createClient>,
  tenantId: string,
  userId: string,
  monthKey: string,
): Promise<number> {
  const { data } = await admin
    .from('ai_usage')
    .select('count')
    .eq('tenant_id', tenantId).eq('user_id', userId).eq('feature', FEATURE_KEY).eq('month_key', monthKey)
    .maybeSingle();
  return Number(data?.count ?? 0);
}

// ── Main handler ───────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get('ONSPACE_AI_API_KEY');
    const baseUrl = Deno.env.get('ONSPACE_AI_BASE_URL');
    if (!apiKey || !baseUrl) return new Response(JSON.stringify({ error: 'OnSpace AI not configured' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Authentication required.' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const token = authHeader.replace('Bearer ', '').trim();
    if (!token || token === Deno.env.get('SUPABASE_ANON_KEY')) return new Response(JSON.stringify({ error: 'Authentication required.' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const userClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return new Response(JSON.stringify({ error: 'Invalid or expired authentication token.' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const body = await req.json();
    const { images, imageLabels, existingImageUrls, specialistId, acquisitionContext, knownAttributes, tenantId: bodyTenantId } = body;
    const specialist = specialistId ?? 'curiosities_collectibles';
    const requestedNiche = nicheForSpecialist(specialist);

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const monthKey = currentMonthKey();
    const tenantId = bodyTenantId ?? '';

    // ── AUTHORITATIVE PREMIUM CHECK ────────────────────────────────────────────
    // Read current usage in parallel with premium determination
    const [entitlement, currentUsage] = await Promise.all([
      determineIsPremium(adminClient, user.id, user.email, tenantId, requestedNiche),
      tenantId
        ? getUsage(adminClient, tenantId, user.id, monthKey)
        : Promise.resolve(0),
    ]);

    const { isPremium, source: premiumSource, tier: tenantTier } = entitlement;

    console.log(
      `[swish-identify v6] user=${user.id} tenant=${tenantId} ` +
      `isPremium=${isPremium} source=${premiumSource} tier=${tenantTier ?? 'none'} ` +
      `usageThisMonth=${currentUsage}`,
    );

    if (!isPremium) {
      if (currentUsage >= FREE_MONTHLY_QUOTA) {
        return new Response(
          JSON.stringify({
            error: 'FREE_QUOTA_EXCEEDED',
            message: `You have used all ${FREE_MONTHLY_QUOTA} free AI identifications for this month. Upgrade to SWISH Premium for unlimited identifications.`,
            quotaUsed: currentUsage,
            quotaLimit: FREE_MONTHLY_QUOTA,
            upgradeRequired: true,
          }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
    }

    // Increment BEFORE expensive AI call to prevent concurrent quota bypass
    if (tenantId && !isPremium) {
      const { error: usageErr } = await incrementUsage(adminClient, tenantId, user.id, monthKey);
      if (usageErr) console.error('[swish-identify] Usage tracking error (non-blocking):', usageErr);
    }
    // ── END ENTITLEMENT CHECK ──────────────────────────────────────────────────

    const hasNewImages = Array.isArray(images) && images.length > 0;
    const hasExistingUrls = Array.isArray(existingImageUrls) && existingImageUrls.length > 0;
    if (!hasNewImages && !hasExistingUrls) return new Response(JSON.stringify({ error: 'At least one image is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const specialistSystemPrompt = SPECIALIST_SYSTEM_PROMPTS[specialist] ?? SPECIALIST_SYSTEM_PROMPTS['curiosities_collectibles'];
    const fullSystemPrompt = specialistSystemPrompt + MASTER_EVIDENCE_RULES;
    const coinMode = isCoinLikeSpecialist(specialist);
    const vehicleMode = isVehicleSpecialist(specialist);
    const clothingMode = isClothingSpecialist(specialist);

    const supplementalSchema = vehicleMode ? MX_SUPPLEMENTAL_SCHEMA : clothingMode ? CLOTHING_SUPPLEMENTAL_SCHEMA : '';

    let learningContext = '';
    if (tenantId) {
      try { learningContext = await fetchLearningCorrections(adminClient, tenantId, specialist); } catch {}
    }

    const totalImageCount = (hasNewImages ? images.length : 0) + (hasExistingUrls ? existingImageUrls.length : 0);
    const knownAttrsContext = (knownAttributes && Object.keys(knownAttributes).length > 0) ? buildKnownAttributesContext(knownAttributes) : '';

    const mandatoryFirstStep = vehicleMode
      ? 'MANDATORY FIRST STEP: Classify vehicle type (motocross/enduro/trail/supermoto/pit_bike/unknown) and manufacturer BEFORE model identification.'
      : clothingMode
      ? 'MANDATORY FIRST STEP: Read the brand label exactly as shown. Then read the care label. Then: garment type, era, condition, authentication risk.'
      : 'MANDATORY FIRST STEP: Classify object type (coin/medal/token/jeton/commemorative_piece/banknote/jewellery/motorcycle/garment/unknown).';

    const userContent: any[] = [{
      type: 'text',
      text: [
        `Specialist domain: ${specialist}`,
        acquisitionContext ? `Acquisition context: ${acquisitionContext}` : '',
        knownAttrsContext,
        learningContext,
        `Analyse the following ${totalImageCount} image(s).`,
        '',
        mandatoryFirstStep,
        'Follow the specialist identification pipeline. Use "Not established" for any field without visible evidence.',
        knownAttrsContext ? 'REFINEMENT MODE: Reassess the candidate from the images from scratch. Explicitly compare each supplied measurement and catalogue claim with visible inscriptions/design and catalogue data. Do not simply repeat the previous identification or confidence. New data must change the result only when it actually supports or contradicts a candidate. Put each independently checked match in evidenceSupporting and each mismatch in evidenceContradictory; identify any unverified user claim as unverified.' : '',
        '',
        OUTPUT_SCHEMA,
        supplementalSchema,
      ].filter(Boolean).join('\n'),
    }];

    if (hasExistingUrls) {
      for (const url of existingImageUrls) {
        if (typeof url === 'string' && url.startsWith('https://')) userContent.push({ type: 'image_url', image_url: { url } });
      }
    }
    if (hasNewImages) {
      for (let imageIndex = 0; imageIndex < images.length; imageIndex++) {
        const img = images[imageIndex];
        const suppliedLabel = Array.isArray(imageLabels) ? imageLabels[imageIndex] : undefined;
        const safeLabel = typeof suppliedLabel === 'string' && suppliedLabel.trim()
          ? suppliedLabel.trim().slice(0, 40)
          : `Photo ${imageIndex + 1} (face not specified)`;
        // Text labels are sent immediately before each image, preserving the
        // capture-slot association without changing the existing images[] API.
        userContent.push({ type: 'text', text: `IMAGE ${imageIndex + 1} — ${safeLabel}. Treat this as the user-supplied face/angle label, not proof of coin identity.` });
        if (typeof img !== 'string') continue;
        if (img.startsWith('http')) userContent.push({ type: 'image_url', image_url: { url: img } });
        else { const dataUri = img.startsWith('data:') ? img : `data:image/jpeg;base64,${img}`; userContent.push({ type: 'image_url', image_url: { url: dataUri } }); }
      }
    }

    const aiResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'system', content: fullSystemPrompt }, { role: 'user', content: userContent }],
        temperature: 0.05,
        max_tokens: 3000,
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      // If AI call failed and user was free-tier, decrement the usage counter
      // so they don't lose a quota slot for a failed request
      if (!isPremium && tenantId) {
        try {
          await adminClient.from('ai_usage').update({
            count: Math.max(0, currentUsage),
            updated_at: new Date().toISOString(),
          }).eq('tenant_id', tenantId).eq('user_id', user.id).eq('feature', FEATURE_KEY).eq('month_key', monthKey);
        } catch {}
      }
      return new Response(JSON.stringify({ error: `OnSpace AI: ${errText}` }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const aiData = await aiResponse.json();
    const rawContent = aiData.choices?.[0]?.message?.content ?? '';

    let identification: any = null;
    try {
      const cleaned = rawContent.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      identification = JSON.parse(cleaned);
    } catch {
      return new Response(JSON.stringify({ error: 'AI returned invalid JSON', raw: rawContent.slice(0, 400) }), { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const objectType: ObjectType = identification.objectType ?? (vehicleMode ? 'motorcycle' : clothingMode ? 'garment' : 'unknown');
    const isConfirmedCoin = objectType === 'coin';

    if (vehicleMode && identification.vehicleFields) {
      const vf = identification.vehicleFields;
      identification.attributes = identification.attributes ?? {};
      const setAttr = (key: string, val: any) => { if (val && String(val).trim() && !['Not established', 'Not visible', 'Unknown from images alone', 'unknown'].includes(String(val))) identification.attributes[key] = val; };
      setAttr('manufacturer', vf.manufacturer); setAttr('model_family', vf.modelFamily);
      setAttr('model', vf.modelName); setAttr('year_range', vf.yearRange);
      setAttr('engine_size', vf.engineSize); setAttr('stroke_type', vf.strokeType);
      setAttr('bike_type', vf.bikeType !== 'unknown' ? vf.bikeType : null);
      setAttr('frame_number', vf.frameNumber !== 'Not visible' ? vf.frameNumber : null);
      setAttr('engine_number', vf.engineNumber !== 'Not visible' ? vf.engineNumber : null);
      if (vf.runningStatus) identification.attributes['running_status'] = vf.runningStatus;
      if (vf.plasticsCondition) identification.attributes['plastics_condition'] = vf.plasticsCondition;
      if (vf.tyresCondition) identification.attributes['tyres_condition'] = vf.tyresCondition;
      setAttr('suspension_forks', vf.suspensionForks); setAttr('rear_shock', vf.rearShock);
      setAttr('exhaust', vf.exhaustSystem);
      if (Array.isArray(vf.visibleModifications) && vf.visibleModifications.length > 0) identification.attributes['modifications'] = vf.visibleModifications.join(', ');
      const ca = identification.mxCommercialAssessment ?? {};
      if (ca.runningStatusImpact) identification.attributes['running_status_commercial_impact'] = ca.runningStatusImpact;
      if (ca.estimatedPreparationNeeded) identification.attributes['preparation_estimate'] = ca.estimatedPreparationNeeded;
      identification.numistaStatus = 'unavailable';
      identification.objectType = objectType;
    }

    if (clothingMode && identification.clothingFields) {
      const cf = identification.clothingFields;
      identification.attributes = identification.attributes ?? {};
      const setClothingAttr = (key: string, val: any, notVal?: string) => {
        const notVals = notVal ? [notVal, 'Not established', 'Not legible'] : ['Not established', 'Not legible'];
        if (val && !notVals.includes(String(val).trim())) identification.attributes[key] = val;
      };
      setClothingAttr('brand', cf.brand); setClothingAttr('garment_type', cf.garmentType);
      setClothingAttr('gender_category', cf.genderCategory, 'Not established');
      setClothingAttr('size', cf.labelledSize, 'Not legible');
      setClothingAttr('composition', cf.fiberComposition, 'Not legible');
      setClothingAttr('country_manufacture', cf.countryManufacture, 'Not legible');
      setClothingAttr('era', cf.eraEstimate, 'Not established');
      if (cf.eraEvidence) identification.attributes['era_evidence'] = cf.eraEvidence;
      if (cf.colourDescription) identification.attributes['colour'] = cf.colourDescription;
      setClothingAttr('material', cf.primaryMaterial);
      if (cf.isVintage !== undefined && cf.isVintage !== 'Uncertain') identification.attributes['is_vintage'] = String(cf.isVintage);
      if (cf.isDeadstock === true) identification.attributes['is_deadstock'] = 'true';
      if (Array.isArray(cf.visibleDamage) && cf.visibleDamage.length > 0) identification.attributes['damage_notes'] = cf.visibleDamage.join('; ');
      if (cf.authenticityRiskLevel) identification.attributes['authenticity_risk_level'] = cf.authenticityRiskLevel;
      if (cf.authenticityRiskReason) identification.attributes['authenticity_risk_reason'] = cf.authenticityRiskReason;
      if (Array.isArray(cf.authenticityMarkers) && cf.authenticityMarkers.length > 0) identification.attributes['authenticity_markers'] = cf.authenticityMarkers.join('; ');
      if (Array.isArray(cf.keySellingPoints) && cf.keySellingPoints.length > 0) identification.attributes['selling_points'] = cf.keySellingPoints.join('; ');
      if (cf.recommendedMarketplace) identification.attributes['recommended_marketplace'] = cf.recommendedMarketplace;
      identification.clothingFields = cf;
      identification.numistaStatus = 'unavailable';
      identification.objectType = objectType;
    }

    let constrained = enforceEvidenceConstraints(identification, vehicleMode, clothingMode);

    let numistaVerification: NumistaVerificationResult | null = null;
    if (coinMode && !vehicleMode && !clothingMode && shouldRunNumista(objectType)) {
      const ancient = isAncientCoin(constrained, knownAttributes ?? {});
      numistaVerification = await verifyWithNumista(constrained, knownAttributes ?? {}, ancient);
      constrained = applyNumistaToIdentification(constrained, numistaVerification);
      // applyNumistaToIdentification has already evaluated catalogue score and physical contradictions.
      // Re-running the generic evidence limiter here used to re-cap verified candidates at 45%.
      constrained = enforceEvidenceConstraints(constrained, false, false);
      if (['verified', 'strong_match'].includes(numistaVerification.status) && numistaVerification.matchScore >= 80 && numistaVerification.physicalMatchGood) {
        constrained.confidence = Math.max(constrained.confidence, Math.min(0.85, Number(identification.confidence ?? constrained.confidence) + 0.15));
        constrained.confidenceTier = constrained.confidence >= 0.85 ? 'very_high' : constrained.confidence >= 0.70 ? 'high' : constrained.confidence >= 0.50 ? 'medium' : 'low';
        constrained.warnings = (constrained.warnings ?? []).filter((w: string) => !/Low confidence identification/i.test(w));
      }
    } else if (!vehicleMode && !clothingMode && coinMode && !isConfirmedCoin) {
      constrained.numistaStatus = 'unavailable';
      constrained.warnings = constrained.warnings ?? [];
      if (objectType === 'medal') constrained.warnings.push('Object classified as MEDAL — Numista coin verification not applicable.');
      else if (objectType !== 'coin') constrained.warnings.push(`Object classified as ${objectType.replace(/_/g, ' ').toUpperCase()} — coin catalogue verification not applicable.`);
    }

    // Re-read usage for accurate quota response
    const usedAfter = (!isPremium && tenantId)
      ? await getUsage(adminClient, tenantId, user.id, monthKey)
      : currentUsage + (isPremium ? 0 : 1);
    const remainingQuota = isPremium ? null : Math.max(0, FREE_MONTHLY_QUOTA - usedAfter);

    console.log(
      `[swish-identify v6] "${constrained.canonicalTitle}" objectType=${objectType} specialist=${specialist} ` +
      `confidence=${constrained.confidence?.toFixed(2)} tier=${constrained.confidenceTier} ` +
      `isPremium=${isPremium} premiumSource=${premiumSource} tenantTier=${tenantTier ?? 'none'} ` +
      `usedThisMonth=${usedAfter} remaining=${remainingQuota ?? 'unlimited'}`,
    );

    return new Response(
      JSON.stringify({
        identification: constrained,
        numistaVerification,
        quota: {
          isPremium,
          premiumSource,
          tenantTier,
          used: usedAfter,
          limit: isPremium ? null : FREE_MONTHLY_QUOTA,
          remaining: remainingQuota,
          monthKey,
        },
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (err: any) {
    console.error('[swish-identify v6] Error:', err);
    return new Response(JSON.stringify({ error: err.message ?? 'Internal error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
