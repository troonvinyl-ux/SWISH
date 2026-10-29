// SWISH Niche Category Classification Service
//
// PURPOSE: Classify eBay listings/items into their correct niche BEFORE importing.
//
// A seller may have ONE eBay account containing listings across multiple niches.
// When a CoinFlip user imports their eBay account, ONLY coin-relevant listings
// should appear in CoinFlip inventory. MXFlip users should only see MX listings.
//
// CLASSIFICATION PRIORITY (highest confidence first):
//   1. eBay category ID → known niche mapping (most reliable)
//   2. eBay category name → keyword matching
//   3. Title/description keyword matching (fallback)
//
// Returns 'unclassified' for ambiguous listings — never silently assigns
// a wrong niche.

export type NicheClassification =
  | 'coins'         // CoinFlip — numismatics, banknotes, medals
  | 'motocross'     // MXFlip — motocross, enduro, trail, supermoto, MX parts
  | 'bicycles'      // Bike Flipper — pedal cycles, e-bikes, BMX
  | 'clothing'      // Threads Flip — garments, footwear, accessories
  | 'trading_cards' // Cards niche
  | 'antiques'      // Antiques niche
  | 'fossils'       // Fossils niche
  | 'beauty'        // Beauty niche
  | 'tech'          // Technology niche
  | 'surplus_flip'  // Surplus lots and manifests
  | 'unclassified'; // Ambiguous — do not assign to any niche

// ── eBay UK Category ID → Niche mapping ──────────────────────────────────────
// Category IDs sourced from eBay UK Taxonomy (tree_id=3, marketplace=EBAY_GB)
// Groups are exclusive: a category appears in at most one niche.

const CATEGORY_ID_TO_NICHE: Record<string, NicheClassification> = {
  // ── COINS & NUMISMATICS ────────────────────────────────────────────────────
  '4726':   'coins', // British Coins
  '40714':  'coins', // Ancient Coins
  '18594':  'coins', // Medieval Coins
  '18593':  'coins', // Hammered Coins
  '4157':   'coins', // Roman Coins
  '4158':   'coins', // Greek Coins
  '4138':   'coins', // US Coins
  '4735':   'coins', // World Coins
  '4734':   'coins', // Australian Coins
  '527':    'coins', // Coin Collections & Lots
  '4733':   'coins', // Coins — general parent (treat as coins)
  '260':    'coins', // Coins — top-level eBay tree node for UK coins
  '11116':  'coins', // Banknotes
  '14486':  'coins', // Banknotes — British
  '14487':  'coins', // Banknotes — World
  '1469':   'coins', // Other Collectables (legacy coin listing category)
  '4744':   'coins', // Celtic Coins
  '37968':  'coins', // Byzantine Coins
  '40717':  'coins', // Islamic Coins (Indian/Middle East)
  '4159':   'coins', // Celtic & Anglo-Saxon
  '18596':  'coins', // Proof, Specimen & Uncirculated
  '29539':  'coins', // Bullion (Gold/Silver coins)
  '47188':  'coins', // Tokens, Medals & Badges
  '620':    'coins', // Exonumia
  '10968':  'coins', // Notgeld & Emergency Currency

  // ── MOTOCROSS & OFF-ROAD ───────────────────────────────────────────────────
  '6760':   'motocross', // Motorcycles (parent — catch-all for MX bikes)
  '6759':   'motocross', // Motorbikes & Scooters
  '10767':  'motocross', // Motocross Bikes
  '10768':  'motocross', // Enduro Bikes
  '47002':  'motocross', // Pit Bikes & Minimoto
  '6761':   'motocross', // Motorcycle Parts
  '50434':  'motocross', // Motorcycle Clothing, Helmets & Protection
  '26455':  'motocross', // Motorcycle Engines & Engine Parts
  '26459':  'motocross', // Motorcycle Frame & Chassis
  '26456':  'motocross', // Motorcycle Suspension & Steering
  '26457':  'motocross', // Motorcycle Wheels & Tyres
  '50370':  'motocross', // Motorcycle Exhausts
  '26460':  'motocross', // Motorcycle Bodywork & Fairings
  '25634':  'motocross', // Motorcycle Brakes
  '25633':  'motocross', // Motorcycle Electrical

  // ── BICYCLES ──────────────────────────────────────────────────────────────
  '2904':   'bicycles', // Bicycles
  '56197':  'bicycles', // Complete Road Bikes
  '177831': 'bicycles', // Complete Mountain Bikes
  '48647':  'bicycles', // BMX Bikes
  '56199':  'bicycles', // Hybrid & City Bikes
  '56198':  'bicycles', // Folding Bikes
  '177832': 'bicycles', // Electric Bikes
  '2906':   'bicycles', // Bicycle Parts & Accessories
  '15279':  'bicycles', // Bicycle Frames
  '15274':  'bicycles', // Bicycle Wheels
  '15278':  'bicycles', // Bicycle Brakes
  '15272':  'bicycles', // Bicycle Gears & Derailleurs
  '46060':  'bicycles', // Bicycle Saddles & Seat Posts
  '56203':  'bicycles', // Bicycle Handlebars, Stems & Headsets
  '56200':  'bicycles', // Cycle Computers
  '15275':  'bicycles', // Bicycle Tyres & Tubes

  // ── CLOTHING & FASHION ────────────────────────────────────────────────────
  '1059':   'clothing', // Clothing (main parent)
  '11450':  'clothing', // Clothing, Shoes & Accessories
  '15724':  'clothing', // Men's Clothing
  '15725':  'clothing', // Women's Clothing
  '57990':  'clothing', // Boys' Clothing
  '57991':  'clothing', // Girls' Clothing
  '11483':  'clothing', // Men's Shoes
  '11484':  'clothing', // Women's Shoes
  '152506': 'clothing', // Trainers & Athletic Shoes
  '45333':  'clothing', // Men's Bags & Accessories
  '169291': 'clothing', // Women's Bags & Accessories
  '175748': 'clothing', // Vintage & Rare Clothing
  '50995':  'clothing', // Hoodies & Sweatshirts
  '3002':   'clothing', // T-Shirts
  '57988':  'clothing', // Jeans
  '14890':  'clothing', // Dresses
  '63848':  'clothing', // Jackets & Coats
  '172131': 'clothing', // Sportswear
  '169741': 'clothing', // Activewear

  // ── TRADING CARDS ─────────────────────────────────────────────────────────
  '183454': 'trading_cards', // CCG Individual Cards (Pokémon, Magic etc.)
  '2536':   'trading_cards', // Non-Sport Trading Cards
  '261328': 'trading_cards', // Pokémon Individual Cards
  '261329': 'trading_cards', // Pokémon Sealed Booster Packs
  '261330': 'trading_cards', // Pokémon Card Lots
  '246':    'trading_cards', // Sports Trading Cards

  // ── ANTIQUES & COLLECTIBLES ────────────────────────────────────────────────
  '20081':  'antiques', // Antiques (parent)
  '20091':  'antiques', // Antique Furniture
  '870':    'antiques', // Ceramics & Pottery
  '261186': 'antiques', // Rare & Antiquarian Books
  '550':    'antiques', // Art
  '37958':  'antiques', // Art — Paintings
  '360':    'antiques', // Art — Prints
  '14324':  'antiques', // Wristwatches
  '14325':  'antiques', // Pocket Watches
  '50':     'antiques', // Fine Jewellery
  '13956':  'antiques', // Militaria
};

