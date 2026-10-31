// SWISH Specialist Intelligence Framework
// Each specialist is a modular configuration — NOT hard-coded application logic.
// New specialists can be added here without modifying core platform code.

export type SpecialistId =
  | 'coins'
  | 'islamic_silver'
  | 'banknotes'
  | 'pokemon_cards'
  | 'trading_cards'
  | 'stamps'
  | 'retro_games'
  | 'retro_consoles'
  | 'antiques'
  | 'ancient_artefacts'
  | 'clothing'
  | 'trainers_sneakers'
  | 'vinyl_records'
  | 'books'
  | 'gold'
  | 'silver'
  | 'jewellery_precious_metals'
  | 'cryptocurrency'
  | 'motocross'
  | 'bicycles'
  | 'curiosities_collectibles'
  | 'surplus_trader'
  | 'fossils'
  | 'beauty'
  | 'tech';

export interface CaptureRequirement {
  id: string;
  label: string;
  description: string;
  required: boolean;
  hint?: string;
}

export interface SpecialistCapability {
  identify: boolean;
  classify: boolean;
  research: boolean;
  authenticate: boolean;
  assessCondition: boolean;
  grade: boolean;
  value: boolean;
  predictDemand: boolean;
  recommendDisposition: boolean;
  generateListing: boolean;
  validateListing: boolean;
  detectRisk: boolean;
  suggestAcquisitionStrategy: boolean;
  preciousMetalAnalysis: boolean;
  cryptoAnalysis: boolean;
}

export interface SpecialistConfig {
  id: SpecialistId;
  name: string;
  shortName: string;
  description: string;
  icon: string; // @expo/vector-icons name
  iconFamily: 'MaterialIcons' | 'MaterialCommunityIcons' | 'Ionicons' | 'FontAwesome5';
  color: string;
  category: 'collectibles' | 'precious_metals' | 'digital_assets' | 'physical_goods' | 'media';
  captureRequirements: CaptureRequirement[];
  capabilities: Partial<SpecialistCapability>;
  keyAttributes: string[];
  conditionScale?: string; // e.g. 'Sheldon' for coins, 'PSA' for cards
  valuationInputs: string[];
  riskFactors: string[];
  typicalMarketplaces: string[];
  autoDetectKeywords: string[]; // Used for classification hints
  version: string;
}

