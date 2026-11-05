import { PRODUCTION_NICHE_IDS } from '@/constants/niches';
import { isProductionCommit, getNicheCertification, hasProductionEvidence, type ProductionRegister, type ProductionTask } from './productionControlEvidence';
import type { ProductionSnapshot } from './productionControlService';
export type ReadinessState = 'VERIFIED' | 'FAILED' | 'BLOCKED' | 'AWAITING VERIFICATION' | 'NOT ASSESSED';
export interface TaskAcceptance { commitSha: string; checkedAt: string; result: 'PASS' | 'FAIL' | 'BLOCKED'; method: string; evidence: string; criteriaPassed: boolean; failureReason?: string }
export interface TaskPlan { components: string[]; method: string; correction: string }
const plans: Record<string, TaskPlan> = {
 S1: { components: ['niche-modules.json','docs/SWISH_STAGE_ONE_ARCHITECTURE_AUDIT.md','services/nicheRouting.ts'], method: 'Current-main architecture/dependency review; validate-foundation, registry and route tests; confirm deployed contracts.', correction: 'Reconcile the exact changed dependency/route against current main; retain dated historical findings.' },
 S2: { components: ['shared/moduleContracts.ts','services/unifiedModuleRegistry.ts','scripts/validate-unified-modules.mjs'], method: 'Full current-commit registry/module-boundary tests and dependency graph validation.', correction: 'Correct the smallest shared contract mismatch and rerun all affected niche tests.' },
 S3: { components: ['contexts/AppContext.tsx','supabase/functions/','supabase/migrations/'], method: 'Separate subscriber JWTs; caller-RLS and approved sandbox auth/storage/AI/eBay/lifecycle acceptance.', correction: 'Trace the failed authorized request and fix its owning service without replacing auth, inventory or eBay.' },
 S4: { components: ['hooks/useGenericCapture.ts','services/listingEditorService.ts','services/ebayRevisionService.ts'], method: 'Approved isolated scan → save/reopen → draft/category/specifics → seller sandbox → sale/fee reconciliation.', correction: 'Repair the failed workflow transition; require persisted/provider readback, not only a success response.' },
 S5: { components: ['constants/niches.ts','shared/specialistIntelligence.ts','services/inventoryTabQueryService.ts'], method: 'All registered representative niche fixtures plus two-user tenant/niche denial tests and saved field readback.', correction: 'Correct the canonical specialist mapping or failing niche field only; do not reclassify historical inventory.' },
 S6: { components: ['services/specialistWorkspaceService.ts','services/cardGradingService.ts','services/manifestParser.ts'], method: 'Selected optional engine tests plus cross-niche contamination tests; deferred external providers stay blocked.', correction: 'Keep optional integrations isolated and explicitly defer unsupported/licensing-dependent capabilities.' },
 S7: { components: ['.github/workflows/build-swish-unified.yml','scripts/verify-unified-apk.sh','scripts/verify-s3-live.mjs'], method: 'Current-commit Jest, TypeScript, lint, server authorization, unified artifact/signing, hosted/device and approved integration evidence.', correction: 'Rerun failing checks on the exact source commit; no build/release until mandatory acceptance is complete.' },
};
export function assessReadiness(snapshot: ProductionSnapshot) {
 const register = snapshot.register;
 const tasks = (register?.stages ?? []).flatMap(stage => stage.tasks.map(task => {
  const record = task as ProductionTask & { priority?: 'critical' | 'high' | 'normal'; dependencies?: string[]; acceptance?: TaskAcceptance; implementationNotes?: string };
  const acceptance = record.acceptance;
  const current = snapshot.source === 'LIVE' && isProductionCommit(snapshot.mainSha) && acceptance?.commitSha === snapshot.mainSha && Number.isFinite(Date.parse(acceptance.checkedAt)) && Date.parse(acceptance.checkedAt) <= Date.now();
  const pass = current && acceptance?.result === 'PASS' && acceptance.criteriaPassed === true && hasProductionEvidence(acceptance.evidence) && Boolean(acceptance.method);
  const status: ReadinessState = pass ? 'VERIFIED' : current && acceptance?.result === 'FAIL' ? 'FAILED' : record.status === 'BLOCKED' || (current && acceptance?.result === 'BLOCKED') ? 'BLOCKED' : record.status === 'NOT STARTED' ? 'NOT ASSESSED' : 'AWAITING VERIFICATION';
  const plan = plans[stage.id] ?? plans.S7;
  return { ...record, workstream: stage.id, status, historicalStatus: record.status, priority: record.priority ?? (stage.id === 'S6' ? 'normal' : 'critical'), dependencies: record.dependencies ?? (stage.id === 'S1' ? [] : register?.stages.find(row => row.id === `S${Number(stage.id.slice(1))-1}`)?.tasks.map(row => row.id) ?? []), implementationNotes: record.implementationNotes ?? record.evidence ?? 'No implementation evidence recorded.', verificationMethod: acceptance?.method ?? plan.method, testResult: current ? acceptance?.result ?? 'NOT TESTED' : 'NOT TESTED ON CURRENT COMMIT', evidence: acceptance?.evidence ?? record.evidence ?? 'No evidence recorded.', lastChecked: current ? acceptance?.checkedAt ?? null : null, failureReason: current ? acceptance?.failureReason ?? null : null, plan };
 }));
 const stages = (register?.stages ?? []).map(stage => { const rows = tasks.filter(task => task.workstream === stage.id); const verified = rows.filter(task => task.status === 'VERIFIED').length; return { ...stage, tasks: rows, verified, total: rows.length, percentage: rows.length ? Math.round(100*verified/rows.length) : 0 }; });
 const verified = tasks.filter(task => task.status === 'VERIFIED').length;
 const failed = tasks.filter(task => task.status === 'FAILED').length;
 const blocked = tasks.filter(task => task.status === 'BLOCKED').length;
 const awaiting = tasks.filter(task => task.status === 'AWAITING VERIFICATION').length;
 const critical = tasks.filter(task => task.priority === 'critical' && task.status !== 'VERIFIED');
 const certified = snapshot.niches.filter(niche => getNicheCertification(register, niche.id, snapshot.mainSha, snapshot.source === 'LIVE').certified).length;
 const reasons = [
  ...(snapshot.source !== 'LIVE' ? ['Current-main register unavailable; cached/bundled evidence cannot certify release.'] : []),
  ...(!tasks.length ? ['Canonical S1–S7 requirements unavailable.'] : []),
  ...(critical.length ? [`${critical.length} mandatory critical tasks are not currently verified.`] : []),
  ...(failed ? [`${failed} current acceptance failures.`] : []),
  ...(certified !== snapshot.niches.length || snapshot.niches.length !== PRODUCTION_NICHE_IDS.length ? [`${certified}/${PRODUCTION_NICHE_IDS.length} niches have complete current-commit acceptance.`] : []),
  ...(snapshot.errors.length ? ['One or more source/evidence queries failed.'] : []),
  ...(register?.knownReleaseRisks.length ? ['Recorded release risks remain open; no historical risk was silently dismissed.'] : []),
 ];
 const verdict = failed ? 'NOT READY' : snapshot.source !== 'LIVE' || blocked ? 'BLOCKED' : reasons.length ? 'NOT READY' : verified < tasks.length ? 'READY WITH NON-CRITICAL WARNINGS' : 'READY';
 const checked = tasks.map(task => task.lastChecked).filter((date): date is string => Boolean(date)).sort();
 return { tasks, stages, verified, failed, blocked, awaiting, critical, certified, reasons, verdict, percentage: tasks.length ? Math.round(100*verified/tasks.length) : 0, latestChecked: checked[checked.length-1] ?? null };
}
export function readinessWorkstreamPlan(id: string) { return plans[id] ?? plans.S7; }
