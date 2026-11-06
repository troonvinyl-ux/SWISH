import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { createScannerSession } from '@/services/scannerSessionService';

interface ScannerVisit { ownerScope: string; token: string }

/** Shared by tab, full-screen and specialist scanners. No automatic draft resume. */
export function useScannerSession(ownerScope: string) {
  const clockRef = useRef<ReturnType<typeof createScannerSession> | null>(null);
  if (!clockRef.current) clockRef.current = createScannerSession();
  const current = clockRef.current;
  const [visit, setVisit] = useState<ScannerVisit | null>(null);
  const restart = useCallback(() => {
    if (!current.current) return;
    const token = current.begin(ownerScope);
    setVisit({ ownerScope, token });
  }, [current, ownerScope]);

  useFocusEffect(useCallback(() => {
    const token = current.begin(ownerScope);
    setVisit({ ownerScope, token });
    return () => {
      // Invalidates camera/AI/save completions synchronously, including after restart.
      current.end(current.current);
      setVisit(null);
    };
  }, [current, ownerScope]));

  const scope = visit?.ownerScope === ownerScope && current.isCurrent(visit.token) ? visit.token : '';
  return { scope, current, restart };
}
