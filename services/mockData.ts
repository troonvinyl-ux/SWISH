// SWISH Mock Data Service
// Realistic mock data for V1.0 foundation.
// All data structures match the canonical SWISH object model.
// Replace with real OnSpace Cloud queries when backend is enabled.

import { ItemStatus, DispositionDecision, MarketplaceId, EvidenceSource, ConfidenceTier } from '@/constants/config';
import { SpecialistId } from '@/constants/specialists';

// ─── Canonical IDs ───────────────────────────────────────────────────────────
let _idCounter = 1000;
export function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${++_idCounter}`;
}

// ─── Core Data Types ──────────────────────────────────────────────────────────

export interface Tenant {
  id: string;
  name: string;
  subscriptionTier: 'starter' | 'professional' | 'business' | 'enterprise';
  activeSpecialists: SpecialistId[];
  settings: TenantSettings;
  createdAt: string;
}

export interface TenantSettings {
  currency: string;
  highValueThreshold: number;
  automationLevel: 'manual' | 'assisted' | 'one_click' | 'auto_approval' | 'autonomous';
  defaultMarketplaces: MarketplaceId[];
  minMargin: number;
  minROI: number;
  maxAcquisitionBudget: number;
}

export interface Acquisition {
  id: string;
  tenantId: string;
  title: string;
  description: string;
  source: string;
  purchasePrice: number;
  transportCost: number;
  processingCostEstimate: number;
  labourEstimate: number;
  storageCost: number;
  totalCostEstimate: number;
  acquisitionDate: string;
  location: string;
  itemCount: number;
  processedCount: number;
  listedCount: number;
  soldCount: number;
  expectedGrossRevenue: number;
  expectedNetRevenue: number;
  expectedProfit: number;
  expectedROI: number;
  actualGrossRevenue: number;
  actualNetRevenue: number;
  actualProfit: number;
  actualROI: number;
  status: 'pending' | 'processing' | 'partially_processed' | 'processed' | 'selling' | 'completed' | 'closed';
  media: string[];
  tags: string[];
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface Item {
  id: string;
  tenantId: string;
  acquisitionId?: string;
  canonicalTitle: string;
  description: string;
  specialistId: SpecialistId;
  status: ItemStatus;
  dispositionDecision: DispositionDecision;
  condition: string;
  conditionGrade?: string;
  conditionNotes: string;
  identificationConfidence: number;
  identificationSource: EvidenceSource;
  valuationLow: number;
  valuationMid: number;
  valuationHigh: number;
  valuationConfidence: ConfidenceTier;
  expectedSellingPrice: number;
  expectedNet: number;
  expectedProfit: number;
  saleProb30d: number;
  attributes: Record<string, string | number | boolean>;
  media: string[];
  warnings: string[];
  tags: string[];
  acquiredCost: number;
  soldPrice?: number;
  soldAt?: string;
  marketplace?: MarketplaceId;
  createdAt: string;
  updatedAt: string;
}

export interface ValuationRecord {
  id: string;
  itemId: string;
  source: string;
  low: number;
  mid: number;
  high: number;
  confidence: ConfidenceTier;
  basis: string;
  evidence: string[];
  createdAt: string;
}

export interface ListingRecord {
  id: string;
  itemId: string;
  marketplaceId: MarketplaceId;
  externalListingId?: string;
  title: string;
  description: string;
  price: number;
  floorPrice: number;
  ceilingPrice: number;
  status: 'draft' | 'pending' | 'active' | 'ended' | 'sold' | 'failed';
  views: number;
  watchers: number;
  publishedAt?: string;
  endedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaleRecord {
  id: string;
  itemId: string;
  listingId: string;
  marketplaceId: MarketplaceId;
  salePrice: number;
  marketplaceFee: number;
  shippingCost: number;
  netRevenue: number;
  profit: number;
  predictedProfit: number;
  predictionAccuracy: number;
  soldAt: string;
  fulfilledAt?: string;
}

export interface BusinessMetrics {
  tenantId: string;
  period: string;
  totalAcquisitions: number;
  totalItems: number;
  listedItems: number;
  soldItems: number;
  totalRevenue: number;
  totalFees: number;
  totalShipping: number;
  totalLabour: number;
  totalProfit: number;
  averageROI: number;
  averageMargin: number;
  capitalInvested: number;
  capitalTiedUp: number;
  cashAvailable: number;
  predictionAccuracy: number;
  sellThroughRate: number;
  averageTimeToSale: number; // days
  profitPerLabourHour: number;
  topPerformingSpecialist: SpecialistId;
  staleItemCount: number;
  exceptionCount: number;
}

export interface AIInsight {
  id: string;
  type: 'opportunity' | 'warning' | 'recommendation' | 'anomaly' | 'performance';
  priority: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  action?: string;
  actionLabel?: string;
  estimatedValue?: number;
  confidence: ConfidenceTier;
  createdAt: string;
}

// ─── Mock Tenant ──────────────────────────────────────────────────────────────
export const MOCK_TENANT: Tenant = {
  id: 'tenant_001',
  name: 'KeenOnCoins',
  subscriptionTier: 'professional',
  activeSpecialists: ['coins', 'banknotes', 'gold', 'silver', 'jewellery_precious_metals', 'antiques', 'curiosities_collectibles'],
  settings: {
    currency: 'GBP',
    highValueThreshold: 100,
    automationLevel: 'assisted',
    defaultMarketplaces: ['ebay'],
    minMargin: 0.20,
    minROI: 0.30,
    maxAcquisitionBudget: 5000,
  },
  createdAt: '2026-01-15T10:00:00Z',
};

// ─── Mock Acquisitions ────────────────────────────────────────────────────────
export const MOCK_ACQUISITIONS: Acquisition[] = [
  {
    id: 'acq_001',
    tenantId: 'tenant_001',
    title: 'House Clearance — Chesterfield Estate',
    description: 'Large Victorian house clearance including coin collection, silverware, jewellery, books, and general antiques.',
    source: 'Estate Agent Direct',
    purchasePrice: 2400,
    transportCost: 120,
    processingCostEstimate: 200,
    labourEstimate: 800,
    storageCost: 50,
    totalCostEstimate: 3570,
    acquisitionDate: '2026-08-28',
    location: 'Chesterfield, UK',
    itemCount: 284,
    processedCount: 147,
    listedCount: 89,
    soldCount: 34,
    expectedGrossRevenue: 8200,
    expectedNetRevenue: 6900,
    expectedProfit: 3330,
    expectedROI: 0.93,
    actualGrossRevenue: 1840,
    actualNetRevenue: 1540,
    actualProfit: 640,
    actualROI: 0.27,
    status: 'selling',
    media: [],
    tags: ['house_clearance', 'victorian', 'coins', 'silver', 'antiques'],
    notes: 'Good quality collection. Coin sub-collection appears to be focused on pre-decimal British coinage.',
    createdAt: '2026-08-28T09:15:00Z',
    updatedAt: '2026-09-08T14:30:00Z',
  },
  {
    id: 'acq_002',
    tenantId: 'tenant_001',
    title: 'Coin Dealer Stock — Closure Sale',
    description: 'World coin collection from retiring dealer. Approximately 800 items across multiple countries and periods.',
    source: 'Direct from Dealer',
    purchasePrice: 3200,
    transportCost: 0,
    processingCostEstimate: 400,
    labourEstimate: 1200,
    storageCost: 80,
    totalCostEstimate: 4880,
    acquisitionDate: '2026-09-01',
    location: 'Sheffield, UK',
    itemCount: 812,
    processedCount: 210,
    listedCount: 178,
    soldCount: 62,
    expectedGrossRevenue: 11400,
    expectedNetRevenue: 9600,
    expectedProfit: 4720,
    expectedROI: 0.97,
    actualGrossRevenue: 2100,
    actualNetRevenue: 1760,
    actualProfit: 860,
    actualROI: 0.27,
    status: 'processing',
    media: [],
    tags: ['world_coins', 'dealer_stock', 'bulk'],
    notes: 'Heavy towards US coins, some key dates identified. Requires careful processing.',
    createdAt: '2026-09-01T11:00:00Z',
    updatedAt: '2026-09-09T09:45:00Z',
  },
  {
    id: 'acq_003',
    tenantId: 'tenant_001',
    title: 'Mixed Gold & Silver Jewellery Lot',
    description: 'Mixed precious metal jewellery from probate auction. Primarily 9ct and 18ct gold, some sterling silver.',
    source: 'Probate Auction — Sheffield',
    purchasePrice: 1800,
    transportCost: 45,
    processingCostEstimate: 60,
    labourEstimate: 180,
    storageCost: 20,
    totalCostEstimate: 2105,
    acquisitionDate: '2026-09-05',
    location: 'Sheffield, UK',
    itemCount: 47,
    processedCount: 12,
    listedCount: 8,
    soldCount: 3,
    expectedGrossRevenue: 3800,
    expectedNetRevenue: 3200,
    expectedProfit: 1095,
    expectedROI: 0.52,
    actualGrossRevenue: 340,
    actualNetRevenue: 285,
    actualProfit: 135,
    actualROI: 0.06,
    status: 'processing',
    media: [],
    tags: ['jewellery', 'gold', 'silver', 'probate'],
    notes: 'Good quality lot. Several pieces may exceed expected value on further research.',
    createdAt: '2026-09-05T14:20:00Z',
    updatedAt: '2026-09-09T11:00:00Z',
  },
];

// ─── Mock Items ───────────────────────────────────────────────────────────────
export const MOCK_ITEMS: Item[] = [
  {
    id: 'item_001',
    tenantId: 'tenant_001',
    acquisitionId: 'acq_001',
    canonicalTitle: '1887 Victorian Gold Half Sovereign — EF',
    description: 'Queen Victoria Jubilee Head gold half sovereign. Extremely Fine condition. Shield reverse.',
    specialistId: 'coins',
    status: 'active',
    dispositionDecision: 'sell_individual',
    condition: 'Extremely Fine',
    conditionGrade: 'EF45',
    conditionNotes: 'Light wear on high points. Excellent surfaces with original lustre.',
    identificationConfidence: 0.97,
    identificationSource: 'researched',
    valuationLow: 220,
    valuationMid: 265,
    valuationHigh: 310,
    valuationConfidence: 'high',
    expectedSellingPrice: 265,
    expectedNet: 220,
    expectedProfit: 198,
    saleProb30d: 0.82,
    attributes: {
      country: 'Great Britain',
      year: 1887,
      denomination: 'Half Sovereign',
      composition: 'Gold 917 (22ct)',
      diameter_mm: 19.3,
      weight_g: 3.99,
      mint: 'London',
      reverse: 'Shield',
      grade: 'EF45',
    },
    media: [],
    warnings: [],
    tags: ['gold', 'sovereign', 'victorian', 'half_sovereign'],
    acquiredCost: 22,
    createdAt: '2026-09-02T10:30:00Z',
    updatedAt: '2026-09-02T10:45:00Z',
  },
  {
    id: 'item_002',
    tenantId: 'tenant_001',
    acquisitionId: 'acq_001',
    canonicalTitle: 'Sterling Silver Sugar Caster — Birmingham 1904',
    description: 'Edwardian sterling silver sugar caster. Birmingham hallmark, 1904. Fully hallmarked.',
    specialistId: 'silver',
    status: 'listed',
    dispositionDecision: 'sell_individual',
    condition: 'Good',
    conditionNotes: 'Minor dents to base. Good overall condition with patina.',
    identificationConfidence: 0.89,
    identificationSource: 'researched',
    valuationLow: 45,
    valuationMid: 68,
    valuationHigh: 85,
    valuationConfidence: 'medium',
    expectedSellingPrice: 65,
    expectedNet: 52,
    expectedProfit: 42,
    saleProb30d: 0.65,
    attributes: {
      type: 'Sugar Caster',
      metal: 'Sterling Silver 925',
      hallmark_city: 'Birmingham',
      hallmark_year: 1904,
      weight_g: 142,
      height_cm: 15,
      melt_value: 31.20,
    },
    media: [],
    warnings: [],
    tags: ['silver', 'sterling', 'edwardian', 'hollowware'],
    acquiredCost: 10,
    createdAt: '2026-09-02T11:00:00Z',
    updatedAt: '2026-09-04T09:15:00Z',
  },
  {
    id: 'item_003',
    tenantId: 'tenant_001',
    acquisitionId: 'acq_002',
    canonicalTitle: '1916-D Mercury Dime — Fine Details',
    description: 'Key date 1916-D Mercury Dime. Fine Details — cleaned. Important key date coin.',
    specialistId: 'coins',
    status: 'review_required',
    dispositionDecision: 'human_review',
    condition: 'Fine Details',
    conditionNotes: 'Appears cleaned. Sent for expert authentication review.',
    identificationConfidence: 0.91,
    identificationSource: 'researched',
    valuationLow: 680,
    valuationMid: 950,
    valuationHigh: 1400,
    valuationConfidence: 'medium',
    expectedSellingPrice: 850,
    expectedNet: 720,
    expectedProfit: 698,
    saleProb30d: 0.45,
    attributes: {
      country: 'United States',
      year: 1916,
      mint_mark: 'D',
      denomination: 'Dime',
      composition: 'Silver 900',
      grade: 'F Details — Cleaned',
      key_date: true,
    },
    media: [],
    warnings: ['Possible cleaning — expert authentication recommended', 'Key date — high counterfeit risk'],
    tags: ['us_coins', 'key_date', 'dime', 'mercury', 'silver'],
    acquiredCost: 52,
    createdAt: '2026-09-04T14:00:00Z',
    updatedAt: '2026-09-05T09:00:00Z',
  },
  {
    id: 'item_004',
    tenantId: 'tenant_001',
    acquisitionId: 'acq_001',
    canonicalTitle: '1965 Churchill Crown — Uncirculated',
    description: 'Winston Churchill commemorative crown. 1965. Uncirculated condition.',
    specialistId: 'coins',
    status: 'priced',
    dispositionDecision: 'sell_individual',
    condition: 'Uncirculated',
    conditionNotes: 'Minimal contact marks. Original mint sheen.',
    identificationConfidence: 0.99,
    identificationSource: 'verified',
    valuationLow: 4,
    valuationMid: 6,
    valuationHigh: 9,
    valuationConfidence: 'very_high',
    expectedSellingPrice: 5.50,
    expectedNet: 3.80,
    expectedProfit: 3.40,
    saleProb30d: 0.78,
    attributes: {
      country: 'Great Britain',
      year: 1965,
      denomination: 'Crown (5 Shillings)',
      subject: 'Winston Churchill',
      composition: 'Cupronickel',
      grade: 'UNC',
    },
    media: [],
    warnings: [],
    tags: ['crown', 'commemorative', 'churchill', 'common'],
    acquiredCost: 0.40,
    createdAt: '2026-09-03T09:00:00Z',
    updatedAt: '2026-09-07T11:30:00Z',
  },
  {
    id: 'item_005',
    tenantId: 'tenant_001',
    acquisitionId: 'acq_003',
    canonicalTitle: '18ct Gold Diamond Solitaire Ring — 0.35ct',
    description: 'Ladies 18ct yellow gold diamond solitaire ring. Round brilliant cut diamond approx 0.35ct. Hallmarked.',
    specialistId: 'jewellery_precious_metals',
    status: 'assessing',
    dispositionDecision: 'investigate',
    condition: 'Very Good',
    conditionNotes: 'Minor wear to shank. Diamond appears clean and bright.',
    identificationConfidence: 0.84,
    identificationSource: 'inferred',
    valuationLow: 320,
    valuationMid: 480,
    valuationHigh: 650,
    valuationConfidence: 'medium',
    expectedSellingPrice: 440,
    expectedNet: 375,
    expectedProfit: 337,
    saleProb30d: 0.58,
    attributes: {
      type: 'Ring — Solitaire',
      metal: '18ct Yellow Gold',
      fineness: 750,
      diamond_approx_ct: 0.35,
      diamond_cut: 'Round Brilliant',
      ring_size: 'N',
      weight_g: 3.8,
      melt_value: 89,
    },
    media: [],
    warnings: ['Diamond valuation requires professional gemological assessment'],
    tags: ['gold', 'diamond', 'ring', 'solitaire', '18ct'],
    acquiredCost: 103,
    createdAt: '2026-09-06T10:00:00Z',
    updatedAt: '2026-09-06T10:30:00Z',
  },
  {
    id: 'item_006',
    tenantId: 'tenant_001',
    acquisitionId: 'acq_002',
    canonicalTitle: '1oz Silver American Eagle 2020 — BU',
    description: 'Bullion grade 1 troy oz .999 fine silver American Eagle. 2020 date. Brilliant Uncirculated.',
    specialistId: 'coins',
    status: 'active',
    dispositionDecision: 'sell_individual',
    condition: 'Brilliant Uncirculated',
    conditionNotes: 'Mint state. Capsule protected.',
    identificationConfidence: 0.99,
    identificationSource: 'verified',
    valuationLow: 28,
    valuationMid: 32,
    valuationHigh: 36,
    valuationConfidence: 'very_high',
    expectedSellingPrice: 32,
    expectedNet: 27,
    expectedProfit: 23,
    saleProb30d: 0.88,
    attributes: {
      country: 'United States',
      year: 2020,
      denomination: 'Dollar (Eagle)',
      composition: 'Silver .999',
      weight_troy_oz: 1,
      weight_g: 31.1,
      grade: 'BU',
      spot_silver_component: 26.80,
    },
    media: [],
    warnings: [],
    tags: ['silver', 'bullion', 'american_eagle', 'us_coins'],
    acquiredCost: 4,
    createdAt: '2026-09-04T16:00:00Z',
    updatedAt: '2026-09-04T16:15:00Z',
  },
  {
    id: 'item_007',
    tenantId: 'tenant_001',
    acquisitionId: 'acq_001',
    canonicalTitle: 'Bundle: Pre-decimal Halfpennies x50',
    description: 'Mixed lot of 50 pre-decimal British halfpennies. Dates range from 1900–1967. General circulated condition.',
    specialistId: 'coins',
    status: 'listed',
    dispositionDecision: 'bundle',
    condition: 'Circulated',
    conditionNotes: 'Mixed grades Fine to VF.',
    identificationConfidence: 0.95,
    identificationSource: 'user_confirmed',
    valuationLow: 8,
    valuationMid: 12,
    valuationHigh: 18,
    valuationConfidence: 'high',
    expectedSellingPrice: 11,
    expectedNet: 8,
    expectedProfit: 7,
    saleProb30d: 0.82,
    attributes: {
      country: 'Great Britain',
      denomination: 'Halfpenny',
      quantity: 50,
      date_range: '1900–1967',
      grade_range: 'F–VF',
      bundled_item_count: 50,
    },
    media: [],
    warnings: [],
    tags: ['pre_decimal', 'halfpenny', 'bundle', 'bulk', 'joblot'],
    acquiredCost: 1,
    createdAt: '2026-09-03T14:00:00Z',
    updatedAt: '2026-09-07T16:00:00Z',
  },
];

// ─── Mock Business Metrics ────────────────────────────────────────────────────
export const MOCK_METRICS: BusinessMetrics = {
  tenantId: 'tenant_001',
  period: '2026-09',
  totalAcquisitions: 3,
  totalItems: 1143,
  listedItems: 275,
  soldItems: 99,
  totalRevenue: 4280,
  totalFees: 546,
  totalShipping: 312,
  totalLabour: 880,
  totalProfit: 1635,
  averageROI: 0.42,
  averageMargin: 0.38,
  capitalInvested: 7400,
  capitalTiedUp: 5160,
  cashAvailable: 2240,
  predictionAccuracy: 0.74,
  sellThroughRate: 0.36,
  averageTimeToSale: 8.4,
  profitPerLabourHour: 29.20,
  topPerformingSpecialist: 'coins',
  staleItemCount: 23,
  exceptionCount: 4,
};

// ─── Mock AI Insights ─────────────────────────────────────────────────────────
export const MOCK_INSIGHTS: AIInsight[] = [
  {
    id: 'insight_001',
    type: 'warning',
    priority: 'critical',
    title: 'Authentication Required — Key Date Coin',
    detail: '1916-D Mercury Dime (item_003) requires expert authentication before listing. Current estimate £680–£1,400. Cleaning suspected.',
    action: 'review_item',
    actionLabel: 'Review Item',
    estimatedValue: 850,
    confidence: 'medium',
    createdAt: '2026-09-09T08:00:00Z',
  },
  {
    id: 'insight_002',
    type: 'recommendation',
    priority: 'high',
    title: '137 Items Unprocessed — Est. £3,200 Value',
    detail: 'Chesterfield Estate acquisition has 137 unprocessed items. AI estimates £3,200+ recoverable value remaining. Process coin sub-collection first (highest ROI per hour).',
    action: 'open_acquisition',
    actionLabel: 'View Acquisition',
    estimatedValue: 3200,
    confidence: 'medium',
    createdAt: '2026-09-09T08:05:00Z',
  },
  {
    id: 'insight_003',
    type: 'opportunity',
    priority: 'high',
    title: 'Silver Spot Price +4.2% — 23 Items Affected',
    detail: 'Silver spot price has risen 4.2% this week. 23 of your listed silver items may be underpriced. Recommend repricing 14 items immediately.',
    action: 'reprice_silver',
    actionLabel: 'Review Pricing',
    estimatedValue: 180,
    confidence: 'high',
    createdAt: '2026-09-09T07:30:00Z',
  },
  {
    id: 'insight_004',
    type: 'performance',
    priority: 'medium',
    title: 'Coins Specialist Predictions: 74% Accurate',
    detail: 'Coin valuations are accurate to within 15% on 74% of transactions. Silver valuations are performing better at 81%. Jewellery predictions are less reliable — only 58% accuracy.',
    confidence: 'high',
    createdAt: '2026-09-09T06:00:00Z',
  },
  {
    id: 'insight_005',
    type: 'recommendation',
    priority: 'medium',
    title: 'Bundle Opportunity: 48 Low-Value Coins',
    detail: 'SWISH identified 48 items with expected individual sale price under £3. Bundled as 3–4 job lots, estimated combined value increases from £68 to £140.',
    action: 'create_bundles',
    actionLabel: 'Create Bundles',
    estimatedValue: 72,
    confidence: 'medium',
    createdAt: '2026-09-09T07:00:00Z',
  },
  {
    id: 'insight_006',
    type: 'anomaly',
    priority: 'medium',
    title: 'Stale Stock Alert — 23 Items > 14 Days',
    detail: '23 items have been active for more than 14 days without a sale. Review pricing strategy or consider moving to alternative marketplaces.',
    action: 'review_stale',
    actionLabel: 'Review Stale Stock',
    confidence: 'high',
    createdAt: '2026-09-09T08:15:00Z',
  },
];
