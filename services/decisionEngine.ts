// SWISH Autonomous Decision Engine
// Every autonomous action: records the decision, reasoning, rules applied,
// financial impact, permission used, execution result, and outcome.
// "Why did SWISH do this?" must always be answerable.

import { getSupabaseClient } from '@/template';
import { BusinessConfig } from './businessConfigService';
import { AutonomyControls } from './autonomyService';
import { Opportunity } from './opportunityService';

// ── Types ─────────────────────────────────────────────────────────────────────

export type DecisionType =
  | 'buy'
  | 'reject'
  | 'escalate'
  | 'list'
  | 'reprice'
  | 'publish'
  | 'fulfil'
  | 'reinvest'
  | 'bundle'
  | 'decompose'
  | 'hold'
  | 'scrap';

export type DecisionOutcome = 'BUY' | 'REJECT' | 'ESCALATE' | 'PENDING_APPROVAL';

export interface AutonomousDecision {
  id: string;
  tenantId: string;
  decisionType: DecisionType;
  decision: DecisionOutcome;
  entityType: string;
  entityId?: string;
  inputs: Record<string, any>;
  rulesApplied: Record<string, any>;
  reasoning: string;
  confidence: string;
  financialImpact: number;
  permissionUsed?: string;
  executed: boolean;
  executionResult?: string;
  executionError?: string;
  executedAt?: string;
  requiresApproval: boolean;
  approvedBy?: string;
  approvedAt?: string;
  rejectionReason?: string;
  createdAt: string;
}

function mapDecision(row: any): AutonomousDecision {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    decisionType: row.decision_type,
    decision: row.decision,
    entityType: row.entity_type,
    entityId: row.entity_id ?? undefined,
    inputs: row.inputs ?? {},
    rulesApplied: row.rules_applied ?? {},
    reasoning: row.reasoning ?? '',
    confidence: row.confidence ?? 'medium',
    financialImpact: Number(row.financial_impact ?? 0),
    permissionUsed: row.permission_used ?? undefined,
    executed: row.executed ?? false,
    executionResult: row.execution_result ?? undefined,
    executionError: row.execution_error ?? undefined,
    executedAt: row.executed_at ?? undefined,
    requiresApproval: row.requires_approval ?? false,
    approvedBy: row.approved_by ?? undefined,
    approvedAt: row.approved_at ?? undefined,
    rejectionReason: row.rejection_reason ?? undefined,
    createdAt: row.created_at,
  };
}

// ── Core Acquisition Decision Logic ──────────────────────────────────────────

export interface AcquisitionDecisionInput {
  title: string;
  askingPrice: number;
  estimatedProfit: number;
  estimatedROI: number;
  confidence: string;
  riskScore: number;
  categories: string[];
  itemCount?: number;
  decompositionUplift?: number;
  prizeItemsValue?: number;
  marketplaceId?: string;
}

export interface AcquisitionDecisionResult {
  decision: DecisionOutcome;
  reasoning: string;
  maxRecommendedPrice: number;
  rulesApplied: string[];
  blockers: string[];
  warnings: string[];
  requiresApproval: boolean;
  approvalReason?: string;
  financialImpact: number;
}

