import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from './useApp';
import { inspectLiveListing } from '@/services/ebayRevisionService';
import type { LiveListingContent } from '@/shared/ebayRevisionContract';
export function useEbayLiveContent(tenantId: string, listingId: string) {
  const { activeNicheId, fixedNicheId, moduleEpoch } = useApp();
  const scope = `${tenantId}:${listingId}:${fixedNicheId ?? activeNicheId}:${moduleEpoch}`;
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const flight = useRef<string | null>(null);
  const [snapshot, setSnapshot] = useState<{ scope: string; live: LiveListingContent | null; error: string | null; busy: boolean }>({ scope: '', live: null, error: null, busy: false });
  useEffect(() => () => { scopeRef.current = ''; }, []);
  const check = useCallback(async () => {
    if (!tenantId || !listingId || flight.current === scope) return;
    flight.current = scope; setSnapshot(previous => ({ scope, live: previous.scope === scope ? previous.live : null, error: null, busy: true }));
    try {
      const result = await inspectLiveListing(tenantId, listingId);
      if (scopeRef.current !== scope) return;
      setSnapshot(previous => ({ scope, live: result.live ?? (previous.scope === scope ? previous.live : null), error: result.error, busy: false }));
    } finally { if (flight.current === scope) flight.current = null; }
  }, [scope, tenantId, listingId]);
  return { live: snapshot.scope === scope ? snapshot.live : null, error: snapshot.scope === scope ? snapshot.error : null, busy: snapshot.scope === scope && snapshot.busy, check };
}
