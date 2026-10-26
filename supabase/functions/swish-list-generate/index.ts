// SWISH Listing Generator Edge Function v2
//
// CRITICAL SAFETY RULES:
//   1. IDENTIFICATION CHECK: If identification_confidence < 0.50 OR identification state
//      is 'observation_only', listing language must reflect provisional status.
//      Title MUST include "Possible" or "Provisional" for unverified identifications.
//   2. VALUATION CHECK: If valuation_confidence is 'insufficient_data' or 'very_low',
//      recommended_price is set to 0 and the listing is flagged MANUAL_REVIEW_REQUIRED.
//      Never substitute an arbitrary AI-guessed price.
//   3. CLAIM CHECK: Never add "rare", "scarce", "extremely rare", "valuable",
//      "museum quality", or specific unverified attributions to the listing.
//   4. OBJECT TYPE: Medals must not be described as coins. Use the object_type from
//      identification attributes. Do not force coin terminology onto medals.
//   5. HOLES/ALTERATIONS: Must be disclosed in the listing description.
//      Never describe a holed/pierced item as "good condition" without disclosure.
//   6. AI PRICE LOCK: The AI may suggest a price range but NEVER bypasses the
//      valuation confidence gate. 0 price means user must enter manually.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

interface ListingRequest {
  item_id: string;
  tenant_id: string;
  marketplace_id?: string;
}

interface GeneratedListing {
  title: string;
  description: string;
  category: string;
  category_id?: string;
  condition_id: string;
  condition_description: string;
  recommended_price: number;
  floor_price: number;
  ceiling_price: number;
  item_specifics: Record<string, string>;
  keywords: string[];
  listing_format: string;
  duration: string;
  shipping_profile: string;
  returns_policy: string;
  rationale: string;
  price_requires_manual_review: boolean;
  price_review_reason?: string;
  identification_is_provisional: boolean;
  safety_flags: string[];
}

// ── MX / Motocross listing template helper ──────────────────────────────────
// Pre-builds a structured title and item-specifics from confirmed attributes
// so the AI never has to guess manufacturer, model, year, engine size, or
// running status for motocross/off-road motorcycle items.

interface MXBrief {
  structuredTitle: string;
  titleComponents: Record<string, string>;
  vehicleType: string;
  keySpecs: Array<[string, string]>;
  conditionNotes: string;
  titleInstructions: string;
  descriptionInstructions: string;
  categoryHints: string;
  ebayCategoryId: string;
  ebayCategoryName: string;
}

// Known EBAY_GB leaf categories only. Supermoto and motorcycle-parts category
// IDs are deliberately omitted here because the historic IDs used before were
// parent/wrongly labelled nodes. Those items must be resolved via live Taxonomy.
const MX_EBAY_CATEGORIES: Record<string, { id: string; name: string }> = {
  motocross:   { id: '79183',  name: 'Motocross / Off-Road Bikes' },
  enduro:      { id: '79183',  name: 'Motocross / Off-Road Bikes' },
  trail:       { id: '79183',  name: 'Motocross / Off-Road Bikes' },
  pitbike:     { id: '103963', name: 'Pit Bikes' },
  accessories: { id: '10750',  name: 'Motorcycle Accessories' },
};

// Display names for MX attributes in eBay item specifics
const MX_ATTR_CANONICAL: Record<string, string> = {
  manufacturer: 'Make', brand: 'Make', make: 'Make',
  model: 'Model',
  year: 'Year', year_made: 'Year', model_year: 'Year',
  year_range: 'Year Range',
  engine_size: 'Engine Size (cc)', engine_cc: 'Engine Size (cc)',
  cc: 'Engine Size (cc)', displacement: 'Engine Size (cc)',
  stroke_type: 'Engine Type', stroke: 'Engine Type', engine_type: 'Engine Type',
  frame_number: 'Frame Number', vin: 'Frame Number', chassis_number: 'Frame Number',
  engine_number: 'Engine Number',
  forks: 'Front Forks', front_forks: 'Front Forks', front_suspension: 'Front Forks',
  shock: 'Rear Shock', rear_shock: 'Rear Shock', rear_suspension: 'Rear Shock',
  exhaust: 'Exhaust System',
  tyres: 'Tyres', tires: 'Tyres',
  running_status: 'Running Status',
  cold_start: 'Starts Cold',
  mileage: 'Mileage', odometer: 'Mileage', hours: 'Engine Hours', engine_hours: 'Engine Hours',
  colour: 'Colour', color: 'Colour',
  modifications: 'Modifications',
  service_history: 'Service History',
  country: 'Country/Region of Manufacture', country_of_origin: 'Country/Region of Manufacture',
};

