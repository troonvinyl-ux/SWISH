import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/template';
import { useApp } from './useApp';
import { savePreflightCondition } from '@/services/listingEditorService';
export function usePreflightCondition(listingId: string, categoryId: string, savedId: string, onSaved: () => void) {
  const { user } = useAuth();
  const { tenant, fixedNicheId, activeNicheId, triggerInventoryReload } = useApp();
  const nicheId = fixedNicheId ?? activeNicheId;
  const scope = `${user?.id}:${tenant?.id}:${nicheId}:${listingId}:${categoryId}`;
  const current = useRef(scope); current.current = scope;
  const alive = useRef(true); const lock = useRef(false);
  const [selection, setSelection] = useState({ scope, id: savedId });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setSelection({ scope, id: savedId }); setError(null); }, [scope, savedId]);
  const selected = selection.scope === scope ? selection.id : savedId;
  const choose = useCallback((id: string) => { if (!lock.current) { setSelection({ scope, id }); setError(null); } }, [scope]);
  const save = useCallback(async () => {
    if (!user || !tenant || !selected || lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try {
      const result = await savePreflightCondition({ tenantId: tenant.id, listingId, nicheId, categoryId, conditionId: selected });
      if (!alive.current || current.current !== scope) return;
      if (result.error) { setError(result.error); return; }
      triggerInventoryReload(); onSaved();
    } catch { if (alive.current && current.current === scope) setError('Condition could not be saved. Recheck before retrying.'); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }, [user?.id, tenant?.id, listingId, nicheId, categoryId, selected, scope, triggerInventoryReload, onSaved]);
  return { selected, choose, save, busy, error };
}
