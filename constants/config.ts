// SWISH Platform Configuration

export const AppConfig = {
  name: 'SWISH',
  tagline: 'Commerce Intelligence Platform',
  version: '1.0.0',
  buildPhase: 'Foundation',
};

// Automation maturity levels
export type AutomationLevel = 'manual' | 'assisted' | 'one_click' | 'auto_approval' | 'autonomous';

// Confidence tiers
export type ConfidenceTier = 'very_high' | 'high' | 'medium' | 'low' | 'very_low' | 'unknown';

// Evidence source types
export type EvidenceSource = 'detected' | 'inferred' | 'researched' | 'user_confirmed' | 'verified' | 'unknown';

// Disposition options for the selling decision engine
export type DispositionDecision =
  | 'sell_individual'
  | 'bundle'
  | 'lot'
  | 'wholesale'
  | 'hold'
  | 'scrap'
  | 'precious_metal_recovery'
  | 'investigate'
  | 'human_review'
  | 'dispose';

// Item lifecycle status
export type ItemStatus =
  | 'captured'
  | 'identifying'
  | 'identified'
  | 'researching'
  | 'researched'
  | 'assessing'
  | 'assessed'
  | 'pricing'
  | 'priced'
  | 'listing'
  | 'listed'
  | 'active'
  | 'sold'
  | 'fulfilled'
  | 'completed'
  | 'held'
  | 'bundled'
  | 'wholesaled'
  | 'scrapped'
  | 'disposed'
  | 'error'
  | 'review_required';

// Marketplace IDs
export type MarketplaceId = 'ebay' | 'etsy' | 'amazon' | 'gumtree' | 'internal' | 'wholesale';

// Subscription tiers
export type SubscriptionTier = 'starter' | 'professional' | 'business' | 'enterprise';

// Action types for automation engine
export type ActionType =
  | 'identify'
  | 'research'
  | 'value'
  | 'decide_disposition'
  | 'create_listing'
  | 'publish_listing'
  | 'reprice'
  | 'promote'
  | 'relist'
  | 'pause_listing'
  | 'bundle'
  | 'update_status'
  | 'sync_marketplace'
  | 'fulfil_order'
  | 'record_sale'
  | 'flag_exception';

// Exception types
export type ExceptionType =
  | 'low_confidence_id'
  | 'suspected_counterfeit'
  | 'unusual_valuation'
  | 'high_value_item'
  | 'marketplace_failure'
  | 'unusual_price_movement'
  | 'negative_margin'
  | 'suspicious_transaction'
  | 'provenance_problem'
  | 'prediction_anomaly'
  | 'authentication_required';

export const CONFIDENCE_THRESHOLDS = {
  auto_publish: 0.90,
  auto_list: 0.80,
  assisted: 0.65,
  review_required: 0.50,
  manual_only: 0.00,
};

export const HIGH_VALUE_THRESHOLD = 100; // £ — items above this get extra scrutiny
export const EXCEPTIONAL_VALUE_THRESHOLD = 500; // £ — mandatory human review

export const PLATFORM_FEES: Record<MarketplaceId, number> = {
  ebay: 0.1275,   // ESTIMATE: eBay UK standard ~12.75% — actual fees vary by category, price tier and seller level
  etsy: 0.065,    // ESTIMATE: Etsy 6.5% transaction fee (plus £0.16 listing fee per item)
  amazon: 0.15,   // ESTIMATE: Amazon ~15% referral fee — varies significantly by category
  gumtree: 0.05,
  internal: 0.0,
  wholesale: 0.0,
};

// NOTE: PLATFORM_FEES are indicative estimates for profit projections.
// Always display as ESTIMATE in user-facing UI.
// Never present these as exact transaction costs.
// Use actual order.marketplace_fee for completed transaction calculations.