function buildMXBrief(item: any): MXBrief {
  const attrs = (item.attributes as Record<string, any>) ?? {};

  const get = (...keys: string[]): string => {
    for (const k of keys) {
      const v = attrs[k] ?? attrs[k.toLowerCase()] ?? attrs[k.replace(/_/g, ' ')];
      if (v && String(v).trim() && String(v).trim().toLowerCase() !== 'unknown') {
        return String(v).trim();
      }
    }
    return '';
  };

  const make      = get('manufacturer', 'brand', 'make', 'Make', 'Manufacturer', 'Brand');
  const model     = get('model', 'Model');
  const year      = get('year', 'year_made', 'model_year', 'Year', 'Year Made');
  const yearRange = get('year_range', 'Year Range');
  const engineCc  = get('engine_size', 'engine_cc', 'cc', 'displacement', 'Engine Size (cc)', 'Engine Size');
  const stroke    = get('stroke_type', 'stroke', 'engine_type', 'Engine Type', 'Stroke');
  const running   = get('running_status', 'Running Status');
  const vehicleTypeRaw = get('vehicle_type', 'discipline', 'type', 'Vehicle Type', 'Discipline');

  // Classify vehicle type
  const vtl = vehicleTypeRaw.toLowerCase();
  const vehicleType = vtl.includes('enduro') ? 'Enduro'
    : vtl.includes('trail') ? 'Trail Bike'
    : vtl.includes('supermoto') ? 'Supermoto'
    : vtl.includes('pit') ? 'Pit Bike'
    : vtl.includes('part') ? 'Motorcycle Part'
    : 'Motocross';

  const catKey = vehicleType.toLowerCase().replace(/\s/g, '');
  const needsLiveCategory = vehicleType === 'Supermoto' || vehicleType === 'Motorcycle Part';
  const cat = MX_EBAY_CATEGORIES[catKey] ?? (needsLiveCategory
    ? { id: '', name: 'Resolve from live EBAY_GB Taxonomy suggestions' }
    : MX_EBAY_CATEGORIES['motocross']);

  // Build structured title: [Year] [Make] [Model] [Engine]cc [Stroke] [Type] - [Running]
  const titleParts: string[] = [];
  if (yearRange) titleParts.push(yearRange);
  else if (year) titleParts.push(year);
  if (make) titleParts.push(make);
  if (model) titleParts.push(model);
  if (engineCc) {
    const num = engineCc.replace(/[^0-9]/g, '');
    titleParts.push(num ? `${num}cc` : engineCc);
  }
  if (stroke) {
    const s = stroke.toLowerCase().replace('stroke', '').replace('-', '').trim();
    titleParts.push(s === '2' || s === '2t' ? '2-Stroke' : s === '4' || s === '4t' ? '4-Stroke' : stroke);
  }
  titleParts.push(vehicleType);

  const titleBase = titleParts.join(' ').slice(0, 65).trim();

  let runSuffix = '';
  if (running) {
    const r = running.toLowerCase();
    runSuffix = r.includes('run') && r.includes('ride') ? ' - Runs & Rides'
      : r.includes('run') ? ' - Runs'
      : (r.includes('not') || r.includes("doesn't") || r.includes('no start')) ? ' - Non-Running'
      : r.includes('project') ? ' - Project'
      : ` - ${running}`;
  }

  const structuredTitle = (titleBase + runSuffix).slice(0, 80);

  const titleComponents: Record<string, string> = {};
  if (yearRange || year) titleComponents['Year'] = yearRange || year;
  if (make) titleComponents['Make'] = make;
  if (model) titleComponents['Model'] = model;
  if (engineCc) titleComponents['Engine Size'] = engineCc;
  if (stroke) titleComponents['Stroke Type'] = stroke;
  titleComponents['Vehicle Type'] = vehicleType;
  if (running) titleComponents['Running Status'] = running;

  // Build item specifics from all known MX attributes
  const seenKeys = new Set<string>();
  const keySpecs: Array<[string, string]> = [];
  for (const [rawKey, rawVal] of Object.entries(attrs)) {
    if (!rawVal || typeof rawVal === 'object') continue;
    const strVal = String(rawVal).trim();
    if (!strVal || strVal.toLowerCase() === 'unknown' || strVal === 'false') continue;
    if (rawKey.startsWith('_') || rawKey.startsWith('ebay') || rawKey.startsWith('numista')) continue;
    const displayName = MX_ATTR_CANONICAL[rawKey.toLowerCase()]
      ?? rawKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const canon = displayName.toLowerCase().replace(/[^a-z]/g, '');
    if (seenKeys.has(canon)) continue;
    seenKeys.add(canon);
    keySpecs.push([displayName.slice(0, 65), strVal.slice(0, 65)]);
  }

  const conditionParts = [
    item.condition_notes,
    attrs['engine_hours'] ? `Engine hours: ${attrs['engine_hours']}` : null,
    attrs['service_history'] ? `Service history: ${attrs['service_history']}` : null,
    attrs['modifications'] ? `Modifications: ${attrs['modifications']}` : null,
    attrs['damage'] ? `Damage: ${attrs['damage']}` : null,
    attrs['missing_parts'] ? `Missing parts: ${attrs['missing_parts']}` : null,
  ].filter(Boolean) as string[];

  const titleInstructions = [
    `MX TITLE FORMULA — use this pre-built title as your foundation:`,
    `"${structuredTitle}"`,
    ``,
    `Confirmed title components:`,
    ...Object.entries(titleComponents).map(([k, v]) => `  - ${k}: ${v}`),
    ``,
    `RULES:`,
    `- Keep the formula: [Year] [Make] [Model] [Engine cc] [Stroke] [Vehicle Type] - [Running Status]`,
    `- Omit any component that is not confirmed in the item attributes`,
    `- Do NOT invent manufacturer, model year, engine size, or stroke type`,
    `- Append running status suffix if known ("Runs & Rides", "Non-Running", "Project")`,
    `- Max 80 characters`,
    `- For MX/off-road bikes the running status is critical buyer information — always include it`,
  ].join('\n');

  const descriptionInstructions = [
    `MX DESCRIPTION STRUCTURE — write paragraphs in this order:`,
    `1. What it is: type, make, model, year (only state what is confirmed)`,
    `2. Running condition: completely honest — does it start, run, ride? Any issues?`,
    `   If unknown: "Running status unconfirmed — viewing strongly recommended before purchase"`,
    `3. Engine and drivetrain: size, stroke, condition, hours if known`,
    `4. Suspension: forks, shock, condition`,
    `5. Cosmetics and plastics: frame, bodywork, seat, general appearance`,
    `6. Modifications and aftermarket parts: list all known non-standard items`,
    `7. What is included: title document, keys, accessories, spare parts`,
    `8. Viewing: encourage inspection for complete bikes`,
    `9. Disclaimer for project/non-running: "Sold as seen — please inspect in person before purchase"`,
    ``,
    `RULES:`,
    `- NEVER say "Runs perfectly" unless running_status attribute explicitly confirms it`,
    `- Disclose all damage, wear, missing parts, and known issues`,
    `- For project bikes: open first sentence with the project status`,
    `- VIN/frame numbers noted if visible`,
    `- Do NOT use coin or collectibles language — this is a motorcycle`,
  ].join('\n');

  const categoryHints = [
    `MX EBAY CATEGORY:`,
    cat.id
      ? `Recommended verified EBAY_GB leaf: ${cat.name} (ID: ${cat.id})`
      : `No fixed category ID is supplied for ${vehicleType}. Resolve the correct leaf through live EBAY_GB Taxonomy suggestions; do not invent or reuse a parent ID.`,
    `Vehicle type: ${vehicleType}`,
    `- Motocross/Enduro/Trail bikes → verified leaf ID 79183`,
    `- Pit bikes → verified leaf ID 103963`,
    `- Parts and Supermoto → use live Taxonomy leaf suggestions, never historic parent IDs`,
  ].join('\n');

  return {
    structuredTitle,
    titleComponents,
    vehicleType,
    keySpecs,
    conditionNotes: conditionParts.join('\n'),
    titleInstructions,
    descriptionInstructions,
    categoryHints,
    ebayCategoryId: cat.id,
    ebayCategoryName: cat.name,
  };
}