export const SPECIALISTS: Record<SpecialistId, SpecialistConfig> = {
  coins: {
    id: 'coins',
    name: 'Coins & Numismatics',
    shortName: 'Coins',
    description: 'Identification, grading, and valuation of coins, medals, and tokens.',
    icon: 'toll',
    iconFamily: 'MaterialIcons',
    color: '#F5C842',
    category: 'collectibles',
    captureRequirements: [
      { id: 'obverse', label: 'Obverse (Front)', description: 'Head/front side of the coin', required: true },
      { id: 'reverse', label: 'Reverse (Back)', description: 'Tail/back side of the coin', required: true },
      { id: 'edge', label: 'Edge', description: 'Edge/rim of the coin', required: false, hint: 'Useful for milled/lettered edges' },
      { id: 'detail', label: 'Detail Shot', description: 'Close-up of key features or damage', required: false },
    ],
    capabilities: {
      identify: true, classify: true, research: true, authenticate: true,
      assessCondition: true, grade: true, value: true, predictDemand: true,
      recommendDisposition: true, generateListing: true, validateListing: true,
      detectRisk: true, suggestAcquisitionStrategy: true, preciousMetalAnalysis: true,
    },
    keyAttributes: ['country', 'year', 'denomination', 'mint', 'composition', 'diameter', 'weight', 'grade', 'pcgs_number', 'km_number'],
    conditionScale: 'Sheldon (P1–MS70)',
    valuationInputs: ['grade', 'rarity', 'mint_mark', 'year', 'composition', 'demand', 'population_report'],
    riskFactors: ['counterfeit', 'cleaned', 'altered_date', 'filled_mint_mark', 'artificial_toning'],
    typicalMarketplaces: ['ebay', 'etsy'],
    autoDetectKeywords: ['coin', 'obverse', 'reverse', 'sovereign', 'crown', 'penny', 'shilling', 'numismatic', 'mint', 'medal'],
    version: '1.0.0',
  },

  banknotes: {
    id: 'banknotes',
    name: 'Banknotes & Paper Money',
    shortName: 'Banknotes',
    description: 'Authentication and grading of banknotes, obsolete currency, and paper money.',
    icon: 'money',
    iconFamily: 'MaterialIcons',
    color: '#22C55E',
    category: 'collectibles',
    captureRequirements: [
      { id: 'front', label: 'Front', description: 'Front face of the note', required: true },
      { id: 'back', label: 'Back', description: 'Back face of the note', required: true },
      { id: 'serial', label: 'Serial Number', description: 'Close-up of serial number', required: false },
      { id: 'security', label: 'Security Features', description: 'Watermark, thread, hologram', required: false },
    ],
    capabilities: {
      identify: true, classify: true, research: true, authenticate: true,
      assessCondition: true, grade: true, value: true, predictDemand: true,
      recommendDisposition: true, generateListing: true, validateListing: true,
      detectRisk: true,
    },
    keyAttributes: ['country', 'denomination', 'year', 'series', 'signature', 'prefix', 'condition', 'pmg_grade'],
    conditionScale: 'PMG (1–70)',
    valuationInputs: ['grade', 'serial_number_type', 'signatures', 'condition', 'rarity'],
    riskFactors: ['counterfeit', 'repaired', 'pressed', 'washed', 'missing_serial'],
    typicalMarketplaces: ['ebay', 'etsy'],
    autoDetectKeywords: ['banknote', 'note', 'pound', 'dollar', 'currency', 'paper money', 'serial number'],
    version: '1.0.0',
  },

  pokemon_cards: {
    id: 'pokemon_cards',
    name: 'Pokémon Cards',
    shortName: 'Pokémon',
    description: 'Identification, grading, and valuation of Pokémon Trading Card Game cards.',
    icon: 'style',
    iconFamily: 'MaterialIcons',
    color: '#FACC15',
    category: 'collectibles',
    captureRequirements: [
      { id: 'front', label: 'Card Front', description: 'Full card face', required: true },
      { id: 'back', label: 'Card Back', description: 'Back of card', required: true },
      { id: 'corners', label: 'Corners', description: 'All four corners', required: false, hint: 'Critical for grading' },
      { id: 'surface', label: 'Surface', description: 'Surface scratches/wear', required: false },
      { id: 'centering', label: 'Centering', description: 'Front and back alignment', required: false },
    ],
    capabilities: {
      identify: true, classify: true, research: true, authenticate: true,
      assessCondition: true, grade: true, value: true, predictDemand: true,
      recommendDisposition: true, generateListing: true, validateListing: true,
      detectRisk: true, suggestAcquisitionStrategy: true,
    },
    keyAttributes: ['name', 'set', 'set_number', 'rarity', 'edition', 'language', 'psa_grade', 'bgs_grade', 'holo_type'],
    conditionScale: 'PSA (1–10) / BGS (1–10)',
    valuationInputs: ['card_name', 'set', 'rarity', 'edition', 'grade', 'language', 'pop_report', 'recent_sales'],
    riskFactors: ['counterfeit', 'resealed_pack', 'trimmed', 'altered', 'fake_grading_case'],
    typicalMarketplaces: ['ebay', 'etsy'],
    autoDetectKeywords: ['pokemon', 'pikachu', 'charizard', 'holographic', 'psa', 'bgs', 'tcg', 'energy card'],
    version: '1.0.0',
  },

  trading_cards: {
    id: 'trading_cards',
    name: 'Trading Cards (General)',
    shortName: 'Trading Cards',
    description: 'Sports cards, non-sport cards, and other trading card sets.',
    icon: 'credit-card',
    iconFamily: 'MaterialIcons',
    color: '#4F8EF7',
    category: 'collectibles',
    captureRequirements: [
      { id: 'front', label: 'Card Front', description: 'Full card face', required: true },
      { id: 'back', label: 'Card Back', description: 'Back of card', required: true },
      { id: 'corners', label: 'Corners', description: 'Corner wear detail', required: false },
      { id: 'surface', label: 'Surface', description: 'Surface condition', required: false },
    ],
    capabilities: {
      identify: true, classify: true, research: true, authenticate: true,
      assessCondition: true, grade: true, value: true, predictDemand: true,
      recommendDisposition: true, generateListing: true, detectRisk: true,
    },
    keyAttributes: ['player_subject', 'year', 'brand', 'set', 'card_number', 'parallel', 'autograph', 'relic', 'grade'],
    conditionScale: 'PSA (1–10)',
    valuationInputs: ['player', 'year', 'brand', 'condition', 'rookie_card', 'autograph', 'serial_number'],
    riskFactors: ['counterfeit', 'trimmed', 'altered', 'fake_autograph'],
    typicalMarketplaces: ['ebay'],
    autoDetectKeywords: ['trading card', 'sports card', 'football card', 'topps', 'panini', 'upper deck'],
    version: '1.0.0',
  },

  stamps: {
    id: 'stamps',
    name: 'Stamps & Philately',
    shortName: 'Stamps',
    description: 'Identification, grading and valuation of postage stamps and philatelic material.',
    icon: 'local-post-office',
    iconFamily: 'MaterialIcons',
    color: '#EC4899',
    category: 'collectibles',
    captureRequirements: [
      { id: 'front', label: 'Front', description: 'Face of stamp', required: true },
      { id: 'reverse', label: 'Reverse', description: 'Gum/back condition', required: false },
      { id: 'perforations', label: 'Perforations', description: 'Perforation detail', required: false },
      { id: 'watermark', label: 'Watermark', description: 'Watermark if applicable', required: false },
      { id: 'cancellation', label: 'Cancellation', description: 'Postmark/cancellation detail', required: false },
    ],
    capabilities: {
      identify: true, classify: true, research: true, authenticate: true,
      assessCondition: true, grade: true, value: true, predictDemand: true,
      recommendDisposition: true, generateListing: true, detectRisk: true,
    },
    keyAttributes: ['country', 'year', 'sg_number', 'scott_number', 'perforation', 'watermark', 'gum', 'condition', 'colour'],
    conditionScale: 'Stanley Gibbons Standard',
    valuationInputs: ['sg_number', 'condition', 'gum', 'perforation', 'colour_variety', 'provenance'],
    riskFactors: ['forgery', 'reperfed', 'regummed', 'repaired', 'faded', 'thin'],
    typicalMarketplaces: ['ebay', 'etsy'],
    autoDetectKeywords: ['stamp', 'postage', 'philately', 'perforation', 'watermark', 'sg', 'used', 'mint'],
    version: '1.0.0',
  },

  retro_games: {
    id: 'retro_games',
    name: 'Retro Games',
    shortName: 'Games',
    description: 'Video games for classic and retro platforms.',
    icon: 'sports-esports',
    iconFamily: 'MaterialIcons',
    color: '#7C5CFC',
    category: 'collectibles',
    captureRequirements: [
      { id: 'front', label: 'Front Cover / Cart', description: 'Front of game or cartridge', required: true },
      { id: 'back', label: 'Back Cover', description: 'Back of case/sleeve', required: false },
      { id: 'label', label: 'Cartridge Label', description: 'Label on cartridge if applicable', required: false },
      { id: 'disc', label: 'Disc', description: 'Disc condition', required: false },
      { id: 'contents', label: 'Contents', description: 'Manual, inserts, extras', required: false },
    ],
    capabilities: {
      identify: true, classify: true, research: true,
      assessCondition: true, value: true, predictDemand: true,
      recommendDisposition: true, generateListing: true, detectRisk: true,
    },
    keyAttributes: ['title', 'platform', 'region', 'publisher', 'year', 'version', 'completeness', 'condition', 'vga_grade'],
    conditionScale: 'CIB / Loose / Sealed',
    valuationInputs: ['title', 'platform', 'completeness', 'condition', 'region', 'print_run'],
    riskFactors: ['reproduction', 'counterfeit', 'damaged_pcb', 'replaced_label'],
    typicalMarketplaces: ['ebay'],
    autoDetectKeywords: ['game', 'cartridge', 'nintendo', 'sega', 'playstation', 'gameboy', 'n64', 'nes', 'snes'],
    version: '1.0.0',
  },

  retro_consoles: {
    id: 'retro_consoles',
    name: 'Retro Consoles',
    shortName: 'Consoles',
    description: 'Classic gaming consoles, handhelds, and accessories.',
    icon: 'videogame-asset',
    iconFamily: 'MaterialIcons',
    color: '#06B6D4',
    category: 'collectibles',
    captureRequirements: [
      { id: 'front', label: 'Console Front', description: 'Main front view', required: true },
      { id: 'back', label: 'Console Back', description: 'Ports and rear', required: false },
      { id: 'serial', label: 'Serial Number', description: 'Serial/model label', required: false },
      { id: 'accessories', label: 'Accessories', description: 'Controllers, leads, box', required: false },
    ],
    capabilities: {
      identify: true, classify: true, research: true,
      assessCondition: true, value: true, predictDemand: true,
      recommendDisposition: true, generateListing: true, detectRisk: true,
    },
    keyAttributes: ['make', 'model', 'region', 'revision', 'accessories', 'functionality', 'condition'],
    conditionScale: 'Working / Untested / Faulty',
    valuationInputs: ['model', 'revision', 'functionality', 'completeness', 'condition'],
    riskFactors: ['non_working', 'clone_console', 'incomplete'],
    typicalMarketplaces: ['ebay', 'gumtree'],
    autoDetectKeywords: ['console', 'playstation', 'xbox', 'nintendo', 'atari', 'sega megadrive', 'dreamcast'],
    version: '1.0.0',
  },

  antiques: {
    id: 'antiques',
    name: 'Antiques & Collectibles',
    shortName: 'Antiques',
    description: 'General antiques, period furniture, ceramics, glass, silver, and decorative arts.',
    icon: 'museum',
    iconFamily: 'MaterialIcons',
    color: '#D97706',
    category: 'collectibles',
    captureRequirements: [
      { id: 'front', label: 'Main View', description: 'Primary view of the item', required: true },
      { id: 'back', label: 'Reverse', description: 'Back or underside', required: false },
      { id: 'marks', label: 'Marks/Stamps', description: 'Maker marks, hallmarks, stamps', required: false },
      { id: 'damage', label: 'Damage/Wear', description: 'Any chips, cracks, restoration', required: false },
      { id: 'detail', label: 'Detail', description: 'Close-up of key features', required: false },
    ],
    capabilities: {
      identify: true, classify: true, research: true, authenticate: true,
      assessCondition: true, value: true, predictDemand: true,
      recommendDisposition: true, generateListing: true, detectRisk: true,
      suggestAcquisitionStrategy: true,
    },
    keyAttributes: ['object_type', 'maker', 'period', 'pattern', 'material', 'marks', 'dimensions', 'condition', 'restoration', 'provenance'],
    valuationInputs: ['maker', 'period', 'rarity', 'condition', 'provenance', 'current_demand'],
    riskFactors: ['reproduction', 'restored', 'married_piece', 'false_attribution', 'export_restriction'],
    typicalMarketplaces: ['ebay', 'etsy'],
    autoDetectKeywords: ['antique', 'vintage', 'victorian', 'edwardian', 'georgian', 'ceramic', 'porcelain', 'bronze'],
    version: '1.0.0',
  },

  ancient_artefacts: {
    id: 'ancient_artefacts',
    name: 'Ancient Artefacts',
    shortName: 'Artefacts',
    description: 'Archaeological items, ancient coins, antiquities — with provenance and legal compliance focus.',
    icon: 'account-balance',
    iconFamily: 'MaterialIcons',
    color: '#92400E',
    category: 'collectibles',
    captureRequirements: [
      { id: 'front', label: 'Main View', description: 'Primary view', required: true },
      { id: 'back', label: 'Reverse', description: 'Reverse side', required: true },
      { id: 'detail', label: 'Detail', description: 'Key features', required: false },
      { id: 'scale', label: 'Scale Reference', description: 'Item with scale/ruler', required: false },
    ],
    capabilities: {
      identify: true, classify: true, research: true, authenticate: true,
      assessCondition: true, value: true, detectRisk: true,
      recommendDisposition: true,
    },
    keyAttributes: ['culture', 'period', 'type', 'material', 'dimensions', 'weight', 'provenance', 'export_licence'],
    valuationInputs: ['culture', 'period', 'type', 'condition', 'provenance', 'legal_status'],
    riskFactors: ['no_provenance', 'export_restriction', 'cultural_property_law', 'forgery', 'looting_concern'],
    typicalMarketplaces: ['ebay', 'etsy'],
    autoDetectKeywords: ['ancient', 'roman', 'greek', 'egyptian', 'medieval', 'artefact', 'relic', 'archaeological'],
    version: '1.0.0',
  },

  clothing: {
    id: 'clothing',
    name: 'Clothing & Fashion',
    shortName: 'Clothing',
    description: 'Vintage, designer, and general clothing identification, authentication, condition assessment, and valuation for resale.',
    icon: 'checkroom',
    iconFamily: 'MaterialIcons',
    color: '#EC4899',
    category: 'physical_goods',
    captureRequirements: [
      { id: 'front', label: 'Front', description: 'Front of garment on flat surface or worn', required: true, hint: 'Flat lay on neutral background gives best results' },
      { id: 'back', label: 'Back', description: 'Back of garment showing full construction', required: true },
      { id: 'brand_label', label: 'Brand Label', description: 'Main brand label — usually neck or waistband', required: true, hint: 'Critical for authentication — photograph clearly, without glare' },
      { id: 'care_label', label: 'Care / Size Label', description: 'Care instructions and composition label', required: true, hint: 'Contains fibre composition, country of manufacture, care instructions' },
      { id: 'damage', label: 'Damage / Wear', description: 'Any stains, holes, fading, pilling, repairs', required: false, hint: 'Photograph all damage — undisclosed damage causes returns' },
      { id: 'detail', label: 'Key Detail / Logo', description: 'Distinctive logo, stitching, hardware, pattern detail', required: false, hint: 'Authentication markers — stitching quality, zip hardware, logo proportions' },
    ],
    capabilities: {
      identify: true, classify: true, research: true, authenticate: true,
      assessCondition: true, value: true, predictDemand: true,
      recommendDisposition: true, generateListing: true, validateListing: true, detectRisk: true,
    },
    keyAttributes: [
      'brand', 'garment_type', 'gender_category', 'size', 'colour', 'material_composition',
      'era_decade', 'style', 'model_name', 'country_manufacture', 'condition',
      'measurements_chest', 'measurements_length', 'measurements_waist',
      'is_vintage', 'is_deadstock', 'is_designer', 'authenticity_verified',
      'damage_type', 'damage_location',
    ],
    valuationInputs: [
      'brand', 'garment_type', 'condition', 'size', 'era', 'current_trend',
      'authenticity', 'rarity', 'colourway_demand', 'completeness',
    ],
    riskFactors: [
      'counterfeit', 'undisclosed_damage', 'incorrect_sizing', 'fading',
      'vintage_fragility', 'shrinkage', 'odour', 'pilling', 'missing_hardware',
      'incorrect_era_attribution', 'fake_label',
    ],
    typicalMarketplaces: ['ebay', 'depop', 'vinted', 'etsy', 'facebook_marketplace'],
    autoDetectKeywords: [
      'clothing', 'jacket', 'shirt', 'dress', 'vintage', 'designer', 'levi',
      'nike', 'adidas', 'supreme', 'stone island', 'ralph lauren', 'tommy hilfiger',
      'burberry', 'north face', 'carhartt', 'champion', 'kappa', 'umbro',
      'deadstock', 'nos', 'y2k', 'retro', 'sportswear', 'workwear',
    ],
    version: '2.0.0',
  },

  trainers_sneakers: {
    id: 'trainers_sneakers',
    name: 'Trainers & Sneakers',
    shortName: 'Trainers',
    description: 'Deadstock, limited edition, and sought-after trainers and sneakers.',
    icon: 'directions-run',
    iconFamily: 'MaterialIcons',
    color: '#F97316',
    category: 'physical_goods',
    captureRequirements: [
      { id: 'pair', label: 'Pair', description: 'Both shoes together', required: true },
      { id: 'side_left', label: 'Left Side', description: 'Left shoe side view', required: true },
      { id: 'side_right', label: 'Right Side', description: 'Right shoe side view', required: true },
      { id: 'soles', label: 'Soles', description: 'Outsole condition', required: true },
      { id: 'labels', label: 'Size Labels', description: 'Interior size labels', required: true },
      { id: 'box', label: 'Box', description: 'Box if present', required: false },
      { id: 'detail', label: 'Detail/Damage', description: 'Key features or wear', required: false },
    ],
    capabilities: {
      identify: true, classify: true, research: true, authenticate: true,
      assessCondition: true, value: true, predictDemand: true,
      recommendDisposition: true, generateListing: true, validateListing: true, detectRisk: true,
    },
    keyAttributes: ['brand', 'model', 'colourway', 'size', 'condition', 'box_included', 'year', 'sku'],
    valuationInputs: ['model', 'size', 'condition', 'box_included', 'current_market', 'release_date'],
    riskFactors: ['counterfeit', 'worn_soles', 'yellowing', 'glue_separation', 'wrong_size_label'],
    typicalMarketplaces: ['ebay', 'etsy'],
    autoDetectKeywords: ['trainers', 'sneakers', 'jordan', 'nike', 'adidas', 'yeezy', 'deadstock', 'kicks'],
    version: '1.0.0',
  },

  vinyl_records: {
    id: 'vinyl_records',
    name: 'Vinyl Records',
    shortName: 'Vinyl',
    description: 'LP, 12", 7" singles, and rare vinyl for collectors and audiophiles.',
    icon: 'album',
    iconFamily: 'MaterialIcons',
    color: '#6366F1',
    category: 'media',
    captureRequirements: [
      { id: 'front_sleeve', label: 'Front Sleeve', description: 'Front of sleeve/cover', required: true },
      { id: 'back_sleeve', label: 'Back Sleeve', description: 'Back of sleeve', required: false },
      { id: 'label_a', label: 'Label (Side A)', description: 'Record label side A', required: true },
      { id: 'label_b', label: 'Label (Side B)', description: 'Record label side B', required: false },
      { id: 'matrix', label: 'Matrix/Runout', description: 'Runout groove inscription', required: false, hint: 'Determines pressing' },
      { id: 'vinyl_condition', label: 'Vinyl Surface', description: 'Record surface condition', required: false },
    ],
    capabilities: {
      identify: true, classify: true, research: true,
      assessCondition: true, value: true, predictDemand: true,
      recommendDisposition: true, generateListing: true, detectRisk: true,
    },
    keyAttributes: ['artist', 'title', 'label', 'catalogue_number', 'pressing', 'year', 'country', 'matrix', 'grading_sleeve', 'grading_vinyl'],
    conditionScale: 'Goldmine / Discogs (M–G)',
    valuationInputs: ['pressing', 'matrix', 'condition', 'rarity', 'current_demand'],
    riskFactors: ['bootleg', 'scratches', 'warping', 'sleeve_damage', 'replaced_sleeve'],
    typicalMarketplaces: ['ebay', 'etsy'],
    autoDetectKeywords: ['vinyl', 'record', 'lp', 'single', 'album', 'pressing', 'discogs', 'matrix'],
    version: '1.0.0',
  },

  books: {
    id: 'books',
    name: 'Books & Manuscripts',
    shortName: 'Books',
    description: 'Rare books, first editions, signed copies, and manuscripts.',
    icon: 'menu-book',
    iconFamily: 'MaterialIcons',
    color: '#84CC16',
    category: 'media',
    captureRequirements: [
      { id: 'front', label: 'Front Cover', description: 'Front of book or jacket', required: true },
      { id: 'spine', label: 'Spine', description: 'Book spine', required: true },
      { id: 'title_page', label: 'Title Page', description: 'Title page', required: true },
      { id: 'copyright', label: 'Copyright Page', description: 'Copyright/imprint page', required: true },
      { id: 'dust_jacket', label: 'Dust Jacket', description: 'Dust jacket condition', required: false },
      { id: 'inscription', label: 'Inscription', description: 'Any inscription or signature', required: false },
      { id: 'damage', label: 'Condition Notes', description: 'Significant wear or damage', required: false },
    ],
    capabilities: {
      identify: true, classify: true, research: true, authenticate: true,
      assessCondition: true, value: true, predictDemand: true,
      recommendDisposition: true, generateListing: true, detectRisk: true,
    },
    keyAttributes: ['author', 'title', 'publisher', 'year', 'edition', 'printing', 'isbn', 'condition', 'signed', 'dust_jacket'],
    valuationInputs: ['edition', 'printing', 'condition', 'dust_jacket', 'signed', 'rarity'],
    riskFactors: ['forged_signature', 'later_edition', 'ex_library', 'water_damage', 'foxing'],
    typicalMarketplaces: ['ebay', 'etsy', 'amazon'],
    autoDetectKeywords: ['book', 'first edition', 'signed', 'manuscript', 'hardback', 'paperback', 'isbn'],
    version: '1.0.0',
  },

  gold: {
    id: 'gold',
    name: 'Gold & Bullion',
    shortName: 'Gold',
    description: 'Gold coins, bars, scrap, and jewellery — melt value and collectible analysis.',
    icon: 'monetization-on',
    iconFamily: 'MaterialIcons',
    color: '#F5C842',
    category: 'precious_metals',
    captureRequirements: [
      { id: 'front', label: 'Front', description: 'Main face', required: true },
      { id: 'back', label: 'Back', description: 'Reverse', required: true },
      { id: 'hallmarks', label: 'Hallmarks', description: 'Hallmark stamps', required: true, hint: 'Critical for fineness determination' },
      { id: 'weight_reading', label: 'Weight', description: 'Scale reading if possible', required: false },
    ],
    capabilities: {
      identify: true, classify: true, research: true, authenticate: true,
      assessCondition: true, value: true, predictDemand: true,
      recommendDisposition: true, generateListing: true, detectRisk: true,
      preciousMetalAnalysis: true,
    },
    keyAttributes: ['type', 'fineness', 'weight_grams', 'hallmarks', 'mint', 'year', 'spot_price', 'melt_value', 'collectible_premium'],
    valuationInputs: ['weight', 'fineness', 'spot_price', 'collectible_premium', 'condition'],
    riskFactors: ['plated', 'tungsten_filled', 'wrong_hallmark', 'counterfeit_coin'],
    typicalMarketplaces: ['ebay'],
    autoDetectKeywords: ['gold', 'sovereign', 'bullion', 'hallmark', '9ct', '18ct', '22ct', '24ct', 'karat'],
    version: '1.0.0',
  },

  silver: {
    id: 'silver',
    name: 'Silver & Silverware',
    shortName: 'Silver',
    description: 'Silver coins, flatware, hollowware, and bullion.',
    icon: 'brightness-high',
    iconFamily: 'MaterialIcons',
    color: '#C0C0C0',
    category: 'precious_metals',
    captureRequirements: [
      { id: 'front', label: 'Front', description: 'Main view', required: true },
      { id: 'back', label: 'Back', description: 'Reverse', required: true },
      { id: 'hallmarks', label: 'Hallmarks', description: 'Hallmark stamps', required: true },
      { id: 'weight_reading', label: 'Weight', description: 'Scale reading', required: false },
    ],
    capabilities: {
      identify: true, classify: true, research: true, authenticate: true,
      assessCondition: true, value: true, predictDemand: true,
      recommendDisposition: true, generateListing: true, detectRisk: true,
      preciousMetalAnalysis: true,
    },
    keyAttributes: ['type', 'fineness', 'weight_grams', 'hallmarks', 'maker', 'year', 'spot_price', 'melt_value'],
    valuationInputs: ['weight', 'fineness', 'spot_price', 'maker', 'condition', 'collectible_premium'],
    riskFactors: ['silver_plate_not_solid', 'wrong_hallmark', 'reproduction_marks'],
    typicalMarketplaces: ['ebay', 'etsy'],
    autoDetectKeywords: ['silver', 'sterling', 'hallmark', 'silverware', 'flatware', '925', 'britannia'],
    version: '1.0.0',
  },

  jewellery_precious_metals: {
    id: 'jewellery_precious_metals',
    name: 'Jewellery & Precious Metals',
    shortName: 'Jewellery',
    description: 'Fine jewellery, gemstones, and mixed precious-metal items.',
    icon: 'diamond',
    iconFamily: 'MaterialIcons',
    color: '#A78BFA',
    category: 'precious_metals',
    captureRequirements: [
      { id: 'main', label: 'Main View', description: 'Primary view', required: true },
      { id: 'detail', label: 'Detail', description: 'Stones, settings, details', required: true },
      { id: 'hallmarks', label: 'Hallmarks', description: 'Any stamps or marks', required: false },
      { id: 'clasp', label: 'Clasp/Fitting', description: 'Clasp or fitting detail', required: false },
    ],
    capabilities: {
      identify: true, classify: true, research: true, authenticate: true,
      assessCondition: true, value: true, predictDemand: true,
      recommendDisposition: true, generateListing: true, detectRisk: true,
      preciousMetalAnalysis: true,
    },
    keyAttributes: ['type', 'metal', 'fineness', 'weight_grams', 'stones', 'stone_type', 'maker', 'era', 'condition', 'melt_value', 'retail_value'],
    valuationInputs: ['metal', 'fineness', 'weight', 'stones', 'maker', 'era', 'condition', 'spot_price'],
    riskFactors: ['plated', 'glass_stones', 'synthetic_gems', 'damaged_settings', 'missing_stones'],
    typicalMarketplaces: ['ebay', 'etsy'],
    autoDetectKeywords: ['jewellery', 'necklace', 'ring', 'bracelet', 'earrings', 'diamond', 'sapphire', 'ruby', 'gold', 'silver'],
    version: '1.0.0',
  },

  cryptocurrency: {
    id: 'cryptocurrency',
    name: 'Cryptocurrency & Digital Assets',
    shortName: 'Crypto',
    description: 'Cryptocurrency portfolio analysis, market intelligence, and controlled trading.',
    icon: 'currency-bitcoin',
    iconFamily: 'MaterialIcons',
    color: '#F97316',
    category: 'digital_assets',
    captureRequirements: [], // Digital asset — no physical capture
    capabilities: {
      identify: true, classify: true, research: true,
      value: true, predictDemand: true,
      recommendDisposition: true, detectRisk: true,
      suggestAcquisitionStrategy: true, cryptoAnalysis: true,
    },
    keyAttributes: ['symbol', 'name', 'network', 'amount', 'entry_price', 'current_price', 'exchange', 'wallet_type'],
    valuationInputs: ['market_price', 'volume', 'volatility', 'liquidity', 'spread', 'transaction_costs'],
    riskFactors: ['high_volatility', 'low_liquidity', 'regulatory_risk', 'smart_contract_risk', 'exchange_risk', 'custody_risk'],
    typicalMarketplaces: [],
    autoDetectKeywords: ['bitcoin', 'ethereum', 'crypto', 'btc', 'eth', 'blockchain', 'defi', 'nft'],
    version: '1.0.0',
  },

  islamic_silver: {
    id: 'islamic_silver',
    name: 'Islamic & Indian Silver Coins',
    shortName: 'Islamic Silver',
    description: 'Evidence-based identification of Islamic, Indo-Islamic, Timurid, Mughal, Sultanate, Indo-Greek and related hammered/fractional silver — with specialist countermark analysis.',
    icon: 'toll',
    iconFamily: 'MaterialIcons',
    color: '#A8B5C0',
    category: 'collectibles',
    captureRequirements: [
      { id: 'obverse', label: 'Obverse', description: 'Full obverse face — fill the frame', required: true, hint: 'Even lighting, no glare. Inscriptions must be legible.' },
      { id: 'reverse', label: 'Reverse', description: 'Full reverse face', required: true },
      { id: 'countermark', label: 'Countermark Close-up', description: 'Close macro of any countermark, punch or secondary stamp', required: false, hint: 'Critical for countermarked coins — capture as close as possible' },
      { id: 'edge', label: 'Edge / Flan Shape', description: 'Edge or side showing flan shape and thickness', required: false, hint: 'Helps with denomination and standard identification' },
      { id: 'scale', label: 'Scale Reference', description: 'Coin beside a ruler or known object for scale', required: false },
    ],
    capabilities: {
      identify: true, classify: true, research: true, authenticate: true,
      assessCondition: true, grade: true, value: true, predictDemand: true,
      recommendDisposition: true, generateListing: true, validateListing: true,
      detectRisk: true, preciousMetalAnalysis: true,
    },
    keyAttributes: [
      'dynasty', 'ruler', 'denomination', 'mint', 'date_ah', 'date_ce', 'weight_grams',
      'diameter_mm', 'countermark_detected', 'countermark_type', 'countermark_authority',
      'host_coin_dynasty', 'host_coin_ruler', 'script', 'inscription_obverse', 'inscription_reverse',
      'zeno_reference', 'numista_reference', 'catalogue_reference', 'identification_state',
    ],
    conditionScale: 'VF / EF / Fine / VG / Good / Poor (hammered scale)',
    valuationInputs: [
      'dynasty', 'ruler', 'denomination', 'mint', 'date', 'condition', 'weight_standard',
      'countermark_authority', 'rarity', 'provenance', 'zeno_comparables', 'auction_results',
    ],
    riskFactors: [
      'modern_forgery', 'cast_copy', 'altered_countermark', 'cleaned', 'corrosion_concealing_details',
      'false_attribution', 'export_restriction', 'cultural_property_law', 'no_provenance',
    ],
    typicalMarketplaces: ['ebay', 'etsy'],
    autoDetectKeywords: [
      'tanka', 'dirham', 'timurid', 'mughal', 'sultanate', 'islamic', 'hammered', 'silver',
      'indo-greek', 'kushan', 'drachm', 'rupee', 'countermark', 'persian', 'arabic inscription',
      'shahrukh', 'abu said', 'delhi sultanate', 'bengal sultanate', 'fractional',
    ],
    version: '1.0.0',
  },

  motocross: {
    id: 'motocross',
    name: 'Motocross & Off-Road Bikes',
    shortName: 'MX',
    description: 'Identification, condition assessment, and valuation of motocross, enduro, trail, and supermoto bikes — plus parts and accessories.',
    icon: 'two-wheeler',
    iconFamily: 'MaterialIcons',
    color: '#EF4444',
    category: 'physical_goods',
    captureRequirements: [
      { id: 'left_side', label: 'Left Side Profile', description: 'Full left-side profile showing frame, suspension, plastics', required: true, hint: 'Show the full bike — engine number plate side on most bikes' },
      { id: 'right_side', label: 'Right Side Profile', description: 'Full right-side profile showing exhaust, chain, sprocket', required: true, hint: 'Show chainset, exhaust, and right-side plastics' },
      { id: 'engine', label: 'Engine & Frame', description: 'Engine close-up showing any visible numbers, condition', required: true, hint: 'Frame number and engine number are critical evidence' },
      { id: 'front', label: 'Front / Forks', description: 'Front forks, wheel, brakes, bars, number plate', required: false, hint: 'Fork seals, brace, brake caliper condition visible' },
      { id: 'damage_wear', label: 'Damage / Wear', description: 'Any visible damage, cracks, bends, corrosion, repairs', required: false, hint: 'Photograph any bent frame, cracked plastics, or worn components' },
      { id: 'vin_plate', label: 'VIN / Frame Number', description: 'Close-up of VIN plate or stamped frame number', required: false, hint: 'Definitive evidence for model/year identification — photograph clearly' },
    ],
    capabilities: {
      identify: true, classify: true, research: true, authenticate: true,
      assessCondition: true, value: true, predictDemand: true,
      recommendDisposition: true, generateListing: true, validateListing: true,
      detectRisk: true, suggestAcquisitionStrategy: true,
    },
    keyAttributes: [
      'manufacturer', 'model', 'model_year', 'engine_size', 'stroke_type',
      'engine_hours', 'frame_number', 'engine_number', 'suspension_forks',
      'suspension_shock', 'running_status', 'condition',
      'plastics_condition', 'exhaust', 'modifications',
    ],
    conditionScale: 'Running / Repairable / Parts Only',
    valuationInputs: [
      'manufacturer', 'model', 'year', 'engine_size', 'condition',
      'running_status', 'engine_hours', 'modifications', 'completeness',
      'current_market_demand',
    ],
    riskFactors: [
      'bent_frame', 'seized_engine', 'missing_frame_number', 'unknown_history',
      'flood_damage', 'sand_ingestion', 'crash_damage', 'incorrect_year_claimed',
      'stolen_vehicle', 'non_standard_engine_swap',
    ],
    typicalMarketplaces: ['ebay', 'facebook_marketplace', 'gumtree', 'autotrader_moto'],
    autoDetectKeywords: [
      'motocross', 'mx', 'enduro', 'trail bike', 'ktm', 'husqvarna', 'yamaha yz',
      'honda cr', 'honda crf', 'kawasaki kx', 'suzuki rm', 'beta', 'sherco',
      'gas gas', 'two stroke', 'four stroke', '2t', '4t', 'dirt bike', 'scrambler',
      'supermoto', 'pit bike', 'minibike', 'off road', 'wr', 'exc', 'xc',
    ],
    version: '1.0.0',
  },

  bicycles: {
    id: 'bicycles',
    name: 'Bicycles & Cycling',
    shortName: 'Bicycles',
    description: 'Identification, condition assessment, and valuation of road, mountain, gravel, hybrid, BMX, e-bikes, and cycling components for resale.',
    icon: 'pedal-bike',
    iconFamily: 'MaterialIcons',
    color: '#6ED020',
    category: 'physical_goods',
    captureRequirements: [
      { id: 'drive_side', label: 'Drive Side', description: 'Right side showing chainset, derailleur and cassette', required: true, hint: 'Most identifying components are on the drive side — fill the frame' },
      { id: 'non_drive_side', label: 'Non-Drive Side', description: 'Left side showing frame profile and fork', required: true, hint: 'Shows frame shape, geometry, and any frame-side branding' },
      { id: 'head_badge', label: 'Head Badge / Decal', description: 'Brand decal on head tube or down tube', required: false, hint: 'Critical for brand identification — photograph clearly without glare' },
      { id: 'components', label: 'Groupset / Components', description: 'Close-up of derailleurs, brakes and shifters', required: false, hint: 'Shimano, SRAM, Campagnolo groupset can be identified from logos on derailleurs' },
      { id: 'damage_wear', label: 'Damage / Wear', description: 'Any cracks, dents, rust, worn components', required: false, hint: 'Photograph all damage — undisclosed faults cause returns' },
      { id: 'frame_number', label: 'Frame Number / Size Stamp', description: 'Bottom bracket shell or head tube size stamp', required: false, hint: 'Frame number can reveal year of manufacture on some brands' },
    ],
    capabilities: {
      identify: true, classify: true, research: true, authenticate: false,
      assessCondition: true, value: true, predictDemand: true,
      recommendDisposition: true, generateListing: true, validateListing: true,
      detectRisk: true, suggestAcquisitionStrategy: true,
    },
    keyAttributes: [
      'brand', 'model', 'bike_type', 'frame_size', 'frame_material',
      'year_range', 'groupset', 'wheel_size', 'brake_type',
      'suspension_type', 'rideable_status', 'frame_condition',
      'drivetrain_condition', 'tyres_condition', 'modifications',
    ],
    conditionScale: 'Rideable / Needs Service / Non-Rideable / Parts Only',
    valuationInputs: [
      'brand', 'model', 'frame_size', 'groupset', 'condition',
      'rideable_status', 'year', 'modifications', 'completeness',
      'current_market_demand',
    ],
    riskFactors: [
      'cracked_frame', 'bent_forks', 'seized_bottom_bracket', 'corrosion',
      'non_matching_components', 'damaged_dropouts', 'carbon_damage',
      'incorrect_brand_claimed', 'missing_components', 'non_rideable',
    ],
    typicalMarketplaces: ['ebay', 'facebook_marketplace', 'gumtree', 'bike_exchange'],
    autoDetectKeywords: [
      'bicycle', 'bike', 'mountain bike', 'road bike', 'gravel bike', 'bmx',
      'e-bike', 'electric bike', 'hybrid bike', 'folding bike', 'shimano',
      'sram', 'campagnolo', 'specialized', 'trek', 'giant', 'cannondale',
      'scott', 'cube', 'genesis', 'kona', 'marin', 'carrera', 'halfords',
      'full suspension', 'hardtail', 'carbon frame', 'aluminium frame',
    ],
    version: '1.0.0',
  },

  curiosities_collectibles: {
    id: 'curiosities_collectibles',
    name: 'Curiosities & Collectibles',
    shortName: 'Curiosities',
    description: 'General collectibles, curios, vintage items, and mixed acquisitions.',
    icon: 'category',
    iconFamily: 'MaterialIcons',
    color: '#14B8A6',
    category: 'collectibles',
    captureRequirements: [
      { id: 'main', label: 'Main View', description: 'Primary view', required: true },
      { id: 'back', label: 'Reverse', description: 'Back or underside', required: false },
      { id: 'marks', label: 'Marks/Labels', description: 'Any marks, labels, stamps', required: false },
      { id: 'damage', label: 'Condition', description: 'Wear or damage detail', required: false },
    ],
    capabilities: {
      identify: true, classify: true, research: true,
      assessCondition: true, value: true, predictDemand: true,
      recommendDisposition: true, generateListing: true,
    },
    keyAttributes: ['type', 'description', 'era', 'material', 'origin', 'condition', 'notable_features'],
    valuationInputs: ['type', 'condition', 'rarity', 'current_demand', 'collector_interest'],
    riskFactors: ['reproduction', 'damage', 'incorrect_attribution'],
    typicalMarketplaces: ['ebay', 'etsy'],
    autoDetectKeywords: ['curiosity', 'curio', 'vintage', 'retro', 'collectible', 'toy', 'figurine', 'memorabilia'],
    version: '1.0.0',
  },

  fossils: {
    id: 'fossils', name: 'Fossils & Minerals', shortName: 'Fossils',
    description: 'Identify and value fossils, minerals, and palaeontological specimens.',
    icon: 'yard', iconFamily: 'MaterialIcons', color: '#8B5CF6', category: 'collectibles',
    captureRequirements: [
      { id: 'main', label: 'Main specimen', description: 'Clear full specimen photo', required: true },
      { id: 'detail', label: 'Detail', description: 'Close-up of identifying features', required: false },
      { id: 'scale', label: 'Scale', description: 'Include a scale reference', required: false },
    ],
    capabilities: { identify: true, classify: true, research: true, authenticate: true, assessCondition: true, value: true, predictDemand: true, recommendDisposition: true, generateListing: true, validateListing: true, detectRisk: true },
    keyAttributes: ['taxonomic_group', 'species', 'anatomical_features', 'period', 'formation', 'locality', 'dimensions', 'matrix', 'restoration', 'provenance'],
    valuationInputs: ['species', 'rarity', 'period', 'locality', 'condition', 'provenance'],
    riskFactors: ['misidentification', 'restoration', 'protected_species_or_site', 'uncertain_provenance'],
    typicalMarketplaces: ['ebay', 'etsy'],
    autoDetectKeywords: ['fossil', 'ammonite', 'trilobite', 'petrified', 'shark tooth', 'mineral specimen'],
    version: '1.0.0',
  },

  beauty: {
    id: 'beauty', name: 'Beauty Products', shortName: 'Beauty',
    description: 'Identify and value beauty, skincare, cosmetics, and fragrance products.',
    icon: 'spa', iconFamily: 'MaterialIcons', color: '#F472B6', category: 'physical_goods',
    captureRequirements: [
      { id: 'front', label: 'Product front', description: 'Brand and product name visible', required: true },
      { id: 'back', label: 'Product details', description: 'Ingredients, barcode, and batch details', required: false },
      { id: 'expiry', label: 'Expiry or batch', description: 'Expiry date or batch code where available', required: false },
    ],
    capabilities: { identify: true, classify: true, research: true, authenticate: true, assessCondition: true, value: true, predictDemand: true, recommendDisposition: true, generateListing: true, validateListing: true, detectRisk: true },
    keyAttributes: ['brand', 'product_name', 'size', 'condition', 'batch_code', 'expiry_date', 'sealed'],
    valuationInputs: ['brand', 'product_name', 'size', 'sealed', 'expiry_date', 'market_demand'],
    riskFactors: ['expired_product', 'opened_or_used', 'counterfeit', 'restricted_ingredient', 'missing_batch_code'],
    typicalMarketplaces: ['ebay'],
    autoDetectKeywords: ['skincare', 'makeup', 'cosmetic', 'perfume', 'fragrance', 'beauty product', 'lipstick', 'foundation', 'serum'],
    version: '1.0.0',
  },

  tech: {
    id: 'tech', name: 'Technology & Electronics', shortName: 'Tech',
    description: 'Identify and value consumer electronics, computing equipment, and accessories.',
    icon: 'devices', iconFamily: 'MaterialIcons', color: '#06B6D4', category: 'physical_goods',
    captureRequirements: [
      { id: 'front', label: 'Main device', description: 'Full product view', required: true },
      { id: 'model', label: 'Model label', description: 'Model, serial, or regulatory label', required: false },
      { id: 'accessories', label: 'Accessories', description: 'Show included cables and accessories', required: false },
      { id: 'condition', label: 'Condition', description: 'Capture damage and operational status', required: true },
    ],
    capabilities: { identify: true, classify: true, research: true, authenticate: true, assessCondition: true, value: true, predictDemand: true, recommendDisposition: true, generateListing: true, validateListing: true, detectRisk: true },
    keyAttributes: ['brand', 'model', 'specifications', 'storage', 'condition', 'tested', 'accessories'],
    valuationInputs: ['brand', 'model', 'specifications', 'condition', 'tested', 'sold_comparables'],
    riskFactors: ['activation_lock', 'stolen_device', 'battery_damage', 'missing_parts', 'counterfeit'],
    typicalMarketplaces: ['ebay'],
    autoDetectKeywords: ['laptop', 'computer', 'tablet', 'smartphone', 'console', 'graphics card', 'processor', 'monitor', 'electronics'],
    version: '1.0.0',
  },

  surplus_trader: {
    id: 'surplus_trader',
    name: 'Job Lot & Surplus Trading',
    shortName: 'Surplus Trader',
    description: 'Manifest-led bulk resale. Match a photographed product to a supplier line, track units available, and create eBay listings without mixing unrelated niche inventory.',
    icon: 'inventory-2',
    iconFamily: 'MaterialIcons',
    color: '#14B8A6',
    category: 'physical_goods',
    captureRequirements: [
      { id: 'main', label: 'Product Photo', description: 'Clear image matching the manifest line', required: true },
      { id: 'barcode', label: 'Barcode / SKU', description: 'Barcode or manufacturer label where present', required: false },
      { id: 'condition', label: 'Condition', description: 'Packaging, wear, and completeness', required: true },
      { id: 'contents', label: 'Contents', description: 'Accessories or included components', required: false },
    ],
    capabilities: {
      identify: true, classify: true, research: true, assessCondition: true,
      value: true, predictDemand: true, recommendDisposition: true,
      generateListing: true, validateListing: true, detectRisk: true,
      suggestAcquisitionStrategy: true,
    },
    keyAttributes: ['supplier_sku', 'barcode', 'brand', 'model', 'quantity_available', 'condition', 'manifest_id'],
    valuationInputs: ['supplier_cost_per_unit', 'quantity_available', 'condition', 'realised_sold_comparables', 'fees', 'shipping_cost'],
    riskFactors: ['wrong_manifest_match', 'missing_parts', 'damaged_packaging', 'used_or_opened', 'restricted_item', 'quantity_mismatch'],
    typicalMarketplaces: ['ebay'],
    autoDetectKeywords: ['job lot', 'joblot', 'surplus', 'wholesale', 'pallet', 'manifest', 'bulk lot', 'clearance stock', 'returns lot'],
    version: '1.0.0',
  },
};

// Auto-detection scoring: returns specialist IDs sorted by relevance score
export function detectSpecialist(keywords: string[]): Array<{ id: SpecialistId; score: number }> {
  const lowerKeywords = keywords.map((k) => k.toLowerCase());
  const scores: Array<{ id: SpecialistId; score: number }> = [];

  for (const [id, config] of Object.entries(SPECIALISTS)) {
    let score = 0;
    for (const keyword of lowerKeywords) {
      for (const autoKeyword of config.autoDetectKeywords) {
        if (keyword.includes(autoKeyword) || autoKeyword.includes(keyword)) {
          score += 1;
        }
      }
    }
    if (score > 0) {
      scores.push({ id: id as SpecialistId, score });
    }
  }

  return scores.sort((a, b) => b.score - a.score);
}

export const SPECIALIST_LIST = Object.values(SPECIALISTS);