export function evaluateAcquisitionDecision(
  input: AcquisitionDecisionInput,
  config: BusinessConfig | null,
  controls: AutonomyControls | null
): AcquisitionDecisionResult {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const rulesApplied: string[] = [];
  let requiresApproval = false;
  let approvalReason: string | undefined;

  const availableCapital = config?.availableCapital ?? 0;
  const autonomousLimit = config?.autonomousSpendingLimit ?? 100;
  const maxSingleAcquisition = config?.maxSingleAcquisition ?? 500;
  const minROI = config?.minROIThreshold ?? 0.30;
  const riskTolerance = config?.riskTolerance ?? 'medium';
  const prohibitedCategories = config?.prohibitedCategories ?? [];
  const preferredCategories = config?.preferredCategories ?? [];
  const minMargin = config?.minMarginThreshold ?? 0.20;

  // ── HARD BLOCKS ────────────────────────────────────────────────────────────

  // 1. Autonomy kill switch
  if (controls?.globalPause) {
    blockers.push('All autonomy is paused');
    rulesApplied.push('global_kill_switch');
  }
  if (controls?.acquisitionPaused) {
    blockers.push('Acquisition autonomy is paused');
    rulesApplied.push('acquisition_kill_switch');
  }

  // 2. Insufficient capital
  if (input.askingPrice > availableCapital) {
    blockers.push(`Insufficient capital: asking £${input.askingPrice.toFixed(0)} but only £${availableCapital.toFixed(0)} available`);
    rulesApplied.push('capital_check');
  }

  // 3. Exceeds maximum single acquisition
  if (input.askingPrice > maxSingleAcquisition) {
    blockers.push(`Exceeds max single acquisition limit of £${maxSingleAcquisition}`);
    rulesApplied.push('max_single_acquisition_limit');
    requiresApproval = true;
    approvalReason = `Asking price £${input.askingPrice.toFixed(0)} exceeds autonomous limit of £${maxSingleAcquisition}`;
  }

  // 4. Prohibited categories
  const hasProhibited = input.categories.some(c => prohibitedCategories.includes(c));
  if (hasProhibited) {
    blockers.push(`Contains prohibited category: ${input.categories.filter(c => prohibitedCategories.includes(c)).join(', ')}`);
    rulesApplied.push('prohibited_categories');
  }

  // 5. Low confidence
  if (input.confidence === 'low' || input.confidence === 'very_low') {
    blockers.push('Confidence too low for autonomous acquisition');
    rulesApplied.push('minimum_confidence');
    requiresApproval = true;
    approvalReason = approvalReason ?? 'Low confidence requires human review';
  }

  // ── THRESHOLD CHECKS (SOFT) ────────────────────────────────────────────────

  // ROI below threshold
  if (input.estimatedROI < minROI) {
    warnings.push(`ROI ${(input.estimatedROI * 100).toFixed(0)}% below minimum ${(minROI * 100).toFixed(0)}%`);
    rulesApplied.push('min_roi_threshold');
  }

  // High risk
  const maxRisk = riskTolerance === 'low' ? 0.3 : riskTolerance === 'medium' ? 0.6 : riskTolerance === 'high' ? 0.8 : 1.0;
  if (input.riskScore > maxRisk) {
    warnings.push(`Risk score ${(input.riskScore * 100).toFixed(0)}% exceeds tolerance (${(maxRisk * 100).toFixed(0)}%)`);
    rulesApplied.push('risk_tolerance');
    if (input.riskScore > 0.8) {
      blockers.push('Risk score too high for autonomous purchase');
      requiresApproval = true;
      approvalReason = approvalReason ?? 'High risk requires human approval';
    }
  }

  // ── APPROVAL GATE ──────────────────────────────────────────────────────────

  // Above autonomous spending limit but within max single acquisition
  if (input.askingPrice > autonomousLimit && input.askingPrice <= maxSingleAcquisition) {
    rulesApplied.push('autonomous_spending_limit');
    requiresApproval = true;
    approvalReason = approvalReason ?? `Above autonomous limit of £${autonomousLimit} — approval required`;
  }

  // Preferred category bonus
  const hasPreferred = input.categories.some(c => preferredCategories.includes(c));
  if (hasPreferred) rulesApplied.push('preferred_category_bonus');

  // ── COMPUTE MAXIMUM RECOMMENDED PRICE ────────────────────────────────────

  // Max price = expected net revenue × (1 - minMargin)
  const expectedNetRevenue = input.estimatedProfit + input.askingPrice;
  const maxRecommendedPrice = expectedNetRevenue * (1 - minMargin);

  // ── DECISION ───────────────────────────────────────────────────────────────

  let decision: DecisionOutcome;
  let reasoning: string;

  if (blockers.length > 0 && !requiresApproval) {
    decision = 'REJECT';
    reasoning = `REJECTED: ${blockers.join('; ')}`;
  } else if (requiresApproval) {
    decision = 'ESCALATE';
    reasoning = `NEEDS APPROVAL: ${approvalReason ?? 'Manual review required'}. ${warnings.length > 0 ? `Warnings: ${warnings.join('; ')}` : ''}`;
  } else if (input.estimatedROI >= minROI && input.riskScore <= maxRisk) {
    decision = 'BUY';
    reasoning = `APPROVED: ROI ${(input.estimatedROI * 100).toFixed(0)}% meets ${(minROI * 100).toFixed(0)}% minimum. Risk ${(input.riskScore * 100).toFixed(0)}% within tolerance. Est. profit £${input.estimatedProfit.toFixed(0)}.${input.decompositionUplift ? ` Decomposition uplift £${input.decompositionUplift.toFixed(0)}.` : ''}`;
  } else {
    decision = 'REJECT';
    reasoning = `REJECTED: Does not meet minimum criteria. ROI ${(input.estimatedROI * 100).toFixed(0)}% (min ${(minROI * 100).toFixed(0)}%). ${warnings.join('; ')}`;
  }

  return {
    decision,
    reasoning,
    maxRecommendedPrice,
    rulesApplied,
    blockers,
    warnings,
    requiresApproval,
    approvalReason,
    financialImpact: input.askingPrice,
  };
}

// ── Record decision to database ───────────────────────────────────────────────

export async function recordDecision(
  tenantId: string,
  decisionType: DecisionType,
  result: AcquisitionDecisionResult,
  input: AcquisitionDecisionInput,
  entityId?: string
): Promise<{ decision: AutonomousDecision | null; error: string | null }> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('autonomous_decisions')
    .insert({
      tenant_id: tenantId,
      decision_type: decisionType,
      decision: result.decision,
      entity_type: 'opportunity',
      entity_id: entityId ?? null,
      inputs: input,
      rules_applied: { rules: result.rulesApplied, blockers: result.blockers, warnings: result.warnings },
      reasoning: result.reasoning,
      confidence: input.confidence,
      financial_impact: result.financialImpact,
      requires_approval: result.requiresApproval,
      executed: false,
    })
    .select()
    .single();

  if (error) return { decision: null, error: error.message };
  return { decision: mapDecision(data), error: null };
}

// ── List recent decisions ─────────────────────────────────────────────────────

export async function listDecisions(
  tenantId: string,
  limit = 20
): Promise<{ decisions: AutonomousDecision[]; error: string | null }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('autonomous_decisions')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return { decisions: [], error: error.message };
  return { decisions: (data ?? []).map(mapDecision), error: null };
}

// ── Approve/reject a pending decision ────────────────────────────────────────

export async function approveDecision(
  decisionId: string,
  userId: string
): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('autonomous_decisions')
    .update({
      approved_by: userId,
      approved_at: new Date().toISOString(),
      decision: 'BUY',
    })
    .eq('id', decisionId);
  return { error: error?.message ?? null };
}

export async function rejectDecision(
  decisionId: string,
  reason: string
): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('autonomous_decisions')
    .update({
      rejection_reason: reason,
      decision: 'REJECT',
    })
    .eq('id', decisionId);
  return { error: error?.message ?? null };
}
