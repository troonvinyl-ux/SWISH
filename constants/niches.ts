// SWISH Universal Niche Configuration System
//
// ONE SWISH ENGINE. MANY NICHES.
//
// A niche is a vertical market configuration — it changes terminology,
// identification rules, attributes, valuation sources, marketplace preferences,
// acquisition sources, listing templates, AI prompts, and visual identity.
//
// The underlying platform does NOT change. The same auth, inventory, eBay
// integration, valuation engine, and AI system power every niche.

import { SpecialistId } from './specialists';

export type NicheId =
  | 'coins'
  | 'trading_cards'
  | 'antiques'
  | 'bicycles'
  | 'motocross'
  | 'fossils'
  | 'clothing'
  | 'beauty'
  | 'general';

export interface NicheConfig {
  id: NicheId;
  name: string;           // Full display name: "SWISH Coins"
  shortName: string;      // Short name: "Coins"
  tagline: string;        // "Identify, value and flip coins"
  description: string;    // Longer description for onboarding
  icon: string;           // MaterialIcons icon name
  color: string;          // Primary brand colour for this niche
  accentColor: string;    // Secondary accent
  specialists: SpecialistId[];  // Relevant specialist IDs (ordered by relevance)
  defaultSpecialist: SpecialistId;
  // Terminology overrides — displayed in UI
  terms: {
    item: string;         // e.g. "Coin", "Card", "Bike"
    items: string;        // e.g. "Coins", "Cards", "Bikes"
    itemPlural: string;   // e.g. "coins", "cards", "bikes"
    scan: string;         // e.g. "Scan Coin", "Scan Card"
    identify: string;     // e.g. "Identify", "Grade", "Identify"
    condition: string;    // e.g. "Grade", "Condition", "Condition"
    catalogue: string;    // e.g. "Spink", "Beckett", "VIN"
  };
  // Quick action overrides for dashboard
  quickActions: Array<{
    icon: string;
    label: string;
    route: string;
  }>;
  // Key attributes shown in inventory cards
  keyAttributes: string[];
  // Acquisition sources relevant to this niche
  acquisitionSources: string[];
  // Typical marketplaces for this niche
  marketplaces: string[];
  // Identification tips shown in scan screen
  captureInstructions: string[];
  // Whether physical measurements are relevant
  hasMeasurements: boolean;
  measurementLabels?: { weight?: string; size?: string };
  // Version
  version: string;
}