// ── Category name keyword → niche mapping ────────────────────────────────────
// Used when a category ID is not in the above map but a category name is available.
// Matches are case-insensitive substring matches.

const CATEGORY_NAME_NICHE_KEYWORDS: Array<{ keywords: string[]; niche: NicheClassification }> = [
  {
    keywords: ['coin', 'numismatic', 'banknote', 'currency', 'medal', 'token', 'exonumia', 'bullion', 'hammered', 'ancient', 'roman coin', 'greek coin', 'british coin', 'world coin'],
    niche: 'coins',
  },
  {
    keywords: ['motocross', 'enduro', 'dirt bike', 'mx bike', 'pit bike', 'minimoto', 'ktm', 'husqvarna', 'trial bike', 'off-road motorcycle', 'motorbike parts', 'motorcycle engine', 'motorcycle exhaust', 'motorcycle suspension', 'motorcycle frame'],
    niche: 'motocross',
  },
  {
    keywords: ['bicycle', 'mountain bike', 'road bike', 'bmx', 'cycling', 'bike frame', 'pedal cycle', 'electric bike', 'e-bike', 'folding bike', 'hybrid bike', 'cycle'],
    niche: 'bicycles',
  },
  {
    keywords: ["men's clothing", "women's clothing", "boys' clothing", "girls' clothing", 't-shirt', 'hoodie', 'sweatshirt', 'jeans', 'dress', 'jacket', 'coat', 'trainer', 'sneaker', 'sportswear', 'activewear', 'vintage clothing', 'fashion'],
    niche: 'clothing',
  },
  {
    keywords: ['pokémon', 'pokemon', 'magic gathering', 'trading card', 'sports card', 'ccg', 'tcg', 'yu-gi-oh'],
    niche: 'trading_cards',
  },
  {
    keywords: ['fossil', 'ammonite', 'trilobite', 'mineral specimen', 'petrified'],
    niche: 'fossils',
  },
  {
    keywords: ['skincare', 'skin care', 'makeup', 'cosmetic', 'perfume', 'fragrance', 'beauty product', 'lipstick', 'foundation', 'serum'],
    niche: 'beauty',
  },
  {
    keywords: ['laptop', 'computer', 'tablet', 'smartphone', 'graphics card', 'processor', 'monitor', 'electronics', 'computer components'],
    niche: 'tech',
  },
  {
    keywords: ['antique', 'vintage watch', 'wristwatch', 'pocket watch', 'fine jewellery', 'militaria', 'ceramics', 'pottery', 'antiquarian book'],
    niche: 'antiques',
  },
];

