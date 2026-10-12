// SWISH Business Config Service
// Manages the owner's operating parameters: capital, goals, risk, automation permissions.

import { getSupabaseClient } from '@/template';

export interface BusinessConfig {
  id: string;
  tenantId: string;
  // Capital & Goals
  startingCapital: number;
  availableCapital: number;
  targetCapital: number | null;
  targetProfit: number | null;
  targetTimeframeMonths: number | null;
  timeframeStartDate: string;
  // Risk & Operations
  riskTolerance: 'low' | 'medium' | 'high' | 'aggressive';
  weeklyHoursAvailable: number;
  maxSingleAcquisition: number;
  maxTotalDeployment: number | null;
  autonomousSpendingLimit: number;
  // Automation
  automationLevel: 'manual' | 'assisted' | 'one_click' | 'auto_approval' | 'autonomous';
  autoIdentify: boolean;
  autoResearch: boolean;
  autoValue: boolean;
  autoList: boolean;
  autoPublish: boolean;
  autoReprice: boolean;
  autoAcquire: boolean;
  // Categories
  preferredCategories: string[];
  prohibitedCategories: string[];
  preferredMarketplaces: string[];
  // Geo & Currency
  geography: string;
  currency: string;
  // Thresholds
  minROIThreshold: number;
  minMarginThreshold: number;
  highValueThreshold: number;
  // Shipping defaults
  defaultShippingCost: number;
  // Onboarding
  onboardingComplete: boolean;
  setupStep: number;
  createdAt: string;
  updatedAt: string;
}

function mapConfig(row: any): BusinessConfig {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    startingCapital: Number(row.starting_capital ?? 0),
    availableCapital: Number(row.available_capital ?? 0),
    targetCapital: row.target_capital ? Number(row.target_capital) : null,
    targetProfit: row.target_profit ? Number(row.target_profit) : null,
    targetTimeframeMonths: row.target_timeframe_months ?? null,
    timeframeStartDate: row.timeframe_start_date ?? '',
    riskTolerance: (row.risk_tolerance ?? 'medium') as BusinessConfig['riskTolerance'],
    weeklyHoursAvailable: Number(row.weekly_hours_available ?? 5),
    maxSingleAcquisition: Number(row.max_single_acquisition ?? 500),
    maxTotalDeployment: row.max_total_deployment ? Number(row.max_total_deployment) : null,
    autonomousSpendingLimit: Number(row.autonomous_spending_limit ?? 100),
    automationLevel: (row.automation_level ?? 'assisted') as BusinessConfig['automationLevel'],
    autoIdentify: row.auto_identify ?? true,
    autoResearch: row.auto_research ?? true,
    autoValue: row.auto_value ?? true,
    autoList: row.auto_list ?? false,
    autoPublish: row.auto_publish ?? false,
    autoReprice: row.auto_reprice ?? false,
    autoAcquire: row.auto_acquire ?? false,
    preferredCategories: row.preferred_categories ?? [],
    prohibitedCategories: row.prohibited_categories ?? [],
    preferredMarketplaces: row.preferred_marketplaces ?? ['ebay'],
    geography: row.geography ?? 'GB',
    currency: row.currency ?? 'GBP',
    minROIThreshold: Number(row.min_roi_threshold ?? 0.30),
    minMarginThreshold: Number(row.min_margin_threshold ?? 0.20),
    highValueThreshold: Number(row.high_value_threshold ?? 100),
    defaultShippingCost: Number(row.default_shipping_cost ?? 0),
    onboardingComplete: row.onboarding_complete ?? false,
    setupStep: row.setup_step ?? 0,
    createdAt: row.created_at ?? '',
    updatedAt: row.updated_at ?? '',
  };
}

export async function getBusinessConfig(
  tenantId: string
): Promise<{ config: BusinessConfig | null; error: string | null }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('business_config')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error) return { config: null, error: error.message };
  if (!data) return { config: null, error: null };
  return { config: mapConfig(data), error: null };
}

export async function upsertBusinessConfig(
  tenantId: string,
  updates: Partial<Omit<BusinessConfig, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>>
): Promise<{ config: BusinessConfig | null; error: string | null }> {
  const supabase = getSupabaseClient();

  const dbData: Record<string, any> = { tenant_id: tenantId };
  const fieldMap: Record<string, string> = {
    startingCapital: 'starting_capital',
    availableCapital: 'available_capital',
    targetCapital: 'target_capital',
    targetProfit: 'target_profit',
    targetTimeframeMonths: 'target_timeframe_months',
    riskTolerance: 'risk_tolerance',
    weeklyHoursAvailable: 'weekly_hours_available',
    maxSingleAcquisition: 'max_single_acquisition',
    maxTotalDeployment: 'max_total_deployment',
    autonomousSpendingLimit: 'autonomous_spending_limit',
    automationLevel: 'automation_level',
    autoIdentify: 'auto_identify',
    autoResearch: 'auto_research',
    autoValue: 'auto_value',
    autoList: 'auto_list',
    autoPublish: 'auto_publish',
    autoReprice: 'auto_reprice',
    autoAcquire: 'auto_acquire',
    preferredCategories: 'preferred_categories',
    prohibitedCategories: 'prohibited_categories',
    preferredMarketplaces: 'preferred_marketplaces',
    geography: 'geography',
    currency: 'currency',
    minROIThreshold: 'min_roi_threshold',
    minMarginThreshold: 'min_margin_threshold',
    highValueThreshold: 'high_value_threshold',
    defaultShippingCost: 'default_shipping_cost',
    onboardingComplete: 'onboarding_complete',
    setupStep: 'setup_step',
  };

  Object.entries(updates).forEach(([key, val]) => {
    const dbKey = fieldMap[key];
    if (dbKey && val !== undefined) dbData[dbKey] = val;
  });

  const { data, error } = await supabase
    .from('business_config')
    .upsert(dbData, { onConflict: 'tenant_id' })
    .select()
    .single();

  if (error) return { config: null, error: error.message };
  return { config: mapConfig(data), error: null };
}

// Compute goal progress
export function computeGoalProgress(config: BusinessConfig, currentCapital: number): {
  progressPct: number;
  capitalGrowth: number;
  daysElapsed: number;
  daysRemaining: number;
  onTrack: boolean;
  projectedFinalCapital: number;
} {
  const startCapital = config.startingCapital || 1;
  const targetCapital = config.targetCapital ?? (startCapital * 2.5);
  const capitalGrowth = currentCapital - startCapital;
  const progressPct = Math.min(100, Math.max(0, (capitalGrowth / (targetCapital - startCapital)) * 100));

  const startDate = new Date(config.timeframeStartDate || config.createdAt);
  const now = new Date();
  const totalDays = (config.targetTimeframeMonths ?? 6) * 30;
  const daysElapsed = Math.max(0, Math.floor((now.getTime() - startDate.getTime()) / 86400000));
  const daysRemaining = Math.max(0, totalDays - daysElapsed);

  // Linear projection
  const dailyGrowthRate = daysElapsed > 0 ? capitalGrowth / daysElapsed : 0;
  const projectedFinalCapital = currentCapital + dailyGrowthRate * daysRemaining;
  const onTrack = projectedFinalCapital >= targetCapital;

  return { progressPct, capitalGrowth, daysElapsed, daysRemaining, onTrack, projectedFinalCapital };
}