export const NICHES: Record<NicheId, NicheConfig> = {
  coins: {
    id: 'coins',
    name: 'SWISH Coins',
    shortName: 'Coins',
    tagline: 'Identify, value and flip coins & collectibles',
    description: 'The complete platform for coin dealers, collectors, and resellers. AI identification, Numista verification, eBay valuation, and full order management.',
    icon: 'toll',
    color: '#F5C842',
    accentColor: '#D4A017',
    specialists: ['coins', 'islamic_silver', 'banknotes', 'gold', 'silver', 'jewellery_precious_metals', 'ancient_artefacts', 'curiosities_collectibles'],
    defaultSpecialist: 'coins',
    terms: {
      item: 'Coin',
      items: 'Coins',
      itemPlural: 'coins',
      scan: 'Scan Coin',
      identify: 'Identify',
      condition: 'Grade',
      catalogue: 'Catalogue',
    },
    quickActions: [
      { icon: 'qr-code-scanner', label: 'Scan Coin', route: '/(tabs)/scan' },
      { icon: 'storefront', label: 'eBay Hub', route: '/ebay-hub' },
      { icon: 'receipt-long', label: 'Orders', route: '/orders' },
      { icon: 'toll', label: 'Islamic Silver', route: '/islamic-batch' },
    ],
    keyAttributes: ['denomination', 'ruler', 'year', 'mint', 'material', 'grade'],
    acquisitionSources: ['Auctions', 'Car boot sales', 'eBay', 'Dealers', 'Estate sales', 'Metal detecting', 'Collections'],
    marketplaces: ['eBay', 'Etsy', 'Specialist auction houses'],
    captureInstructions: [
      'Photograph obverse (front) and reverse (back)',
      'Use even lighting — avoid glare and shadows',
      'Fill the frame — coin should take up most of the image',
      'Capture edge if milled or lettered',
      'Include close-up of any visible inscription or date',
    ],
    hasMeasurements: true,
    measurementLabels: { weight: 'Weight (g)', size: 'Diameter (mm)' },
    version: '1.0.0',
  },

  trading_cards: {
    id: 'trading_cards',
    name: 'SWISH Cards',
    shortName: 'Cards',
    tagline: 'Grade, value and flip trading cards',
    description: 'AI-powered card identification and grading for Pokémon, sports cards, Magic, Yu-Gi-Oh, and all trading card games.',
    icon: 'style',
    color: '#FACC15',
    accentColor: '#EAB308',
    specialists: ['pokemon_cards', 'trading_cards', 'curiosities_collectibles'],
    defaultSpecialist: 'pokemon_cards',
    terms: {
      item: 'Card',
      items: 'Cards',
      itemPlural: 'cards',
      scan: 'Scan Card',
      identify: 'Grade',
      condition: 'Grade',
      catalogue: 'Set',
    },
    quickActions: [
      { icon: 'qr-code-scanner', label: 'Scan Card', route: '/(tabs)/scan' },
      { icon: 'storefront', label: 'eBay Hub', route: '/ebay-hub' },
      { icon: 'receipt-long', label: 'Orders', route: '/orders' },
      { icon: 'inventory-2', label: 'Stock', route: '/(tabs)/inventory' },
    ],
    keyAttributes: ['card_name', 'set', 'rarity', 'condition', 'edition', 'grade'],
    acquisitionSources: ['eBay', 'Local shops', 'Booster packs', 'Collections', 'Car boot sales', 'Facebook Marketplace'],
    marketplaces: ['eBay', 'Etsy', 'TCGPlayer', 'Cardmarket'],
    captureInstructions: [
      'Photograph card face and card back',
      'Capture all four corners for grading',
      'Use flat, even lighting — no glare',
      'Include close-up of any surface scratches',
      'Photograph centering (front vs back alignment)',
    ],
    hasMeasurements: false,
    version: '1.0.0',
  },

  antiques: {
    id: 'antiques',
    name: 'SWISH Antiques',
    shortName: 'Antiques',
    tagline: 'Identify, value and sell antiques & collectibles',
    description: 'AI-powered antique identification and valuation for dealers, pickers, and collectors across ceramics, furniture, silver, jewellery, art, and decorative arts.',
    icon: 'museum',
    color: '#D97706',
    accentColor: '#B45309',
    specialists: ['antiques', 'ancient_artefacts', 'gold', 'silver', 'jewellery_precious_metals', 'books', 'curiosities_collectibles'],
    defaultSpecialist: 'antiques',
    terms: {
      item: 'Antique',
      items: 'Antiques',
      itemPlural: 'antiques',
      scan: 'Identify Item',
      identify: 'Identify',
      condition: 'Condition',
      catalogue: 'Reference',
    },
    quickActions: [
      { icon: 'qr-code-scanner', label: 'Identify Item', route: '/(tabs)/scan' },
      { icon: 'storefront', label: 'eBay Hub', route: '/ebay-hub' },
      { icon: 'receipt-long', label: 'Orders', route: '/orders' },
      { icon: 'inventory-2', label: 'Stock', route: '/(tabs)/inventory' },
    ],
    keyAttributes: ['type', 'maker', 'period', 'material', 'condition', 'marks'],
    acquisitionSources: ['Auctions', 'Estate sales', 'Car boot sales', 'Antique shops', 'House clearances', 'Online auctions', 'Charity shops'],
    marketplaces: ['eBay', 'Etsy', 'Auction houses', '1stDibs'],
    captureInstructions: [
      'Photograph main view from front',
      'Capture reverse or underside',
      'Close-up of any maker marks, hallmarks, or stamps',
      'Document any chips, cracks, or restoration',
      'Include a scale reference for size',
    ],
    hasMeasurements: true,
    measurementLabels: { weight: 'Weight', size: 'Dimensions' },
    version: '1.0.0',
  },

  bicycles: {
    id: 'bicycles',
    name: 'SWISH Bikes',
    shortName: 'Bikes',
    tagline: 'Identify, value and flip bicycles',
    description: 'The complete platform for bike flippers and dealers. AI identification of road, mountain, gravel, hybrid, BMX, and e-bikes. eBay valuation and full lifecycle management.',
    icon: 'pedal-bike',
    color: '#22C55E',
    accentColor: '#16A34A',
    specialists: ['curiosities_collectibles'],
    defaultSpecialist: 'curiosities_collectibles',
    terms: {
      item: 'Bike',
      items: 'Bikes',
      itemPlural: 'bikes',
      scan: 'Identify Bike',
      identify: 'Identify',
      condition: 'Condition',
      catalogue: 'Model',
    },
    quickActions: [
      { icon: 'qr-code-scanner', label: 'Identify Bike', route: '/(tabs)/scan' },
      { icon: 'storefront', label: 'eBay Hub', route: '/ebay-hub' },
      { icon: 'receipt-long', label: 'Orders', route: '/orders' },
      { icon: 'inventory-2', label: 'Stock', route: '/(tabs)/inventory' },
    ],
    keyAttributes: ['brand', 'model', 'frame_size', 'wheel_size', 'groupset', 'condition'],
    acquisitionSources: ['Facebook Marketplace', 'eBay', 'Gumtree', 'Auctions', 'Local listings', 'Charity shops'],
    marketplaces: ['eBay', 'Facebook Marketplace', 'Gumtree', 'BikeExchange'],
    captureInstructions: [
      'Photograph drive side (right side showing chainset)',
      'Photograph non-drive side',
      'Close-up of frame/head tube badge for brand identification',
      'Photograph groupset (gears, brakes)',
      'Capture any damage, rust, or wear',
      'Photograph serial number on bottom bracket',
    ],
    hasMeasurements: true,
    measurementLabels: { weight: 'Weight (kg)', size: 'Frame Size (cm/in)' },
    version: '1.0.0',
  },

  motocross: {
    id: 'motocross',
    name: 'SWISH MX',
    shortName: 'MX',
    tagline: 'Buy, prep and flip motocross & off-road bikes',
    description: 'The platform for motocross, enduro, trail, and supermoto bike dealers. AI identification of MX bikes, parts, and equipment. Evidence-based valuation, eBay listing, and profit tracking.',
    icon: 'two-wheeler',
    color: '#EF4444',
    accentColor: '#DC2626',
    specialists: ['motocross', 'curiosities_collectibles'],
    defaultSpecialist: 'motocross',
    terms: {
      item: 'Bike',
      items: 'Bikes',
      itemPlural: 'bikes',
      scan: 'Identify Bike',
      identify: 'Identify',
      condition: 'Condition',
      catalogue: 'VIN / Model',
    },
    quickActions: [
      { icon: 'qr-code-scanner', label: 'Identify Bike', route: '/(tabs)/scan' },
      { icon: 'calculate', label: 'MX Calculator', route: '/mx-acquisition' },
      { icon: 'storefront', label: 'eBay Hub', route: '/ebay-hub' },
      { icon: 'inventory-2', label: 'Stock', route: '/(tabs)/inventory' },
    ],
    keyAttributes: ['manufacturer', 'model', 'model_year', 'engine_size', 'stroke_type', 'running_status', 'condition'],
    acquisitionSources: ['eBay', 'Facebook Marketplace', 'Gumtree', 'MX trade shows', 'Club events', 'Dealers', 'Direct from riders', 'Race teams', 'Clearances'],
    marketplaces: ['eBay', 'Facebook Marketplace', 'Gumtree', 'Autotrader Moto'],
    captureInstructions: [
      'Full left-side profile (shows engine number plate, frame)',
      'Full right-side profile (shows exhaust, chain, sprocket)',
      'Close-up of engine showing any visible numbers',
      'VIN plate or stamped frame number if accessible',
      'Any damage, bends, cracks, or repairs',
      'Suspension condition — forks and shock',
    ],
    hasMeasurements: false,
    version: '1.0.0',
  },

  fossils: {
    id: 'fossils',
    name: 'SWISH Fossils',
    shortName: 'Fossils',
    tagline: 'Identify, value and sell fossils & minerals',
    description: 'AI-powered fossil and mineral identification for dealers, collectors, and pickers. From ammonites to shark teeth — identify species, period, and market value.',
    icon: 'yard',
    color: '#8B5CF6',
    accentColor: '#7C3AED',
    specialists: ['ancient_artefacts', 'curiosities_collectibles'],
    defaultSpecialist: 'curiosities_collectibles',
    terms: {
      item: 'Fossil',
      items: 'Fossils',
      itemPlural: 'fossils',
      scan: 'Identify Fossil',
      identify: 'Identify',
      condition: 'Condition',
      catalogue: 'Classification',
    },
    quickActions: [
      { icon: 'qr-code-scanner', label: 'Identify Fossil', route: '/(tabs)/scan' },
      { icon: 'storefront', label: 'eBay Hub', route: '/ebay-hub' },
      { icon: 'receipt-long', label: 'Orders', route: '/orders' },
      { icon: 'inventory-2', label: 'Stock', route: '/(tabs)/inventory' },
    ],
    keyAttributes: ['species', 'period', 'location', 'size', 'condition', 'completeness'],
    acquisitionSources: ['Fossil shows', 'eBay', 'Etsy', 'Rock shops', 'Digs', 'Collectors'],
    marketplaces: ['eBay', 'Etsy', 'Fossil fairs', 'Specialist dealers'],
    captureInstructions: [
      'Photograph main face of fossil',
      'Photograph matrix/rock it is embedded in',
      'Close-up of key identifying features',
      'Include a ruler or coin for scale',
      'Capture any labels or provenance documentation',
    ],
    hasMeasurements: true,
    measurementLabels: { weight: 'Weight (g)', size: 'Dimensions (mm)' },
    version: '1.0.0',
  },

  clothing: {
    id: 'clothing',
    name: 'SWISH Clothing',
    shortName: 'Clothing',
    tagline: 'Source, identify and flip vintage & designer clothing',
    description: 'The platform for clothing resellers and vintage dealers. AI identification of brands, eras, and authentication of designer items. eBay, Depop, and Vinted valuation.',
    icon: 'checkroom',
    color: '#EC4899',
    accentColor: '#DB2777',
    specialists: ['clothing', 'trainers_sneakers', 'curiosities_collectibles'],
    defaultSpecialist: 'clothing',
    terms: {
      item: 'Item',
      items: 'Items',
      itemPlural: 'items',
      scan: 'Identify Item',
      identify: 'Identify',
      condition: 'Condition',
      catalogue: 'Season',
    },
    quickActions: [
      { icon: 'qr-code-scanner', label: 'Identify Item', route: '/(tabs)/scan' },
      { icon: 'storefront', label: 'eBay Hub', route: '/ebay-hub' },
      { icon: 'receipt-long', label: 'Orders', route: '/orders' },
      { icon: 'inventory-2', label: 'Stock', route: '/(tabs)/inventory' },
    ],
    keyAttributes: ['brand', 'type', 'size', 'colour', 'material', 'era', 'condition'],
    acquisitionSources: ['Charity shops', 'Car boot sales', 'eBay', 'Auctions', 'House clearances', 'Fashion markets', 'Wholesale'],
    marketplaces: ['eBay', 'Depop', 'Vinted', 'Etsy', 'Facebook Marketplace'],
    captureInstructions: [
      'Photograph garment front and back',
      'Close-up of all brand/care labels',
      'Document any stains, holes, or wear',
      'Photograph key features (logos, stitching, hardware)',
      'Flat lay on neutral background for best results',
    ],
    hasMeasurements: true,
    measurementLabels: { weight: 'Weight', size: 'Measurements (chest/length etc)' },
    version: '1.0.0',
  },

  beauty: {
    id: 'beauty',
    name: 'SWISH Beauty',
    shortName: 'Beauty',
    tagline: 'Source and flip beauty products at scale',
    description: 'The platform for beauty product resellers. AI identification of brands, formulas, and authenticity checks. eBay and Amazon valuation with expiry date tracking.',
    icon: 'spa',
    color: '#F472B6',
    accentColor: '#E11D48',
    specialists: ['curiosities_collectibles'],
    defaultSpecialist: 'curiosities_collectibles',
    terms: {
      item: 'Product',
      items: 'Products',
      itemPlural: 'products',
      scan: 'Identify Product',
      identify: 'Identify',
      condition: 'Condition',
      catalogue: 'Brand',
    },
    quickActions: [
      { icon: 'qr-code-scanner', label: 'Identify Product', route: '/(tabs)/scan' },
      { icon: 'storefront', label: 'eBay Hub', route: '/ebay-hub' },
      { icon: 'receipt-long', label: 'Orders', route: '/orders' },
      { icon: 'inventory-2', label: 'Stock', route: '/(tabs)/inventory' },
    ],
    keyAttributes: ['brand', 'product_name', 'size', 'condition', 'expiry', 'authentic'],
    acquisitionSources: ['Wholesale', 'Clearance sales', 'eBay lots', 'Amazon returns', 'Trade shows'],
    marketplaces: ['eBay', 'Amazon', 'Etsy', 'Facebook Marketplace'],
    captureInstructions: [
      'Photograph product front (label clearly visible)',
      'Photograph back label (ingredients, batch code)',
      'Close-up of expiry/best before date',
      'Photograph seal/packaging condition',
      'Any authenticity markers (holograms, QR codes)',
    ],
    hasMeasurements: false,
    version: '1.0.0',
  },

  general: {
    id: 'general',
    name: 'SWISH',
    shortName: 'General',
    tagline: 'Buy, identify, value and sell anything',
    description: 'The universal SWISH platform. Identify and value any physical product — coins, cards, bikes, antiques, clothing, electronics, and more.',
    icon: 'storefront',
    color: '#6366F1',
    accentColor: '#4F46E5',
    specialists: ['curiosities_collectibles', 'coins', 'pokemon_cards', 'trading_cards', 'antiques', 'clothing', 'gold', 'silver'],
    defaultSpecialist: 'curiosities_collectibles',
    terms: {
      item: 'Item',
      items: 'Items',
      itemPlural: 'items',
      scan: 'Scan Item',
      identify: 'Identify',
      condition: 'Condition',
      catalogue: 'Reference',
    },
    quickActions: [
      { icon: 'qr-code-scanner', label: 'Scan Item', route: '/(tabs)/scan' },
      { icon: 'storefront', label: 'eBay Hub', route: '/ebay-hub' },
      { icon: 'receipt-long', label: 'Orders', route: '/orders' },
      { icon: 'local-shipping', label: 'Dispatch', route: '/dispatch' },
    ],
    keyAttributes: ['type', 'brand', 'condition', 'description'],
    acquisitionSources: ['eBay', 'Car boot sales', 'Auctions', 'Facebook Marketplace', 'Charity shops', 'House clearances'],
    marketplaces: ['eBay', 'Etsy', 'Amazon', 'Facebook Marketplace'],
    captureInstructions: [
      'Photograph front and back',
      'Capture any labels, marks, or stamps',
      'Document any damage or wear',
      'Include a scale reference',
    ],
    hasMeasurements: false,
    version: '1.0.0',
  },
};

export const NICHE_LIST = Object.values(NICHES);

// Get niches a user has enabled (defaults to general if none set)
export function getActiveNiches(enabledIds: NicheId[]): NicheConfig[] {
  if (!enabledIds || enabledIds.length === 0) return [NICHES.general];
  return enabledIds.map(id => NICHES[id]).filter(Boolean);
}

// Get the primary/first niche
export function getPrimaryNiche(enabledIds: NicheId[]): NicheConfig {
  if (!enabledIds || enabledIds.length === 0) return NICHES.general;
  return NICHES[enabledIds[0]] ?? NICHES.general;
}
