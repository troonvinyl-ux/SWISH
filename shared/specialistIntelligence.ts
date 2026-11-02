// Public, dependency-free specialist expertise. No credentials, network or React.
// Identity/package/specialist ownership remains in niche-modules.json.
export interface SpecialistField { key: string; label: string; specific?: string }
export interface SpecialistProfile {
  nicheId: string; focus: string; modes: Array<{ id: string; label: string }>;
  taxonomy: string[]; fields: SpecialistField[]; recognition: string; conditionRules: string;
  valuationRules: string; listingRules: string; sourcingChecks: string[];
  sources: Array<{ label: string; url: string }>;
}
export const SPECIALIST_PROFILE_VERSION = '2026-10-30.1';
const field = (key: string, label: string, specific?: string): SpecialistField => ({ key, label, specific });
export const SPECIALIST_PROFILES: Record<string, SpecialistProfile> = {
  coins: {
    nicheId: 'coins', focus: 'Legends, two-face attribution and physical contradictions', modes: [{ id: 'item', label: 'Coin / collectible' }],
    taxonomy: ['coin', 'medal', 'token', 'banknote', 'precious metal', 'artefact'],
    fields: [field('denomination','Denomination','Denomination'),field('ruler','Issuer / ruler','Ruler'),field('mint','Mint','Mint'),field('year','Date','Year'),field('weight_g','Measured weight (g)'),field('diameter_mm','Measured diameter (mm)'),field('catalogue_number','Catalogue claim'),field('legend','Visible legend')],
    recognition: 'Use both faces, literal visible legends and measured weight/diameter. Catalogue type is not a date/mint/variety guarantee. Separate host and countermark. Preserve the existing Numista/Islamic evidence pipeline; a catalogue match is not authentication.',
    conditionRules: 'Describe wear, corrosion, cleaning indicators and alterations. Do not assign a professional grade or certify metal from colour.',
    valuationRules: 'Match type, date/mint, condition and sale format; catalogue specifications are not sale prices. Hammered coin measurements vary. Treat exceptional auction prices separately.',
    listingRules: 'Disclose provisional attribution and alterations. Do not invent rarity, catalogue references or provenance.',
    sourcingChecks: ['Check both faces and measurements before attribution','Do not clean a collectible coin to improve appearance','Require provenance and independent authentication for high-risk pieces'],
    sources: [{ label: 'Numista type definitions', url: 'https://en.numista.com/help/coin-types-145.html' }],
  },
  motocross: {
    nicheId: 'motocross', focus: 'Part-number evidence, OEM distinction and fitment uncertainty', modes: [{ id: 'item', label: 'Complete bike' },{ id: 'part', label: 'Part / equipment' }],
    taxonomy: ['motocross', 'enduro', 'trail', 'engine part', 'suspension', 'exhaust', 'riding equipment'],
    fields: [field('manufacturer','Manufacturer','Brand'),field('model','Model','Model'),field('part_number','Printed part number','Manufacturer Part Number'),field('component_type','Component','Type'),field('year_range','Year range'),field('oem_status','OEM / aftermarket'),field('fitment','Fitment claim'),field('running_status','Running / tested status'),field('missing_parts','Missing components')],
    recognition: 'First distinguish complete bike, component and equipment. For parts read exact stamped/printed numbers, mounting points and dimensions. Appearance alone never verifies fitment or OEM origin. Compare model/year/market in manufacturer parts finder; do not invent compatibility tables. For complete bikes retain manufacturer/model-family/year-range/VIN workflow.',
    conditionRules: 'Show cracks, welds, bent mounting points, corrosion, seal leaks, missing fasteners. Running status, engine hours and service history require user test records, not images. Safety equipment needs history and physical inspection.',
    valuationRules: 'Compare identical part number and verified fitment, OEM status, completeness and tested condition. Price complete bikes separately from parts. Transport, repair estimates and testing labour must be supplied, not guessed.',
    listingRules: 'Parts titles use brand + exact part number + component. Add motorcycle fitment only with reliable evidence. Never force a component into a complete-motorcycle category or claim it runs because it looks intact.',
    sourcingChecks: ['Match exact part number against manufacturer documentation','Inspect mounting damage and missing hardware','Record testing and transport costs before buying'],
    sources: [{ label: 'KTM parts finder (manual verification)', url: 'https://sparepartsfinder.ktm.com/' }],
  },
  bicycles: {
    nicheId: 'bicycles', focus: 'Component standards, mechanical testing and repair economics', modes: [{ id: 'item', label: 'Complete bicycle' },{ id: 'part', label: 'Component' }],
    taxonomy: ['road', 'mountain', 'gravel', 'hybrid', 'BMX', 'e-bike', 'frame', 'drivetrain', 'brake', 'wheel'],
    fields: [field('brand','Brand','Brand'),field('model','Model','Model'),field('part_number','Component model number','MPN'),field('bike_type','Bicycle type','Bike Type'),field('frame_size','Measured frame size','Frame Size'),field('wheel_size','Wheel standard','Wheel Size'),field('groupset','Groupset'),field('speeds','Speed count'),field('brake_type','Brake type','Brake Type'),field('fitment','Compatibility claim'),field('tested_status','Mechanical test status')],
    recognition: 'Read frame and component labels. Never estimate rider fit/frame size without scale or measurements. Wheel diameter, axle standard, freehub spline, drivetrain speed and brake mount must be distinguished. Shimano, SRAM and Campagnolo similarity does not imply compatibility. E-bike chargers and batteries require exact model checks.',
    conditionRules: 'Describe visible cracks, dents, corrosion, dropout and fork damage. Photographs cannot establish mechanical safety, bearing condition, shifting quality or battery health.',
    valuationRules: 'Match complete bicycle specification and condition or exact component model. Complete-versus-breakup economics require separate part price evidence, extra fees, tools, labour, disposal and unsold-parts allowance.',
    listingRules: 'Use measured size and documented standards only. Disclose untested mechanical condition and mismatched components.',
    sourcingChecks: ['Check frame integrity and ownership documentation','Verify drivetrain/brake/axle standards','Budget service labour and parts separately'],
    sources: [{ label: 'Shimano compatibility charts', url: 'https://productinfo.shimano.com/en/compatibility' }],
  },
  clothing: {
    nicheId: 'clothing', focus: 'Labels, measurements, vintage evidence and rapid listing preparation', modes: [{ id: 'item', label: 'Garment / footwear' }],
    taxonomy: ['jacket', 'coat', 'shirt', 'dress', 'jeans', 'knitwear', 'trainers', 'accessory'],
    fields: [field('brand','Brand label','Brand'),field('garment_type','Garment type','Type'),field('department','Department','Department'),field('size','Labelled size','Size'),field('colour','Colour','Colour'),field('style','Style','Style'),field('outer_shell_material','Outer shell material','Outer Shell Material'),field('composition','Care-label composition','Material'),field('era','Era / dating evidence'),field('measurements','Measured chest / length / waist'),field('damage_notes','Visible defects')],
    recognition: 'Read brand, size and care labels exactly. Distinguish a visible logo from proven authenticity. Vintage dating requires specific label/construction evidence; no fixed rolling year cutoff. Collaborations need identifying product/label evidence. Convert sizes only with brand/region-specific verified data.',
    conditionRules: 'Describe stains, holes, seams, pilling, fading and missing buttons with location. Smell, shrinkage and undisclosed repairs require seller inspection. Footwear needs soles and interior labels.',
    valuationRules: 'Match brand, garment/model, size, era, condition and season. Do not imply access to Depop/Vinted completed sales. Cleaning cost and return allowance are user assumptions.',
    listingRules: 'Map Brand, Department, Size, Colour, Style and Outer Shell Material only when supported and appropriate to the selected category. Never copy coin fields. Include measured dimensions and all visible flaws.',
    sourcingChecks: ['Photograph all labels and defects','Measure garments rather than relying on size conversions','Escalate designer authenticity concerns'],
    sources: [{ label: 'eBay category-specific requirements', url: 'https://www.ebay.co.uk/sellercentre/listings/item-specifics' }],
  },
  trading_cards: {
    nicheId: 'trading_cards', focus: 'Exact checklist identity, parallel discrimination and condition observations', modes: [{ id: 'item', label: 'Single card' }],
    taxonomy: ['Pokémon', 'sports', 'Magic', 'Yu-Gi-Oh', 'non-sport', 'graded card'],
    fields: [field('card_name','Player / character','Card Name'),field('set','Set / checklist','Set'),field('card_number','Printed card number','Card Number'),field('year','Printed year','Year Manufactured'),field('brand','Publisher','Manufacturer'),field('edition','Edition','Edition'),field('parallel','Foil / parallel','Parallel/Variety'),field('language','Language','Language'),field('serial_number','Printed numbering'),field('grade_label','Existing slab label')],
    recognition: 'Use exact name, card number, set symbol, copyright, language, edition marks and both faces. Distinguish base/reverse-holo/parallel/reprint via photographed foil pattern and printed identifiers. Slab labels are claims until verified with the grading company; do not invent a checklist match or a certification lookup.',
    conditionRules: 'Observe centring only in straight-on uncropped images with all borders visible. Show corners, whitening, creases and surface scratches; glare can conceal damage. No PSA/BGS predicted numeric grade or authenticity guarantee from photos.',
    valuationRules: 'Raw and graded prices are separate markets. Compare exact set/number/parallel/language and actual grade. Grading economics require probabilities, fees, insured shipping and delay; never assume a perfect grade.',
    listingRules: 'Use exact checklist identifiers and disclose uncertain parallels. Do not title an ungraded card PSA 10 or claim an autograph authenticated without records.',
    sourcingChecks: ['Verify set, number and foil pattern together','Examine front/back edges and creases','Keep raw and graded comparisons separate'],
    sources: [{ label: 'PSA research and grading process', url: 'https://www.psacard.com/articles/articleview/10241/psa-update-journey-card' }],
  },
  antiques: {
    nicheId: 'antiques', focus: 'Marks, construction and cautious maker/period attribution', modes: [{ id: 'item', label: 'Object / book' }],
    taxonomy: ['ceramics', 'porcelain', 'glass', 'glassware', 'silverware', 'decorative arts', 'furniture', 'artwork', 'book', 'books'],
    fields: [field('object_type','Object type','Type'),field('maker','Maker / attribution'),field('marks','Literal marks'),field('material','Material','Material'),field('period','Period evidence'),field('pattern','Pattern / style'),field('dimensions','Measured dimensions'),field('restoration','Restoration observations'),field('provenance','Provenance claim'),field('edition','Book edition')],
    recognition: 'Read underside marks/signatures with their shape and typeface. never invent a maker. A sponsor hallmark is not always manufacturer. Distinguish style from production date and maker attribution from a verified mark. Books need title/copyright/number-line evidence and jacket details.',
    conditionRules: 'Record chips, cracks, hairlines, replacements, repairs and overpainting. Do not recommend polishing. Do not infer originality, solid silver or a signature authentication from appearance.',
    valuationRules: 'Compare maker, pattern, dimensions, period evidence, condition and restorations using completed-sale evidence. Auction hammer prices differ from buyer total and dealer asking prices; record basis explicitly.',
    listingRules: 'Use attributed to / in the style of when justified; include required item specifics; do not assert rare, antique, authentic or a maker without evidence. Describe restorations and provenance limits.',
    sourcingChecks: ['Read the entire mark rather than initials alone','Inspect underside, joints and repairs','Account for fragile packaging and transport'],
    sources: [{ label: 'Sheffield mark identification', url: 'https://www.assayoffice.co.uk/the-library-and-the-silver-collection/mark-identification' }],
  },
  fossils: {
    nicheId: 'fossils', focus: 'Diagnostic anatomy, scale and responsible provenance', modes: [{ id: 'item', label: 'Specimen' }],
    taxonomy: ['ammonite', 'trilobite', 'tooth', 'shell', 'plant fossil', 'bone', 'mineral', 'cast / replica'],
    fields: [field('taxonomic_group','Taxonomic group'),field('species','Species candidate'),field('anatomical_features','Diagnostic features'),field('period','Period claim'),field('formation','Formation claim'),field('locality','Reported locality'),field('dimensions','Measured size'),field('matrix','Matrix / preservation'),field('restoration','Repair / composite indicators'),field('provenance','Collection permission / provenance')],
    recognition: 'Classify broad group before species. Require scale, anatomical detail, other angles and reported locality/formation when relevant. Locality is user-supplied provenance, not visible proof. Do not derive a precise geological age from appearance; separate mineral lookalikes, casts and composites.',
    conditionRules: 'Describe missing anatomy, cracks, preparation, glue and composite indicators only where visible. Do not recommend destructive acid or mechanical preparation.',
    valuationRules: 'Compare group, size, completeness, restoration and documented legal provenance. Unsupported species or age lowers confidence. Only legally tradable specimens should proceed.',
    listingRules: 'Use candidate taxon and reported provenance explicitly; flag protected sites, ownership/export issues for expert review, never give blanket legal clearance.',
    sourcingChecks: ['Obtain scale and locality/formation records','Check restoration and completeness','Confirm collecting permission and trade/export restrictions'],
    sources: [{ label: 'Natural History Museum identification guidance', url: 'https://www.nhm.ac.uk/take-part/identify-nature.html' }],
  },
  beauty: {
    nicheId: 'beauty', focus: 'Packaging identity and safety-first resale screening', modes: [{ id: 'item', label: 'Product / accessory' }],
    taxonomy: ['cosmetics', 'fragrance', 'skincare', 'haircare', 'accessory', 'empty container'],
    fields: [field('brand','Brand','Brand'),field('product_name','Product','Product Line'),field('product_type','Product type','Type'),field('shade','Shade / variant','Shade'),field('size','Printed volume / weight','Size'),field('barcode','EAN / barcode','EAN'),field('batch_code','Batch code'),field('expiry_date','Printed expiry date'),field('pao','Period after opening'),field('sealed','Seal status'),field('opened','Opened / used status'),field('tester','Tester / not-for-sale'),field('packaging_status','Original / decanted packaging'),field('ingredients','Ingredients'),field('responsible_person','UK responsible person / address'),field('recall_status','Recall check status')],
    recognition: 'Read packaging, shade, volume, barcode, batch, expiry and seal evidence. A batch code has no universal decoder; do not invent manufacture/expiry dates. PAO starts after opening, not manufacture. Packaging similarity does not prove authenticity or safety.',
    conditionRules: 'Seal condition and packaging observations are not microbiological safety checks. Ask about opened/used, expiry, provenance, recalls and original packaging. Do not encourage sale of unsafe, expired, recalled, counterfeit, testers, decanted or used perfume products.',
    valuationRules: 'Screen resale eligibility before valuation. Compare exact variant/volume and sealed condition. A low price never outweighs product safety or marketplace restrictions.',
    listingRules: 'Use eBay UK cosmetics policy; testers, decanted, not-for-sale samples and used perfume are prohibited. SWISH conservatively restricts opened cosmetics to review. Require ingredients, EAN and responsible-person information for applicable products. No medical claims or safety guarantees.',
    sourcingChecks: ['Confirm original packaging, seal and expiry','Check recalls and supplier provenance independently','Read eBay UK cosmetics policy before drafting'],
    sources: [{ label: 'eBay UK cosmetics and perfume policy', url: 'https://www.ebay.co.uk/help/policies/prohibited-restricted-items/cosmetics-perfume-policy?id=4290' }],
  },
  tech: {
    nicheId: 'tech', focus: 'Exact hardware variants, functional tests and ownership locks', modes: [{ id: 'item', label: 'Device / accessory' }],
    taxonomy: ['phone', 'tablet', 'laptop', 'desktop', 'console', 'game', 'component', 'accessory'],
    fields: [field('brand','Brand','Brand'),field('model','Model','Model'),field('model_number','Model number','MPN'),field('storage','Storage','Storage Capacity'),field('specifications','Verified specifications'),field('region','Region / revision'),field('tested_status','Functional test results'),field('battery_health','Measured battery health'),field('activation_lock','Activation / account lock'),field('accessories','Included accessories'),field('damage_notes','Visible damage')],
    recognition: 'Read exact model/regulatory labels and distinguish storage, generation, region and hardware revisions. Only derive specs from supplied system screens/labels or verified manufacturer documentation, not appearance. A powered screen alone does not establish functionality.',
    conditionRules: 'Record cosmetic damage, liquid/corrosion and battery swelling indicators. Require charging, ports, network, display, input and battery tests as relevant. Ask about activation/account/MDM/carrier locks; never suggest bypassing security.',
    valuationRules: 'Match exact specification, region, tested status, locks and included charger/accessories. Repair costs need user estimates or quotations. Separate working, untested and parts-only evidence.',
    listingRules: 'Disclose functional tests and remaining unknowns. Never write fully working based on photos or claim an activation-locked device is unlocked. Do not publish full serials or credentials.',
    sourcingChecks: ['Verify ownership and activation/account locks before purchase','Record relevant functional tests and battery status','Match charger and accessories to exact model'],
    sources: [{ label: 'Apple preowned-device inspection', url: 'https://support.apple.com/en-us/104999' }],
  },
  surplus_flip: {
    nicheId: 'surplus_flip', focus: 'Manifest uncertainty, sellable yield and total lot economics', modes: [{ id: 'item', label: 'Manifest product' },{ id: 'lot', label: 'Lot evidence' }],
    taxonomy: ['overstock', 'clearance', 'customer returns', 'job lot', 'pallet', 'damaged / salvage'],
    fields: [field('supplier_sku','Manifest SKU'),field('barcode','Barcode','EAN'),field('brand','Brand','Brand'),field('model','Model','Model'),field('manifest_quantity','Declared quantity'),field('observed_quantity','Visible count'),field('quantity_available','Confirmed sellable units'),field('tested_status','Testing status'),field('missing_parts','Missing accessories'),field('condition_mix','Condition mix'),field('manifest_match','Manifest match evidence')],
    recognition: 'Distinguish manifest declaration, visible count and confirmed sellable quantity. Occluded products cannot be counted exactly. Match labels/SKU/barcode to the selected line without assuming packaging proves contents. Lot composition is a proposal, not automatic item creation.',
    conditionRules: 'Unopened packaging does not prove new contents; returns may be damaged, incomplete or untested. Flag restricted categories. Never infer all units work from a sample photograph.',
    valuationRules: 'Do not sum retail RRPs as recoverable value. Require usable-unit yield, fees, buyer premium, transport, testing, storage, disposal and labour. Compare bulk exit with individual sales using explicit assumptions; unknown sell-through stays unknown.',
    listingRules: 'Use verified SKU, condition and sellable units. Disclose mixed/untested condition. Do not auto-create hundreds of records or publish a lot from estimated counts.',
    sourcingChecks: ['Reconcile manifest and physical contents','Stress-test sellable yield and labour costs','Compare lot exit with individual sale economics'],
    sources: [{ label: 'Liquidation manifest risks (supplier guidance)', url: 'https://www.directliquidation.com/liquidation-102/buying-unmanifested-liquidation-pallets-truckloads-need-know/' }],
  },
};
export type ConfidenceDimension = 'identification' | 'variant' | 'condition' | 'authenticity' | 'compatibility' | 'valuation';
export interface FollowUp { key: string; question: string; reason: string; photo: string }
export interface SpecialistAnalysis {
  version: string; fields: Record<string, { value: string; basis: 'observed' | 'user_supplied' | 'inferred'; reason: string }>;
  confidence: Record<ConfidenceDimension, number | null>;
  quality: { status: 'suitable' | 'limited' | 'retake' | 'not_assessed'; issues: string[]; nextPhoto: string };
  followUps: FollowUp[]; risks: string[];
}
export function getSpecialistProfile(nicheId: string): SpecialistProfile | null { return SPECIALIST_PROFILES[nicheId] ?? null; }
export function recordValue(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}
export function usefulText(value: unknown, max = 500): string {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return '';
  const text = String(value).trim().slice(0, max);
  return /^(unknown|not established|not supplied|not visible|not legible|null|undefined|n\/a)$/i.test(text) ? '' : text;
}
export function textList(value: unknown, max = 8): string[] {
  return Array.isArray(value) ? value.filter(v => typeof v === 'string').map(v => usefulText(v)).filter(Boolean).slice(0,max) : [];
}
// Model percentages are not verified facts. Unsupported dimensions stay null.
export function normalizeSpecialistAnalysis(raw: unknown, profile: SpecialistProfile, identity: number): SpecialistAnalysis {
  const data = recordValue(raw); const fields: SpecialistAnalysis['fields'] = {};
  for (const descriptor of profile.fields) {
    const input = recordValue(recordValue(data.fields)[descriptor.key]); const value = usefulText(input.value);
    if (value) fields[descriptor.key] = { value, basis: ['observed','user_supplied'].includes(input.basis) ? input.basis : 'inferred', reason: usefulText(input.reason) };
  }
  const dimensions = ['identification','variant','condition','authenticity','compatibility','valuation'] as const;
  const confidence = {} as SpecialistAnalysis['confidence'];
  for (const key of dimensions) {
    const value = recordValue(data.confidence)[key];
    confidence[key] = typeof value === 'number' && Number.isFinite(value) ? Math.max(0,Math.min(1,value)) : null;
  }
  confidence.identification = Number.isFinite(identity) ? Math.max(0,Math.min(1,identity)) : 0;
  confidence.valuation = null; // Identification is not a market valuation call.
  confidence.authenticity = null; // Photos alone never certify authenticity.
  confidence.compatibility = null; // No manufacturer fitment API lookup occurred.
  const q = recordValue(data.quality);
  const quality: SpecialistAnalysis['quality'] = { status: ['suitable','limited','retake'].includes(q.status) ? q.status : 'not_assessed', issues: textList(q.issues,5), nextPhoto: usefulText(q.nextPhoto) };
  const allowed = new Set(profile.fields.map(f => f.key));
  const followUps = (Array.isArray(data.followUps) ? data.followUps : []).map((input: unknown) => recordValue(input))
    .filter(input => allowed.has(input.key) && usefulText(input.question) && (!fields[input.key] || fields[input.key].basis === 'inferred'))
    .filter((input,index,all) => all.findIndex(other => other.key === input.key) === index)
    .slice(0,3).map(input => ({ key: input.key, question: usefulText(input.question), reason: usefulText(input.reason), photo: usefulText(input.photo) }));
  return { version: SPECIALIST_PROFILE_VERSION, fields, confidence, quality, followUps, risks: textList(data.risks) };
}
export function specialistOutputInstructions(profile: SpecialistProfile): string {
  return `SPECIALIST RECOGNITION: ${profile.recognition}\nCONDITION: ${profile.conditionRules}\nVALUATION: ${profile.valuationRules}\nLISTING: ${profile.listingRules}\nCATEGORY TAXONOMY: ${profile.taxonomy.join(', ')}\n
Add specialistAnalysis to the identification JSON. Fields must use only these keys: ${profile.fields.map(f=>f.key).join(', ')}.
Each field is {"value":"literal value","basis":"observed|user_supplied|inferred","reason":"evidence or uncertainty"}. Omit unknown values.
confidence contains identification, variant, condition, authenticity, compatibility, valuation; each number is 0..1 or null. Authenticity, compatibility and valuation must be null here because no independent authentication, manufacturer fitment verification or market-price retrieval has occurred.
quality is {"status":"suitable|limited|retake","issues":["specific visible image limitation"],"nextPhoto":"the one useful next image, or empty"}. Assess focus, glare, light, occlusion, scale, cropping and required detail. Never invent a pixel-based blur metric. Retake only for unusable evidence; incomplete but usable evidence is limited.
followUps is at most 3 {"key":"allowed field key","question":"specific uncertainty question","reason":"how answer changes identification","photo":"specific helpful view or empty"}. Ask only unresolved information, do not repeat supplied facts or irrelevant angles.
risks is a list of specific unresolved risks. All references in configuration are verification destinations, NOT sources already consulted for this item. Do not invent URLs, retrieved matches, sold prices, scarcity, fitment or safety certification.`;
}
export function mappedSpecialistSpecifics(profile: SpecialistProfile, attributes: Record<string, unknown>): Record<string,string> {
  const specifics: Record<string,string> = {};
  for (const descriptor of profile.fields) {
    if (!descriptor.specific) continue;
    const assessment = recordValue(recordValue(recordValue(attributes._specialist_analysis).fields)[descriptor.key]);
    if (assessment.basis === 'inferred' || attributes[`_inferred_${descriptor.key}`] != null) continue;
    const value = usefulText(attributes[descriptor.key],65);
    if (value) specifics[descriptor.specific] = value;
  }
  return specifics;
}
export function evaluateSpecialistSafety(nicheId: string, attributes: Record<string,unknown>): { blocked: boolean; reasons: string[] } {
  const analysis = recordValue(attributes._specialist_analysis);
  const get = (key: string) => usefulText(attributes[key] ?? recordValue(recordValue(analysis.fields)[key]).value).toLowerCase();
  const yes = (key: string) => /^(true|yes|opened|used|recalled|expired|tester)$/.test(get(key));
  const reasons: string[] = [];
  if (nicheId === 'beauty') {
    if (yes('tester') || /not for sale|tester/.test(get('product_type'))) reasons.push('Tester / not-for-sale cosmetics require exclusion.');
    if (/^(decanted|transferred|not original)$/.test(get('packaging_status'))) reasons.push('Cosmetics must remain in original packaging.');
    if (yes('opened') || get('sealed') === 'false' || get('sealed') === 'no') reasons.push('Opened beauty product: SWISH requires safety and marketplace review before drafting.');
    if (/^(recalled|expired|unsafe|counterfeit)$/.test(get('recall_status'))) reasons.push('Product safety or recall concern: do not list.');
    const expiry = get('expiry_date');
    if (/^\d{4}-\d{2}-\d{2}$/.test(expiry) && expiry < new Date().toISOString().slice(0,10)) reasons.push('Printed expiry date has passed.');
  }
  if (nicheId === 'tech' && /^(true|yes|locked|activation locked|locked to owner)$/.test(get('activation_lock'))) reasons.push('Activation/account lock must be resolved by the legitimate owner; do not recommend a purchase.');
  return { blocked: reasons.length > 0, reasons };
}
