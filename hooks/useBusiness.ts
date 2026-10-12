// SWISH Hooks: Business Config, Opportunities, Exceptions, Capital
import { useState, useEffect, useCallback } from 'react';
import { useApp } from './useApp';
import { BusinessConfig, getBusinessConfig, upsertBusinessConfig, computeGoalProgress } from '@/services/businessConfigService';
import { Opportunity, listOpportunities, createOpportunity, updateOpportunityStatus, scoreOpportunity } from '@/services/opportunityService';
import { SwishException, listExceptions, resolveException, scanForExceptions } from '@/services/exceptionService';
import { CapitalState, computeCapitalState, listCapitalTransactions, CapitalTransaction } from '@/services/capitalService';

// ── Business Config Hook ─────────────────────────────────────────────────────

export function useBusinessConfig() {
  const { tenant } = useApp();
  const [config, setConfig] = useState<BusinessConfig | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    const { config: c } = await getBusinessConfig(tenant.id);
    setConfig(c);
    setLoading(false);
  }, [tenant?.id]);

  useEffect(() => { load(); }, [load]);

  const save = useCallback(async (updates: Partial<BusinessConfig>) => {
    if (!tenant) return { error: 'No tenant' };
    const { config: updated, error } = await upsertBusinessConfig(tenant.id, updates);
    if (updated) setConfig(updated);
    return { error };
  }, [tenant?.id]);

  return { config, loading, save, reload: load };
}

// ── Opportunities Hook ────────────────────────────────────────────────────────

export function useOpportunities() {
  const { tenant } = useApp();
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState<BusinessConfig | null>(null);

  const load = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    const [oppResult, configResult] = await Promise.all([
      listOpportunities(tenant.id),
      getBusinessConfig(tenant.id),
    ]);
    // Never seed demo/fake data — show empty state to new subscribers
    setOpportunities(oppResult.opportunities);
    setConfig(configResult.config);
    setLoading(false);
  }, [tenant?.id]);

  useEffect(() => { load(); }, [load]);

  const addOpportunity = useCallback(async (input: Parameters<typeof createOpportunity>[1]) => {
    if (!tenant) return { error: 'No tenant' };
    const { opportunity, error } = await createOpportunity(tenant.id, input);
    if (opportunity) setOpportunities(prev => [opportunity, ...prev]);
    return { opportunity, error };
  }, [tenant?.id]);

  const updateStatus = useCallback(async (id: string, status: Opportunity['status'], approvalStatus?: Opportunity['approvalStatus']) => {
    const { error } = await updateOpportunityStatus(id, status, approvalStatus);
    if (!error) {
      setOpportunities(prev => prev.map(o => o.id === id ? { ...o, status, approvalStatus: approvalStatus ?? o.approvalStatus } : o));
    }
    return { error };
  }, []);

  const scoredOpportunities = opportunities.map(opp => ({
    ...opp,
    score: scoreOpportunity(opp, {
      minROI: config?.minROIThreshold ?? 0.3,
      maxSingleAcquisition: config?.maxSingleAcquisition ?? 500,
      autonomousSpendingLimit: config?.autonomousSpendingLimit ?? 100,
      riskTolerance: config?.riskTolerance ?? 'medium',
    }),
  }));

  return { opportunities: scoredOpportunities, loading, addOpportunity, updateStatus, reload: load };
}

// ── Exceptions Hook ────────────────────────────────────────────────────────

export function useExceptions() {
  const { tenant } = useApp();
  const [exceptions, setExceptions] = useState<SwishException[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    await scanForExceptions(tenant.id);
    const { exceptions: data } = await listExceptions(tenant.id);
    setExceptions(data);
    setLoading(false);
  }, [tenant?.id]);

  useEffect(() => { load(); }, [load]);

  const resolve = useCallback(async (id: string, notes?: string) => {
    const { error } = await resolveException(id, notes);
    if (!error) setExceptions(prev => prev.filter(e => e.id !== id));
    return { error };
  }, []);

  const criticalCount = exceptions.filter(e => e.severity === 'critical').length;
  const highCount = exceptions.filter(e => e.severity === 'high').length;

  return { exceptions, loading, resolve, reload: load, criticalCount, highCount };
}

// ── Capital Hook ───────────────────────────────────────────────────────────

export function useCapital() {
  const { tenant } = useApp();
  const [state, setState] = useState<CapitalState | null>(null);
  const [transactions, setTransactions] = useState<CapitalTransaction[]>([]);
  const [config, setConfig] = useState<BusinessConfig | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    const [capitalState, txResult, configResult] = await Promise.all([
      computeCapitalState(tenant.id),
      listCapitalTransactions(tenant.id),
      getBusinessConfig(tenant.id),
    ]);
    setState(capitalState);
    setTransactions(txResult.transactions);
    setConfig(configResult.config);
    setLoading(false);
  }, [tenant?.id]);

  useEffect(() => { load(); }, [load]);

  const goalProgress = config && state
    ? computeGoalProgress(config, state.availableCash + state.capitalInStock)
    : null;

  return { state, transactions, config, goalProgress, loading, reload: load };
}
