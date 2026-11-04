import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from './useApp';
import { saveAntiqueCategory, getAntiqueCategoryHint, suggestAntiqueCategories, type AntiqueCategoryItem, type AntiqueCategoryCandidate } from '@/services/listingEditorService';

export function useAntiqueCategory() {
  const { tenant, activeNicheId, fixedNicheId, accessReady, triggerInventoryReload } = useApp();
  const scope = `${tenant?.id ?? ''}:${fixedNicheId ?? activeNicheId}`;
  const current = useRef(scope); current.current = scope;
  useEffect(() => {
    current.current = scope;
    return () => { if (current.current === scope) current.current = ''; };
  }, [scope]);
  return useCallback(async (itemId: string, categoryId: string, categoryName: string) => {
    if (!tenant || !accessReady || (fixedNicheId ?? activeNicheId) !== 'antiques') return { attributes: null, error: 'Select your verified Antique workspace before saving its category.' };
    const result = await saveAntiqueCategory(tenant.id, itemId, categoryId, categoryName);
    if (current.current !== scope) return { attributes: null, error: 'Workspace changed during category selection. Reload the item to check the saved category.' };
    if (!result.error) triggerInventoryReload();
    return result;
  }, [tenant?.id, accessReady, activeNicheId, fixedNicheId, scope, triggerInventoryReload]);
}

/** Read-only suggestions stay scoped; selecting one uses the verified save above. */
export function useAntiqueCategorySuggestions(item: (AntiqueCategoryItem & { id: string }) | null) {
  const { tenant, activeNicheId, fixedNicheId, accessReady } = useApp();
  const scope = `${tenant?.id ?? ''}:${fixedNicheId ?? activeNicheId}:${item?.id ?? ''}`;
  const current = useRef(scope); current.current = scope;
  const lock = useRef(false);
  const mounted = useRef(true);
  const [snapshot, setSnapshot] = useState<{ scope: string; suggestions: AntiqueCategoryCandidate[]; source: string; error: string | null }>({ scope: '', suggestions: [], source: '', error: null });
  const [busyScope, setBusyScope] = useState('');
  const hint = item && (fixedNicheId ?? activeNicheId) === 'antiques' ? getAntiqueCategoryHint(item) : null;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    current.current = scope;
    return () => { if (current.current === scope) current.current = ''; };
  }, [scope]);
  const suggest = useCallback(async () => {
    if (!item || !tenant || !accessReady || (fixedNicheId ?? activeNicheId) !== 'antiques' || lock.current) return;
    lock.current = true; setBusyScope(scope); setSnapshot({ scope, suggestions: [], source: '', error: null });
    try {
      const result = await suggestAntiqueCategories(tenant.id, item);
      if (mounted.current && current.current === scope) setSnapshot({ scope, ...result });
    } catch {
      if (mounted.current && current.current === scope) setSnapshot({ scope, suggestions: [], source: '', error: 'The category service could not be reached. No category was changed.' });
    } finally {
      lock.current = false;
      if (mounted.current) setBusyScope(previous => previous === scope ? '' : previous);
    }
  }, [item, tenant?.id, accessReady, fixedNicheId, activeNicheId, scope]);
  return { hint, busy: busyScope === scope, suggest, suggestions: snapshot.scope === scope ? snapshot.suggestions : [], source: snapshot.scope === scope ? snapshot.source : '', error: snapshot.scope === scope ? snapshot.error : null };
}