// ── Title keyword → niche mapping ────────────────────────────────────────────
// Only used as a LAST RESORT when no category information is available.
// Higher risk of false positives — results should be treated as 'probable'.

const TITLE_NICHE_KEYWORDS: Array<{ patterns: RegExp[]; niche: NicheClassification; confidence: 'high' | 'medium' }> = [
  {
    patterns: [
      /\b(coin|denarius|dirham|tetradrachm|drachm|solidus|florin|shilling|penny|sovereign|groat|tanka|rupee|stater|obol|nummus|follis|sesterce|aureus|sestertius)\b/i,
      /\b(ancient|roman|greek|byzantine|medieval|hammered|milled|decimal|victorian coin|george iii|edward vii|silver coin|gold coin|bronze coin)\b/i,
      /\b(numismatic|spink|km #|kgm|ric\b|bmc\b|sng\b|n#|graded coin|pcgs|ngc)\b/i,
    ],
    niche: 'coins',
    confidence: 'high',
  },
  {
    patterns: [
      /\b(ktm|husqvarna|husky|yamaha yz|yamaha wr|honda crf|honda cr|kawasaki kx|suzuki rm|suzuki rmz|beta xtrainer|sherco|gas gas|tm racing|fantic|dirt bike)\b/i,
      /\b(motocross|enduro|supermoto|pit bike|mx bike|sx\b|exc\b|xcw\b|sxf\b|xcf\b|fe\b|te\b|fc\b|2-stroke|4-stroke|250sx|450sx|250xc|300exc)\b/i,
      /\b(tpi\b|2t\b|4t\b|monoshock|linkage|usd forks|triple clamp|rekluse|twin air|boyesen|wb\b)\b/i,
    ],
    niche: 'motocross',
    confidence: 'high',
  },
  {
    patterns: [
      /\b(shimano|sram|campagnolo|specialized|trek|giant|cannondale|scott|cervélo|pinarello|de rosa|colnago|bianchi|focus|genesis|kona|marin)\b/i,
      /\b(mountain bike|road bike|bmx|cycling|bicycle|bike frame|wheels (\d{2}mm|\d{2}")[^a-z]|deraill|cassette|chainset|groupset|carbon fork|alloy frame)\b/i,
    ],
    niche: 'bicycles',
    confidence: 'high',
  },
  {
    patterns: [
      /\b(vintage tee|band tee|graphic tee|dead?stock|nwt\b|nos\b|bnwt\b|stone island|north face|superdry|levi|wrangler|carhartt|dickies|ralph lauren)\b/i,
      /\b(size [xsml]\b|size \d{2}\b|chest \d{2}|length \d{2}|made in (england|hong kong|taiwan|usa)|care label|composition label)\b/i,
    ],
    niche: 'clothing',
    confidence: 'medium',
  },
  {
    patterns: [
      /\b(pokémon|pokemon card|magic: the gathering|yu-gi-oh|mtg\b|graded psa|graded bgs|holo rare|first edition|shadowless|booster pack)\b/i,
    ],
    niche: 'trading_cards',
    confidence: 'high',
  },
  {
    patterns: [/\\b(fossil|ammonite|trilobite|shark tooth|petrified wood|dinosaur bone|mineral specimen)\\b/i],
    niche: 'fossils',
    confidence: 'high',
  },
  {
    patterns: [/\\b(skincare|makeup|cosmetic|perfume|fragrance|lipstick|foundation|serum|beauty product)\\b/i],
    niche: 'beauty',
    confidence: 'high',
  },
  {
    patterns: [/\\b(laptop|desktop computer|graphics card|processor|motherboard|monitor|tablet|smartphone|electronics)\\b/i],
    niche: 'tech',
    confidence: 'high',
  },
  {
    patterns: [/\\b(job lot|joblot|surplus|pallet|clearance lot|wholesale lot|liquidation|manifest)\\b/i],
    niche: 'surplus_flip',
    confidence: 'medium',
  },
];

// ── MAIN CLASSIFICATION FUNCTION ─────────────────────────────────────────────

export interface ClassificationResult {
  niche: NicheClassification;
  confidence: 'category_id' | 'category_name' | 'title_high' | 'title_medium' | 'none';
  reason: string;
}

/**
 * Classify a listing into a niche using eBay category and title evidence.
 *
 * @param categoryId   Numeric eBay category ID (e.g. "4726")
 * @param categoryName Category name/path from eBay (e.g. "Coins:British:British Coins")
 * @param title        Listing title
 * @param description  Optional listing description (rarely needed)
 */
export function classifyListing(
  categoryId: string | null | undefined,
  categoryName: string | null | undefined,
  title: string | null | undefined,
  description?: string | null,
): ClassificationResult {
  const catId = (categoryId ?? '').trim();
  const catName = (categoryName ?? '').trim().toLowerCase();
  const titleStr = (title ?? '').trim();
  const titleLower = titleStr.toLowerCase();

  // ── Step 1: Category ID lookup (most reliable) ─────────────────────────────
  if (catId && CATEGORY_ID_TO_NICHE[catId]) {
    const niche = CATEGORY_ID_TO_NICHE[catId];
    return {
      niche,
      confidence: 'category_id',
      reason: `Category ID ${catId} mapped to ${niche}`,
    };
  }

  // Also check sub-IDs from category path patterns (e.g. category path contains a known ID)
  if (catName) {
    for (const [id, niche] of Object.entries(CATEGORY_ID_TO_NICHE)) {
      if (catName.includes(id)) {
        return {
          niche,
          confidence: 'category_id',
          reason: `Category name path contains known ID ${id} → ${niche}`,
        };
      }
    }
  }

  // ── Step 2: Category name keyword matching ─────────────────────────────────
  if (catName) {
    for (const { keywords, niche } of CATEGORY_NAME_NICHE_KEYWORDS) {
      for (const kw of keywords) {
        if (catName.includes(kw.toLowerCase())) {
          return {
            niche,
            confidence: 'category_name',
            reason: `Category name "${catName}" matches keyword "${kw}" → ${niche}`,
          };
        }
      }
    }
  }

  // ── Step 3: Title pattern matching (last resort) ───────────────────────────
  for (const { patterns, niche, confidence } of TITLE_NICHE_KEYWORDS) {
    for (const pattern of patterns) {
      if (pattern.test(titleLower)) {
        return {
          niche,
          confidence: `title_${confidence}` as any,
          reason: `Title matches pattern for ${niche}: "${titleStr.slice(0, 60)}"`,
        };
      }
    }
  }

  // ── No match ──────────────────────────────────────────────────────────────
  return {
    niche: 'unclassified',
    confidence: 'none',
    reason: `No niche classification for catId="${catId}" catName="${catName.slice(0, 40)}" title="${titleStr.slice(0, 40)}"`,
  };
}

/**
 * Determine the specialist_id to assign to an item based on its niche classification.
 */
export function nicheToSpecialistId(niche: NicheClassification): string {
  switch (niche) {
    case 'coins':         return 'coins'; // coins specialist
    case 'motocross':     return 'motocross';
    case 'bicycles':      return 'bicycles';
    case 'clothing':      return 'clothing';
    case 'trading_cards': return 'pokemon_cards';
    case 'antiques':      return 'antiques';
    case 'fossils':       return 'fossils';
    case 'beauty':        return 'beauty';
    case 'tech':          return 'tech';
    case 'surplus_flip':  return 'surplus_trader';
    default:              return 'curiosities_collectibles';
  }
}

/**
 * Check whether a listing's niche classification is compatible with the
 * active niche context (i.e. the niche the user is importing for).
 *
 * Returns true if the listing belongs to the target niche OR is unclassified
 * AND the confidence is below 'category_id' (so we don't silently exclude items
 * the classifier wasn't sure about).
 *
 * In practice: for CSV import, call classifyListing() on each row and then
 * use this to decide whether to include it in the current niche's import.
 */
export function isListingEligibleForNiche(
  result: ClassificationResult,
  targetNiche: NicheClassification | null,
): boolean {
  // No target niche specified → accept all (backwards-compatible fallback)
  if (!targetNiche) return true;

  // Exact niche match → always eligible
  if (result.niche === targetNiche) return true;

  // Unclassified items: include them with confidence < category_name
  // so that manually-created listings without a category aren't silently excluded.
  // The user can review them in the inventory.
  if (result.niche === 'unclassified' && result.confidence === 'none') return true;

  // Classified as a DIFFERENT niche → not eligible
  return false;
}
