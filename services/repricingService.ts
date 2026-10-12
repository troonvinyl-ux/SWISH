// SWISH Repricing Service
// Manages repricing rules, AI-driven price suggestions, and listing price updates.

import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { SavedListing } from './listingService';

// ── Types ─────────────────────────────────────────────────────────────────────

export type RuleType = 'time_decay' | 'watchers_based' | 'competition' | 'manual';

export interface RepricingRule {
  id: string;
  tenantId: string;
  listingId?: string;
  itemId?: string;
  ruleType: RuleType;
  triggerCondition: Record<string, any>;
  floorPrice?: number;
  ceilingPrice?: number;
  isActive: boolean;
  lastAppliedAt?: string;
  createdAt: string;
}

export interface RepriceSuggestion {
  listingId: string;
  itemId: string;
  itemTitle: string;
  currentPrice: number;
  suggestedPrice: number;
  floorPrice: number;
  ceilingPrice: number;
  priceChangePct: number;
  strategy: string;
  rationale: string;
  confidence: 'high' | 'medium' | 'low';
  urgency: 'immediate' | 'soon' | 'monitor';
  estimatedSaleProbabilityUplift: number;
  // local context
  daysListed: number;
  views: number;
  watchers: number;
}

export interface StaleListingInfo extends SavedListing {
  itemTitle: string;
  daysListed: number;
  specialistId: string;
}

// ── RULE TEMPLATES ────────────────────────────────────────────────────────────

export const RULE_TEMPLATES: Array<{
  id: string;
  name: string;
  description: string;
  ruleType: RuleType;
  icon: string;
  defaultCondition: Record<string, any>;
}> = [
  {
    id: 'time_decay_7',
    name: '7-Day Reduction',
    description: 'Reduce price by 5% if no sale after 7 days.',
    ruleType: 'time_decay',
    icon: 'schedule',
    defaultCondition: { days_listed: 7, action: 'reduce_by_pct', value: 5 },
  },
  {
    id: 'time_decay_14',
    name: '14-Day Reduction',
    description: 'Reduce price by 10% if no sale after 14 days.',
    ruleType: 'time_decay',
    icon: 'access-time',
    defaultCondition: { days_listed: 14, action: 'reduce_by_pct', value: 10 },
  },
  {
    id: 'time_decay_21',
    name: '21-Day Reduction',
    description: 'Reduce price by 15% after 21 days listed.',
    ruleType: 'time_decay',
    icon: 'timer-off',
    defaultCondition: { days_listed: 21, action: 'reduce_by_pct', value: 15 },
  },
  {
    id: 'watchers_5',
    name: 'Watchers Trigger',
    description: 'Reduce by 8% when 5+ watchers show no purchase (price is barrier).',
    ruleType: 'watchers_based',
    icon: 'visibility',
    defaultCondition: { min_watchers: 5, days_since_watcher: 3, action: 'reduce_by_pct', value: 8 },
  },
  {
    id: 'ai_reprice',
    name: 'AI Smart Reprice',
    description: 'Use OnSpace AI to analyse performance and suggest optimal repricing.',
    ruleType: 'competition',
    icon: 'auto-awesome',
    defaultCondition: { use_ai: true, trigger_days: 7 },
  },
];

// ── Mapper ────────────────────────────────────────────────────────────────────

function mapRule(row: any): RepricingRule {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    listingId: row.listing_id ?? undefined,
    itemId: row.item_id ?? undefined,
    ruleType: row.rule_type as RuleType,
    triggerCondition: row.trigger_condition ?? {},
    floorPrice: row.floor_price !== null ? Number(row.floor_price) : undefined,
    ceilingPrice: row.ceiling_price !== null ? Number(row.ceiling_price) : undefined,
    isActive: row.is_active ?? true,
    lastAppliedAt: row.last_applied_at ?? undefined,
    createdAt: row.created_at,
  };
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function listRepricingRules(
  tenantId: string
): Promise<{ rules: RepricingRule[]; error: string | null }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('repricing_rules')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  if (error) return { rules: [], error: error.message };
  return { rules: (data ?? []).map(mapRule), error: null };
}

export async function createRepricingRule(
  tenantId: string,
  input: {
    ruleType: RuleType;
    triggerCondition: Record<string, any>;
    floorPrice?: number;
    ceilingPrice?: number;
    listingId?: string;
    itemId?: string;
  }
): Promise<{ rule: RepricingRule | null; error: string | null }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('repricing_rules')
    .insert({
      tenant_id: tenantId,
      rule_type: input.ruleType,
      trigger_condition: input.triggerCondition,
      floor_price: input.floorPrice ?? null,
      ceiling_price: input.ceilingPrice ?? null,
      listing_id: input.listingId ?? null,
      item_id: input.itemId ?? null,
      is_active: true,
    })
    .select()
    .single();

  if (error) return { rule: null, error: error.message };
  return { rule: mapRule(data), error: null };
}

export async function toggleRepricingRule(
  ruleId: string,
  isActive: boolean
): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('repricing_rules')
    .update({ is_active: isActive })
    .eq('id', ruleId);
  return { error: error?.message ?? null };
}

export async function deleteRepricingRule(ruleId: string): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('repricing_rules').delete().eq('id', ruleId);
  return { error: error?.message ?? null };
}

