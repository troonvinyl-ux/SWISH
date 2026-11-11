// Preparation only. Every saved/existing draft is handed to the one common seller editor.
import { useState, useRef, useEffect, useCallback } from 'react';
import { useApp } from './useApp';
import { useAuth } from '@/template';
import { resolveProductionNiche } from '@/services/nicheRouting';
import { prepareInventoryListing } from '@/services/preparedListingService';
interface PreparedState { listingId: string; busy: boolean; error: string }
const empty: PreparedState = { listingId: '', busy: true, error: '' };
export function usePreparedListing(itemId: string) {
  const { tenant, fixedNicheId, activeNicheId, accessReady, moduleLoading, moduleEpoch, triggerInventoryReload } = useApp();
  const { user } = useAuth(); const niche = resolveProductionNiche(fixedNicheId ?? activeNicheId);
  const scope = `${user?.id}:${tenant?.id}:${niche}:${moduleEpoch}:${itemId}`;
  const current = useRef(scope); current.current = scope;
  const [state, setState] = useState<PreparedState>(empty), [loadedScope, setLoadedScope] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoadedScope(scope); setState(empty);
    if (!itemId) { setState({ ...empty, busy: false, error: 'Choose an inventory item before creating a listing.' }); return; }
    if (!tenant || !user || !niche || !accessReady || moduleLoading) return;
    void prepareInventoryListing(tenant.id, niche, itemId, user.id).then(result => {
      if (cancelled || current.current !== scope) return;
      const listingId = result.existingId || result.draft?.listing.id || '';
      setState({ listingId, busy: false, error: listingId ? '' : 'No saved draft was returned. Reopen the inventory item.' });
      if (listingId) triggerInventoryReload();
    }).catch(cause => {
      if (!cancelled && current.current === scope) setState({ listingId: '', busy: false, error: cause instanceof Error ? cause.message : 'Listing preparation could not complete. Retry on this saved item.' });
    });
    return () => { cancelled = true; };
  }, [scope, tenant?.id, user?.id, niche, itemId, accessReady, moduleLoading, attempt, triggerInventoryReload]);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  return { state: loadedScope === scope ? state : empty, retry };
}
