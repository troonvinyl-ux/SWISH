import { useContext, useState, useMemo, useRef, useCallback, useEffect } from 'react';
import type { ManifestPhase } from '@/constants/manifestExperience';
import { friendlyManifestError, bestManifestProducts, presentLotVerdict, presentBaseLotVerdict } from '@/services/manifestExperienceService';
import { suggestLotBid } from '@/services/lotBiddingService';
import { ManifestOpportunityContext, emptyManifestSession } from '@/contexts/ManifestOpportunityContext';
import { useApp } from './useApp';
import { resolveProductionNiche } from '@/services/nicheRouting';
import { evaluateManifestLot, toLotLines, type LotLine, type LotAssumptions } from '@/services/lotEconomicsService';
import { normaliseManifest, parseManifestText, type ParsedManifest } from '@/services/manifestParser';
import { compileManifestDrafts, manifestIdentity, savePurchasedManifest } from '@/services/manifestListingService';
import { invokeListingOperation } from '@/services/listingEditorService';
export function useManifestOpportunity() {
  const context = useContext(ManifestOpportunityContext);
  if (!context) throw new Error('Manifest opportunity provider is required.');
  const { scope, draft, setDraft } = context;
  const { tenant, activeNicheId, fixedNicheId, triggerInventoryReload } = useApp();
  const nicheId = resolveProductionNiche(fixedNicheId ?? activeNicheId);
  const currentScope = useRef(scope); currentScope.current = scope;
  const lock = useRef(false); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<ManifestPhase>('checking');
  const [step, setStep] = useState<1 | 2 | 3>(draft.lines.length ? 2 : 1);
  useEffect(() => { setStep(draft.lines.length ? 2 : 1); setError(null); setNotice(''); }, [scope]);
  const [notice, setNotice] = useState(''); const [suggestions, setSuggestions] = useState<{ scope: string; rowId: string; rows: any[] } | null>(null);
  const run = useCallback(async (operation: () => Promise<void>, initialPhase: ManifestPhase = 'checking') => {
    if (lock.current) return; lock.current = true; setPhase(initialPhase); setBusy(true); setError(null); setNotice('');
    try { await operation(); } catch (e: any) { if (currentScope.current === scope) setError(e?.message ?? 'Operation could not be completed.'); }
    finally { lock.current = false; setBusy(false); }
  }, [scope]);
  const load = async (manifest: ParsedManifest, name: string) => {
    if (!nicheId) throw new Error('Select a production niche before importing a manifest.');
    setPhase('planning');
    const lines = toLotLines(manifest.rows); const key = await manifestIdentity(lines, nicheId);
    if (currentScope.current !== scope) return;
    setDraft({ ...emptyManifestSession(), name, key, lines, warnings: manifest.warnings }); setSuggestions(null); setStep(2);
  };
  const pick = () => run(async () => { const { pickManifest } = await import('@/services/manifestFileService'); const picked = await pickManifest(value => { if(currentScope.current === scope) setPhase(value); }); if (picked) await load(picked.manifest, picked.name); }, 'choosing');
  const paste = (text: string) => run(async () => { await load(normaliseManifest(parseManifestText(text)), 'Pasted manifest'); });
  const example = () => run(async () => { const { suppliedManifestExample } = await import('@/constants/manifestExample'); await load(suppliedManifestExample(), 'Supplied example · spW91E1008R'); });
  const updateLine = (id: string, patch: Partial<LotLine>) => { if (draft.acquisitionId || busy) return; setDraft(previous => ({ ...previous, lines: previous.lines.map(line => line.id === id ? { ...line, ...patch } : line) })); };
  const updateAssumption = (key: keyof LotAssumptions, value: number | null) => setDraft(previous => ({ ...previous, assumptions: { ...previous.assumptions, [key]: value } as LotAssumptions }));
  const evaluation = useMemo(() => evaluateManifestLot(draft.lines, draft.assumptions), [draft.lines, draft.assumptions]);
  const paidAnalysis = useMemo(() => evaluateManifestLot(draft.lines, { ...draft.assumptions, currentBid:draft.paidHammer.trim() ? Number(draft.paidHammer) : null }), [draft.lines,draft.assumptions,draft.paidHammer]);
  const plans = useMemo(() => compileManifestDrafts(draft.lines, draft.assumptions, draft.strategy), [draft.lines, draft.assumptions, draft.strategy]);
  const findCategories = (rowId: string) => run(async () => {
    setPhase('categories');
    const row = draft.lines.find(r => r.id === rowId); if (!row || !tenant) throw new Error('Sign in and wait for your business to load.');
    const result = await invokeListingOperation({ tenantId: tenant.id, route: 'get_category_suggestions', query: row.title.slice(0, 100) }, 'swish-ebay-category');
    if (result.error || !result.data?.success) throw new Error(result.error ?? 'eBay category lookup unavailable.');
    if (currentScope.current === scope) setSuggestions({ scope, rowId, rows: result.data.suggestions ?? [] });
  });
  const chooseCategory = (rowId: string, category: any) => run(async () => {
    setPhase('categories');
    if (!tenant || !category.isLeaf) throw new Error('Choose a leaf category.');
    const result = await invokeListingOperation({ tenantId: tenant.id, route: 'get_category_aspects', categoryId: category.id });
    if (result.error || !result.data?.success || result.data.isLeaf !== true) throw new Error(result.error ?? 'Category requirements not verified.');
    const names: string[] = (result.data.aspects ?? []).filter((s: any) => s.aspectConstraint?.aspectRequired === true || s.aspectConstraint?.aspectUsage === 'REQUIRED').map((s: any) => String(s.aspectName ?? s.localizedAspectName ?? '')).filter(Boolean);
    if (currentScope.current !== scope) return;
    setDraft(previous => ({ ...previous, lines: previous.lines.map(row => row.id === rowId ? { ...row, categoryId: String(category.id), categoryName: String(category.name), taxonomyChecked: true,
      requiredSpecifics: names, specifics: [...new Set(['Brand', ...names])].map(name => ({ name, value: row.specifics?.find(s => s.name === name)?.value ?? (name === 'Brand' ? row.brand : '') })) } : row) }));
    setSuggestions(null);
  });
  const save = () => run(async () => {
    setPhase('saving');
    if (!tenant || !nicheId) throw new Error('A signed-in business and production niche are required.');
    if (!draft.paidHammer.trim()) throw new Error('Enter the actual paid hammer price after winning/buying. Current bids are not purchases.');
    if (evaluation.errors.length) throw new Error(evaluation.errors[0]);
    const response = await savePurchasedManifest({ tenantId: tenant.id, nicheId, name: draft.name, key: draft.key,
      paidHammer: Number(draft.paidHammer), assumptions: draft.assumptions, units: plans, analysis:paidAnalysis });
    if (currentScope.current !== scope) return;
    setDraft(previous => ({ ...previous, acquisitionId: response.acquisitionId, itemIds: response.itemIds, listingIds: response.listingIds }));
    triggerInventoryReload(); setNotice(response.existing ? 'You already saved this lot. Your original stock and listings are ready to open.' : `Your lot is saved. ${response.listingIds.length} listings are waiting for your review. Nothing is live on eBay yet.`);
  });
  const rankedProducts = useMemo(() => bestManifestProducts(draft.lines), [draft.lines]);
  const verdict = useMemo(() => presentLotVerdict(evaluation), [evaluation]);
  const baseVerdict = useMemo(() => presentBaseLotVerdict(evaluation.base), [evaluation.base]);
  const biddingAdvice = useMemo(() => suggestLotBid({ ceiling: evaluation.base.maximumHammerBid,
    currentBid: draft.assumptions.currentBid, increment: draft.assumptions.increment,
    bidCount: draft.assumptions.bidCount, minutesLeft: draft.assumptions.minutesLeft,
    blocked: evaluation.base.status === 'invalid' || evaluation.errors.length > 0,
  }), [evaluation, draft.assumptions]);
  const revealResult = () => {
    if (lock.current || !draft.lines.length) return;
    if (evaluation.errors.length) { setError(evaluation.errors[0]); return; }
    setError(null); setStep(3);
  };
  return { draft, busy, error: error ? friendlyManifestError(error) : null, notice, nicheId, evaluation, verdict, baseVerdict, biddingAdvice, rankedProducts,
    phase, step, setStep, revealResult, plans, pick, paste, example, updateLine, updateAssumption,
    findCategories, chooseCategory, suggestions: suggestions?.scope === scope ? suggestions : null, save,
    reset: () => { if (lock.current) return; setDraft(emptyManifestSession()); setError(null); setNotice(''); setSuggestions(null); setStep(1); },
    setPaidHammer: (value: string) => setDraft(previous => ({ ...previous, paidHammer: value })),
    setStrategy: (strategy: 'individual' | 'grouped' | 'whole') => setDraft(previous => ({ ...previous, strategy })) };
}
