// SWISH Opportunity Service
// Acquisition intelligence — find, assess, rank, and approve buying opportunities.
//
// NOTE: seedDemoOpportunities has been permanently removed.
// New subscribers see an honest empty state, never fabricated data.

import { getSupabaseClient } from '@/template';

export interface Opportunity {
  id: string;
  tenantId: string;
  title: string;
  description: string;
  source: string;
  sourceUrl?: string;
  askingPrice: number;
  maxRecommendedPrice: number;
  estimatedItemCount: number;
  estimatedGrossRevenue: number;
  estimatedNetRevenue: number;
  estimatedProfit: number;
  estimatedROI: number;
  profitPerLabourHour: number;
  expectedTimeToClearDays: number;
  capitalRecoveryDays: number;
  riskScore: number; // 0=low 1=high
  confidence: string;
  categories: string[];
  location: string;
  requiresApproval: boolean;
  approvalStatus: 'pending' | 'approved' | 'rejected' | 'expired';
  status: 'open' | 'expired' | 'acquired' | 'rejected' | 'passed';
  expiresAt?: string;
  notes: string;
  aiAnalysis: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

function mapOpportunity(row: any): Opportunity {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    title: row.title,
    description: row.description ?? '',
    source: row.source ?? '',
    sourceUrl: row.source_url ?? undefined,
    askingPrice: Number(row.asking_price ?? 0),
    maxRecommendedPrice: Number(row.max_recommended_price ?? 0),
    estimatedItemCount: row.estimated_item_count ?? 0,
    estimatedGrossRevenue: Number(row.estimated_gross_revenue ?? 0),
    estimatedNetRevenue: Number(row.estimated_net_revenue ?? 0),
    estimatedProfit: Number(row.estimated_profit ?? 0),
    estimatedROI: Number(row.estimated_roi ?? 0),
    profitPerLabourHour: Number(row.profit_per_labour_hour ?? 0),
    expectedTimeToClearDays: row.expected_time_to_clear_days ?? 30,
    capitalRecoveryDays: row.capital_recovery_days ?? 45,
    riskScore: Number(row.risk_score ?? 0.5),
    confidence: row.confidence ?? 'medium',
    categories: row.categories ?? [],
    location: row.location ?? '',
    requiresApproval: row.requires_approval ?? false,
    approvalStatus: (row.approval_status ?? 'pending') as Opportunity['approvalStatus'],
    status: (row.status ?? 'open') as Opportunity['status'],
    expiresAt: row.expires_at ?? undefined,
    notes: row.notes ?? '',
    aiAnalysis: row.ai_analysis ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listOpportunities(
  tenantId: string,
  status?: string
): Promise<{ opportunities: Opportunity[]; error: string | null }> {
  const supabase = getSupabaseClient();
  let query = supabase
    .from('opportunities')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('estimated_roi', { ascending: false });

  if (status) {
    query = query.eq('status', status);
  } else {
    query = query.in('status', ['open', 'expired']);
  }

  const { data, error } = await query.limit(50);
  if (error) return { opportunities: [], error: error.message };
  return { opportunities: (data ?? []).map(mapOpportunity), error: null };
}

export async function createOpportunity(
  tenantId: string,
  input: Partial<Opportunity> & { title: string; askingPrice: number; autonomousSpendingLimit?: number }
): Promise<{ opportunity: Opportunity | null; error: string | null }> {
  const supabase = getSupabaseClient();

  // Calculate max recommended price from ROI target
  const targetROI = 0.3;
  const estimatedNet = input.estimatedNetRevenue ?? input.estimatedGrossRevenue ?? input.askingPrice * 2;
  const maxPrice = Math.floor(estimatedNet / (1 + targetROI));

  const requiresApproval = input.askingPrice > (input.autonomousSpendingLimit ?? 100);

  const { data, error } = await supabase
    .from('opportunities')
    .insert({
      tenant_id: tenantId,
      title: input.title,
      description: input.description ?? '',
      source: input.source ?? 'Manual',
      asking_price: input.askingPrice,
      max_recommended_price: input.maxRecommendedPrice ?? maxPrice,
      estimated_item_count: input.estimatedItemCount ?? 0,
      estimated_gross_revenue: input.estimatedGrossRevenue ?? 0,
      estimated_net_revenue: input.estimatedNetRevenue ?? 0,
      estimated_profit: input.estimatedProfit ?? 0,
      estimated_roi: input.estimatedROI ?? 0,
      profit_per_labour_hour: input.profitPerLabourHour ?? 0,
      expected_time_to_clear_days: input.expectedTimeToClearDays ?? 30,
      capital_recovery_days: input.capitalRecoveryDays ?? 45,
      risk_score: input.riskScore ?? 0.5,
      confidence: input.confidence ?? 'medium',
      categories: input.categories ?? [],
      location: input.location ?? '',
      requires_approval: requiresApproval,
      approval_status: requiresApproval ? 'pending' : 'approved',
      notes: input.notes ?? '',
      ai_analysis: input.aiAnalysis ?? {},
    })
    .select()
    .single();

  if (error) return { opportunity: null, error: error.message };
  return { opportunity: mapOpportunity(data), error: null };
}

export async function updateOpportunityStatus(
  id: string,
  status: Opportunity['status'],
  approvalStatus?: Opportunity['approvalStatus']
): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient();
  const updates: Record<string, any> = { status };
  if (approvalStatus) updates.approval_status = approvalStatus;
  const { error } = await supabase.from('opportunities').update(updates).eq('id', id);
  return { error: error?.message ?? null };
}

// Score and rank an opportunity against business config
export function scoreOpportunity(opp: Opportunity, config: {
  minROI: number;
  maxSingleAcquisition: number;
  autonomousSpendingLimit: number;
  riskTolerance: string;
}): {
  score: number; // 0-100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  verdict: string;
  flags: string[];
  requiresApproval: boolean;
} {
  const flags: string[] = [];
  let score = 50;

  // ROI scoring
  const roiPct = opp.estimatedROI * 100;
  if (roiPct >= 100) score += 25;
  else if (roiPct >= 50) score += 15;
  else if (roiPct >= config.minROI * 100) score += 5;
  else { score -= 20; flags.push(`ROI ${roiPct.toFixed(0)}% below ${(config.minROI * 100).toFixed(0)}% target`); }

  // Risk scoring
  if (opp.riskScore > 0.7) { score -= 20; flags.push('High risk acquisition'); }
  else if (opp.riskScore < 0.3) score += 10;

  // Speed scoring
  if (opp.expectedTimeToClearDays <= 30) score += 10;
  else if (opp.expectedTimeToClearDays > 90) { score -= 10; flags.push('Long capital lock-up'); }

  // Price check
  if (opp.askingPrice > config.maxSingleAcquisition) {
    flags.push(`Asking price exceeds £${config.maxSingleAcquisition} limit`);
    score -= 15;
  }

  // Profit per hour
  if (opp.profitPerLabourHour >= 30) score += 10;
  else if (opp.profitPerLabourHour < 10) { score -= 5; flags.push('Low profit per hour'); }

  score = Math.max(0, Math.min(100, score));
  const grade = score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : score >= 35 ? 'D' : 'F';
  const verdict = grade === 'A' ? 'Strong buy opportunity'
    : grade === 'B' ? 'Good opportunity'
    : grade === 'C' ? 'Borderline — review carefully'
    : grade === 'D' ? 'Weak opportunity'
    : 'Not recommended';

  const requiresApproval = opp.askingPrice > config.autonomousSpendingLimit;

  return { score, grade, verdict, flags, requiresApproval };
}