// ── Stale Listing Detection ───────────────────────────────────────────────────

export async function getStaleListings(
  tenantId: string,
  staleDays = 7
): Promise<{ listings: StaleListingInfo[]; error: string | null }> {
  const supabase = getSupabaseClient();
  const staleDate = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('listings')
    .select(`
      *,
      items (canonical_title, specialist_id, status)
    `)
    .eq('tenant_id', tenantId)
    .in('status', ['active', 'published', 'draft'])
    .lt('updated_at', staleDate)
    .order('updated_at', { ascending: true })
    .limit(50);

  if (error) return { listings: [], error: error.message };

  const listings: StaleListingInfo[] = (data ?? []).map(row => {
    const listedDate = row.published_at ?? row.created_at;
    const daysListed = listedDate
      ? Math.floor((Date.now() - new Date(listedDate).getTime()) / (1000 * 60 * 60 * 24))
      : 0;
    return {
      id: row.id,
      itemId: row.item_id,
      tenantId: row.tenant_id,
      marketplaceId: row.marketplace_id,
      externalListingId: row.external_listing_id ?? undefined,
      title: row.title,
      description: row.description ?? '',
      price: Number(row.price ?? 0),
      floorPrice: Number(row.floor_price ?? 0),
      ceilingPrice: Number(row.ceiling_price ?? 0),
      status: row.status ?? 'draft',
      views: row.views ?? 0,
      watchers: row.watchers ?? 0,
      publishedAt: row.published_at ?? undefined,
      endedAt: row.ended_at ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      itemTitle: row.items?.canonical_title ?? 'Unknown Item',
      daysListed,
      specialistId: row.items?.specialist_id ?? 'general',
    };
  });

  return { listings, error: null };
}

// ── AI Reprice via Edge Function ──────────────────────────────────────────────

export async function getAIRepriceSuggestion(
  listingId: string,
  tenantId: string
): Promise<{ suggestion: Omit<RepriceSuggestion, 'itemTitle' | 'daysListed' | 'views' | 'watchers'> | null; error: string | null }> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase.functions.invoke('swish-reprice', {
    body: { listing_id: listingId, tenant_id: tenantId },
  });

  if (error) {
    let message = error.message;
    if (error instanceof FunctionsHttpError) {
      try {
        const statusCode = error.context?.status ?? 500;
        const text = await error.context?.text();
        message = `[${statusCode}] ${text || error.message}`;
      } catch {
        message = error.message;
      }
    }
    return { suggestion: null, error: message };
  }

  const r = data?.result;
  if (!r) return { suggestion: null, error: 'No result from AI' };

  return {
    suggestion: {
      listingId: r.listing_id,
      itemId: r.item_id,
      currentPrice: r.current_price,
      suggestedPrice: r.suggested_price,
      floorPrice: r.floor_price,
      ceilingPrice: r.ceiling_price,
      priceChangePct: r.price_change_pct,
      strategy: r.strategy,
      rationale: r.rationale,
      confidence: r.confidence,
      urgency: r.urgency,
      estimatedSaleProbabilityUplift: r.estimated_sale_probability_uplift,
    },
    error: null,
  };
}

// ── Apply Price Update ────────────────────────────────────────────────────────

export async function applyReprice(
  listingId: string,
  newPrice: number
): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('listings')
    .update({
      price: newPrice,
      updated_at: new Date().toISOString(),
    })
    .eq('id', listingId);
  return { error: error?.message ?? null };
}

// ── Scan & create exceptions for stale listings ───────────────────────────────

export async function scanForStaleListingExceptions(tenantId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { listings } = await getStaleListings(tenantId, 7);
  if (listings.length === 0) return;

  // Check if repricing exception already exists
  const { count } = await supabase
    .from('exceptions')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('exception_type', 'stale_listings_reprice')
    .eq('is_resolved', false);

  if ((count ?? 0) === 0) {
    await supabase.from('exceptions').insert({
      tenant_id: tenantId,
      exception_type: 'stale_listings_reprice',
      severity: listings.length > 10 ? 'high' : 'medium',
      title: `${listings.length} listing${listings.length === 1 ? '' : 's'} may need repricing`,
      detail: `${listings.length} listing${listings.length === 1 ? ' has' : 's have'} been active for 7+ days without a sale. AI repricing suggestions are available.`,
      entity_type: 'listing',
      recommended_action: 'open_inventory',
      action_label: 'Review & Reprice',
      auto_resolvable: true,
    });
  }
}

// ── Confidence colour helper ──────────────────────────────────────────────────

export const REPRICE_STRATEGY_LABELS: Record<string, string> = {
  reduce_5pct: '−5%',
  reduce_10pct: '−10%',
  reduce_15pct: '−15%',
  reduce_20pct: '−20%',
  hold: 'Hold',
  increase_5pct: '+5%',
  relist: 'Relist',
};

export const URGENCY_CONFIG: Record<RepriceSuggestion['urgency'], { color: string; label: string }> = {
  immediate: { color: '#EF4444', label: 'Act Now' },
  soon: { color: '#F59E0B', label: 'Soon' },
  monitor: { color: '#06B6D4', label: 'Monitor' },
};