// ── Confidence gate thresholds ────────────────────────────────────────────────
const MIN_IDENTIFICATION_CONFIDENCE_FOR_DEFINITIVE_TITLE = 0.70;
const MIN_VALUATION_CONFIDENCE_FOR_PRICE = ['high', 'medium'];

function valuationConfidenceAllowsPrice(confidence: string): boolean {
  return MIN_VALUATION_CONFIDENCE_FOR_PRICE.includes(confidence);
}

function identificationIsProvisional(item: any, isMX: boolean): boolean {
  // MX items with confirmed make+model are never marked provisional on identity grounds alone
  if (isMX) {
    const attrs = item.attributes ?? {};
    const hasMake = attrs['manufacturer'] || attrs['brand'] || attrs['make'];
    const hasModel = attrs['model'];
    if (hasMake && hasModel) return false;
  }
  const conf = Number(item.identification_confidence ?? 0);
  const state = item.attributes?.identification_state ?? '';
  const objectType = item.attributes?.object_type ?? '';
  return conf < MIN_IDENTIFICATION_CONFIDENCE_FOR_DEFINITIVE_TITLE ||
    state === 'observation_only' ||
    state === 'candidate' ||
    objectType === 'unknown';
}

function buildSafetyFlags(item: any, provisional: boolean, priceGateBlocked: boolean): string[] {
  const flags: string[] = [];
  if (provisional) {
    flags.push(`Identification provisional (confidence: ${Math.round(Number(item.identification_confidence ?? 0) * 100)}%) — listing title should reflect uncertainty`);
  }
  if (priceGateBlocked) {
    flags.push(`Price requires manual review — valuation confidence: ${item.valuation_confidence ?? 'not set'}`);
  }
  if (item.attributes?.has_hole) {
    flags.push('Item has hole/piercing — must be disclosed in listing');
  }
  if (item.attributes?.has_alteration) {
    flags.push('Item has alterations — must be disclosed in listing');
  }
  const objectType = item.attributes?.object_type ?? '';
  if (objectType === 'medal' || objectType === 'token') {
    flags.push(`Object type: ${objectType} — do not use coin-specific terminology or category`);
  }
  return flags;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('ONSPACE_AI_API_KEY');
    const baseUrl = Deno.env.get('ONSPACE_AI_BASE_URL');
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!apiKey || !baseUrl) {
      return new Response(
        JSON.stringify({ error: 'OnSpace AI not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Authentication required. Please sign in to SWISH.' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const token = authHeader.replace('Bearer ', '').trim();
    if (!token || token === Deno.env.get('SUPABASE_ANON_KEY')) {
      return new Response(JSON.stringify({ error: 'Authentication required. Please sign in to SWISH.' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired authentication token. Please sign in again.' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const body: ListingRequest = await req.json();
    const { item_id, tenant_id, marketplace_id = 'ebay' } = body;

    if (!item_id || !tenant_id) {
      return new Response(JSON.stringify({ error: 'item_id and tenant_id are required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: membership } = await supabaseAdmin
      .from('tenant_memberships')
      .select('id')
      .eq('tenant_id', tenant_id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!membership) {
      return new Response(JSON.stringify({ error: 'Access denied: you are not a member of this organisation.' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: item, error: itemError } = await supabaseAdmin
      .from('items')
      .select('*')
      .eq('id', item_id)
      .eq('tenant_id', tenant_id)
      .single();

    if (itemError || !item) {
      return new Response(
        JSON.stringify({ error: 'Item not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Detect specialist ────────────────────────────────────────────────────
    const specialistId: string = item.specialist_id ?? 'curiosities_collectibles';
    const isMXSpecialist = specialistId === 'motocross';
    const mxBrief: MXBrief | null = isMXSpecialist ? buildMXBrief(item) : null;

    // ── Safety gate evaluation ───────────────────────────────────────────────
    const provisional = identificationIsProvisional(item, isMXSpecialist);
    const priceGateBlocked = !valuationConfidenceAllowsPrice(item.valuation_confidence ?? '');
    const safetyFlags = buildSafetyFlags(item, provisional, priceGateBlocked);

    const objectType = item.attributes?.object_type ?? (isMXSpecialist ? 'motorcycle' : 'coin');
    const identificationState = item.attributes?.identification_state ?? 'candidate';
    const hasHole = item.attributes?.has_hole === true;
    const hasAlteration = item.attributes?.has_alteration === true;
    const alterationNotes = item.attributes?.alteration_notes ?? '';
    const numistaStatus = item.attributes?.numista_status ?? 'unknown';
    const identificationConf = Math.round(Number(item.identification_confidence ?? 0) * 100);

    console.log(`[swish-list-generate v2] Item: "${item.canonical_title}" specialist=${specialistId} provisional=${provisional} priceBlocked=${priceGateBlocked}${mxBrief ? ` mx_title="${mxBrief.structuredTitle}"` : ''}`);

    const FEES: Record<string, number> = {
      ebay: 0.1275,
      etsy: 0.065,
      amazon: 0.15,
    };
    const feeRate = FEES[marketplace_id] ?? 0.1275;
    const valuationMid = Number(item.valuation_mid ?? 0);
    const netIfSoldAtMid = valuationMid * (1 - feeRate);
    const profitIfSoldAtMid = netIfSoldAtMid - Number(item.acquired_cost ?? 0);

    // ── Attribute filter for non-MX items ────────────────────────────────────
    const ATTR_BLOCK_LIST = new Set([
      'batch_id', 'batchid', 'capture_ref', 'captureref',
      'object_type', 'objecttype', 'identification_state', 'identificationstate',
      'has_hole', 'has_alteration', 'alteration_notes', 'has_countermark',
      'ebay_category_id', 'ebay_category_name',
      'numista_type_id', 'numista_candidate_id', 'numista_status',
      'numista_match_score', 'numista_n', 'numista_url', 'numista_candidate_score',
      'numista_match_tier', 'numista_title',
      'inferred_issuer', 'inferred_ruler', 'inferred_monarch',
      'inferred_period', 'inferred_country', 'inferred_denomination', 'inferred_event',
      'valuation_confidence', 'identification_confidence',
      'canonical_title', 'metal',
    ]);

    const ATTR_CANONICAL: Record<string, string> = {
      'material': 'Metal', 'composition': 'Metal', 'metal_type': 'Metal',
      'country': 'Country/Region of Manufacture', 'country_of_origin': 'Country/Region of Manufacture',
      'year_made': 'Year', 'date': 'Year',
      'ruler': 'Ruler', 'monarch': 'Ruler',
      'period': 'Period', 'era': 'Period',
      'denomination': 'Denomination', 'face_value': 'Denomination',
      'mint': 'Mint', 'mint_house': 'Mint',
      'weight': 'Weight', 'diameter': 'Diameter',
    };

    const seenAttrNames = new Set<string>();
    const filteredAttrs: Array<[string, string]> = [];
    if (!isMXSpecialist) {
      for (const [k, v] of Object.entries(item.attributes as Record<string, any> ?? {})) {
        const kl = k.toLowerCase().replace(/[^a-z0-9_]/g, '');
        if (k.startsWith('_') || ATTR_BLOCK_LIST.has(k) || ATTR_BLOCK_LIST.has(kl)) continue;
        if (kl.startsWith('inferred') || kl.startsWith('numista') || kl.startsWith('ebay')) continue;
        if (v === null || v === undefined || Array.isArray(v)) continue;
        const strVal = String(v).trim();
        if (!strVal || strVal === 'false' || strVal === '0' || strVal === 'Unknown') continue;
        const displayName = ATTR_CANONICAL[k] ?? ATTR_CANONICAL[kl] ??
          k.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
        if (seenAttrNames.has(displayName)) continue;
        seenAttrNames.add(displayName);
        filteredAttrs.push([displayName, strVal.slice(0, 65)]);
      }
    }

    // For MX use pre-structured key specs; for others use filtered attrs
    const attributesText = mxBrief
      ? mxBrief.keySpecs.slice(0, 14).map(([k, v]) => `  - ${k}: ${v}`).join('\n')
      : filteredAttrs.length > 0
        ? filteredAttrs.slice(0, 12).map(([k, v]) => `  - ${k}: ${v}`).join('\n')
        : '  (none recorded)';

    const warningsText = (item.warnings as string[] ?? []).length > 0
      ? (item.warnings as string[]).map((w: string) => `  - ${w}`).join('\n')
      : '  (none)';

    const conditionDisclosures: string[] = [];
    if (hasHole) conditionDisclosures.push('DISCLOSURE REQUIRED: Object has been pierced/holed. This MUST be disclosed in the listing description.');
    if (hasAlteration) conditionDisclosures.push(`DISCLOSURE REQUIRED: Object has alterations. ${alterationNotes ? `Notes: ${alterationNotes}.` : ''} This MUST be disclosed in the listing description.`);

    // ── Title / description / pricing instructions (niche-aware) ────────────
    const titleInstructions = mxBrief
      ? mxBrief.titleInstructions
      : provisional
        ? `IMPORTANT: Identification is PROVISIONAL (confidence: ${identificationConf}%). Title MUST include "Possible" or "Provisional".`
        : `Identification confidence is ${identificationConf}% — write a confident, accurate title.`;

    const descriptionInstructions = mxBrief
      ? mxBrief.descriptionInstructions
      : provisional
        ? `Write an HONEST description that clearly states the identification is provisional/unconfirmed.`
        : `Write a professional, accurate description reflecting the confirmed identification. Focus on visible, verifiable characteristics.`;

    const pricingInstructions = priceGateBlocked
      ? `PRICING: Valuation confidence "${item.valuation_confidence ?? 'not set'}" is INSUFFICIENT. Set all prices to 0 and set price_requires_manual_review to true.`
      : `PRICING: Evidence-based valuation available (confidence: ${item.valuation_confidence}). Recommended price near £${valuationMid.toFixed(2)}. Do NOT inflate beyond the valuation evidence.`;

    // ── Object type instructions ─────────────────────────────────────────────
    const objectTypeInstructions = isMXSpecialist
      ? `SPECIALIST: MOTOCROSS / OFF-ROAD MOTORCYCLE\nVehicle type: ${mxBrief?.vehicleType ?? 'Motocross'}\nThis is a motorcycle listing — use motorcycle terminology. Running status is the most important field buyers check. Never guess make, model, year, or engine size if not in attributes.`
      : objectType === 'medal'
        ? 'OBJECT TYPE: MEDAL — do NOT use coin terminology. Use medal-specific language.'
        : objectType === 'token'
          ? 'OBJECT TYPE: TOKEN — describe as a token, not a coin.'
          : objectType === 'unknown'
            ? 'OBJECT TYPE: Unconfirmed — describe as "unidentified object" or "possible [candidate type]".'
            : '';

    const forbiddenClaimsText = `
FORBIDDEN — never include these in title or description:
- "rare", "scarce", "extremely rare", "very rare" — unless verified by a cited source
- "museum quality", "museum piece" — unless provenance is verified
- "valuable" as an adjective
- Any specific historical person unless visible in inscription or confirmed by authoritative source
- Claims about metal fineness unless hallmarks are visible and confirmed
- Any catalogue number not explicitly stated in item attributes
- Any price or value claim ("worth £X", "sells for £X")
`;

    const systemPrompt = `You are SWISH, a specialist commerce intelligence engine that generates accurate, honest marketplace listings for physical goods including coins, collectibles, and motorcycles.

CORE PRINCIPLES:
1. Accuracy over sales appeal — never misrepresent what an item is
2. Provisional identifications must be disclosed as provisional
3. Never invent attributions, specifications, or valuations not supported by evidence
4. Running condition for motorcycles must always be stated honestly
5. Holes, piercings, and alterations must be disclosed — never hidden
6. If an item cannot be reliably priced, set price to 0

You always respond with ONLY valid JSON — no markdown, no explanation, no preamble.`;

    const userPrompt = `Generate a ${marketplace_id.toUpperCase()} listing for this item.

ITEM DATA:
- Canonical title: ${item.canonical_title}
- Object type: ${objectType}
- Specialist: ${specialistId}${isMXSpecialist ? ' (MOTOCROSS — follow MX title formula below)' : ''}
- Identification state: ${identificationState}
- Identification confidence: ${identificationConf}%
${isMXSpecialist ? '- Numista verification: N/A — motorcycle specialist' : `- Numista verification status: ${numistaStatus}`}
- Condition: ${item.condition ?? 'Not assessed'}${item.condition_grade ? ` · Grade: ${item.condition_grade}` : ''}
- Condition notes: ${item.condition_notes ?? mxBrief?.conditionNotes ?? 'None'}
- Valuation: £${item.valuation_low}–£${item.valuation_high} (mid: £${valuationMid}) · confidence: ${item.valuation_confidence ?? 'not set'}
- Acquired cost: £${item.acquired_cost ?? 0}

IDENTIFIED ATTRIBUTES:
${attributesText}

WARNINGS/FLAGS:
${warningsText}

CONDITION DISCLOSURES:
${conditionDisclosures.length > 0 ? conditionDisclosures.join('\n') : '  None required'}

IDENTIFICATION / TITLE INSTRUCTIONS:
${titleInstructions}

DESCRIPTION INSTRUCTIONS:
${descriptionInstructions}

PRICING INSTRUCTIONS:
${pricingInstructions}

${mxBrief ? mxBrief.categoryHints + '\n' : ''}${objectTypeInstructions ? `OBJECT TYPE INSTRUCTIONS:\n${objectTypeInstructions}` : ''}

${forbiddenClaimsText}

FINANCIAL CONTEXT:
- ${marketplace_id.toUpperCase()} indicative fee rate: ${(feeRate * 100).toFixed(2)}%
- Net at mid valuation: £${netIfSoldAtMid.toFixed(2)}
- Estimated profit at mid: £${profitIfSoldAtMid.toFixed(2)}

REQUIREMENTS:
1. Title: Max 80 characters.${isMXSpecialist ? ' Follow the MX title formula above.' : ' Include "Possible"/"Provisional" if identification is not confirmed.'}
2. Description: 150–400 words. Honest and professional.${isMXSpecialist ? ' Follow MX description structure.' : ' Disclose provisional identification and alterations if present.'} Use paragraph breaks (\\n\\n).
3. Category: Human-readable category path for ${marketplace_id}
4. Condition ID: "1000"=New, "2500"=Refurbished, "3000"=Used, "4000"=Very Good, "5000"=Good, "6000"=Acceptable
5. Item specifics: 5–12 key-value pairs from confirmed attributes only. Each name/value max 65 chars. Exclude internal IDs, Numista fields, inferred fields.
6. Keywords: 10–15 search terms buyers would actually use
7. Listing format: "FixedPrice" for most items; "Auction" for uncertain value

Return ONLY this exact JSON:
{
  "title": "string — max 80 chars",
  "description": "string — honest, professional",
  "category": "string — category path",
  "category_id": "string — eBay category ID",
  "condition_id": "string — condition code",
  "condition_description": "1–2 sentences from visible/stated condition only",
  "recommended_price": number,
  "floor_price": number,
  "ceiling_price": number,
  "item_specifics": { "key": "value" },
  "keywords": ["string"],
  "listing_format": "FixedPrice|Auction",
  "duration": "GTC|7",
  "shipping_profile": "[SWISH uses eBay Business Policies from Settings]",
  "returns_policy": "[SWISH uses eBay Business Policies from Settings]",
  "rationale": "string — honest explanation of title/price approach",
  "price_requires_manual_review": ${priceGateBlocked},
  "price_review_reason": ${priceGateBlocked ? `"Valuation confidence '${item.valuation_confidence ?? 'not set'}' — research current market price before listing"` : 'null'},
  "identification_is_provisional": ${provisional}
}`;

    const aiResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 2048,
      }),
    });

    if (!aiResponse.ok) {
      console.error('[swish-list-generate v2] AI provider request failed:', aiResponse.status);
      return new Response(
        JSON.stringify({ error: 'Listing generation is temporarily unavailable. Please retry.' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const aiData = await aiResponse.json();
    const rawContent: string = aiData.choices?.[0]?.message?.content ?? '';

    let listing: GeneratedListing;
    try {
      const cleaned = rawContent
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
      listing = JSON.parse(cleaned);
    } catch {
      console.error('[swish-list-generate v2] AI provider returned an invalid listing response.');
      return new Response(
        JSON.stringify({ error: 'AI returned invalid JSON. Please retry.' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── SAFETY GATE: price lock ──────────────────────────────────────────────
    if (priceGateBlocked) {
      listing.recommended_price = 0;
      listing.floor_price = 0;
      listing.ceiling_price = 0;
      listing.price_requires_manual_review = true;
      listing.price_review_reason = listing.price_review_reason ??
        `Valuation confidence '${item.valuation_confidence ?? 'not set'}' — run Re-Value to get evidence-based pricing`;
    } else {
      const minFloor = Math.max(Number(item.acquired_cost ?? 0) * 1.02, 0.99);
      const maxCeiling = valuationMid * 2.5;
      listing.recommended_price = Math.max(minFloor, Math.min(listing.recommended_price ?? valuationMid, maxCeiling));
      listing.floor_price = Math.max(minFloor, listing.floor_price ?? minFloor);
      listing.ceiling_price = Math.min(maxCeiling, Math.max(listing.ceiling_price ?? valuationMid * 1.5, listing.recommended_price));
    }

    // ── MX post-process: enforce structured title and category ───────────────
    if (mxBrief) {
      // Override title with structured MX formula if AI deviated from key components
      const componentCount = Object.keys(mxBrief.titleComponents).length;
      if (componentCount >= 2 && mxBrief.structuredTitle.length > 10) {
        const aiTitleLower = (listing.title ?? '').toLowerCase();
        const allComponentsPresent = Object.values(mxBrief.titleComponents).every(
          v => aiTitleLower.includes(v.toLowerCase().slice(0, 4))
        );
        if (!allComponentsPresent) {
          listing.title = mxBrief.structuredTitle;
          console.log(`[swish-list-generate v2] MX title override applied: "${listing.title}"`);
        }
      }

      // Apply MX eBay category if not set by AI or category_id is missing
      if (!listing.category_id && mxBrief.ebayCategoryId) {
        listing.category_id = mxBrief.ebayCategoryId;
        listing.category = listing.category || mxBrief.ebayCategoryName;
      }

      // Merge confirmed MX item specifics that AI may have missed
      const existingSpecs = listing.item_specifics ?? {};
      const seenSpecKeys = new Set(
        Object.keys(existingSpecs).map(k => k.toLowerCase().replace(/[^a-z]/g, ''))
      );
      for (const [specName, specVal] of mxBrief.keySpecs.slice(0, 12)) {
        const canonKey = specName.toLowerCase().replace(/[^a-z]/g, '');
        if (!seenSpecKeys.has(canonKey)) {
          existingSpecs[specName] = specVal;
          seenSpecKeys.add(canonKey);
        }
      }
      listing.item_specifics = existingSpecs;
    }

    // ── SAFETY GATE: provisional title enforcement (non-MX) ─────────────────
    if (provisional && !isMXSpecialist) {
      const title = listing.title ?? '';
      const hasProvisionalMarker = /possible|provisional|probable|unverified|identification requires/i.test(title);
      if (!hasProvisionalMarker && identificationConf < 50) {
        listing.title = `Possible ${title.slice(0, 60).trim()}`.slice(0, 80);
      }
      listing.identification_is_provisional = true;
    }

    // ── SAFETY GATE: remove forbidden title terms ────────────────────────────
    const forbiddenInTitle = ['extremely rare', 'very rare', 'museum quality', 'museum piece'];
    for (const term of forbiddenInTitle) {
      if (listing.title.toLowerCase().includes(term)) {
        listing.title = listing.title.replace(new RegExp(term, 'gi'), '').replace(/\s+/g, ' ').trim();
      }
    }

    // ── POST-PROCESS item_specifics: clean junk fields ────────────────────────
    const SPEC_BLOCK_PATTERNS = [
      /^(batch|capture).*id/i, /^(object|objecttype|object type)$/i,
      /^(has[_ ]?alteration|has[_ ]?hole|has[_ ]?countermark)/i,
      /^alteration[_ ]?notes/i, /^(inferred|ebay[_ ]?category|numista)/i,
      /^(valuation|identification)[_ ]?confidence/i,
      /^(capture[_ ]?ref|batch[_ ]?ref)/i,
      /uuid|[0-9a-f]{8}-[0-9a-f]{4}/i,
    ];
    const SPEC_DEDUP = new Map<string, true>();
    if (listing.item_specifics && typeof listing.item_specifics === 'object') {
      const cleanedSpecs: Record<string, string> = {};
      for (const [name, val] of Object.entries(listing.item_specifics)) {
        if (!name || !val) continue;
        if (SPEC_BLOCK_PATTERNS.some(re => re.test(String(name)))) continue;
        const strVal = String(val).trim();
        if (!strVal || strVal.toLowerCase() === 'unknown' || strVal.toLowerCase() === 'false') continue;
        const canon = String(name).toLowerCase().replace(/[^a-z]/g, '');
        if (SPEC_DEDUP.has(canon)) continue;
        SPEC_DEDUP.set(canon, true);
        cleanedSpecs[String(name).slice(0, 65)] = strVal.slice(0, 65);
      }
      listing.item_specifics = cleanedSpecs;
    }

    listing.safety_flags = safetyFlags;

    console.log(`[swish-list-generate v2] Generated: "${listing.title}" @ £${listing.recommended_price} (priceBlocked=${priceGateBlocked} provisional=${provisional} specialist=${specialistId})`);

    return new Response(
      JSON.stringify({ listing, marketplace_id }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('[swish-list-generate v2] Unexpected request failure.');
    return new Response(
      JSON.stringify({ error: 'Unable to generate the listing. Please retry.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
