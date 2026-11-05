import { useCallback, useEffect, useRef, useState } from 'react';
import { reconcileListingPublication } from '@/services/listingPublicationService';
export function usePublicationRecovery(tenantId: string, listingId: string, nicheId: string) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const generation = useRef(0);
  useEffect(() => { generation.current++; setBusy(false); setError(null); running.current = false;
    return () => { generation.current++; };
  }, [tenantId, listingId, nicheId]);
  const synchronise = useCallback(async () => {
    if (running.current) return null;
    running.current = true; const current = generation.current;
    setBusy(true); setError(null);
    try {
      const result = await reconcileListingPublication(tenantId, listingId, nicheId);
      if (current !== generation.current) return null;
      setError(result.error); return result;
    } finally { if (current === generation.current) { running.current = false; setBusy(false); } }
  }, [tenantId, listingId, nicheId]);
  return { busy, error, synchronise };
}
