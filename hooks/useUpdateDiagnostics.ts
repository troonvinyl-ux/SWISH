import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { collectUpdateDiagnostics, formatUpdateDiagnostics, shareUpdateDiagnostics } from '@/services/appUpdateDiagnosticsService';

export function useUpdateDiagnostics() {
  const [expanded, setExpanded] = useState(false), [busy, setBusy] = useState(false);
  const [reportText, setReportText] = useState(''), [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const alive = useRef(true), sharing = useRef(false);
  useEffect(() => {
    alive.current = true;
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active') setReportText(formatUpdateDiagnostics(collectUpdateDiagnostics()));
    });
    return () => { alive.current = false; listener.remove(); };
  }, []);
  const refresh = () => { const report = collectUpdateDiagnostics(); setReportText(formatUpdateDiagnostics(report)); return report; };
  return { expanded, busy, reportText, error, message, canShare: Platform.OS !== 'web',
    toggleReport: () => { refresh(); setExpanded(value => !value); },
    share: async () => {
      if (sharing.current) return;
      sharing.current = true; setBusy(true); setError(null); setMessage(null);
      try { const result = await shareUpdateDiagnostics(refresh()); if (alive.current) setMessage(result === 'shared' ? 'Diagnostics shared.' : 'Sharing cancelled.'); }
      catch { if (alive.current) setError('Could not open sharing. View the report and copy its text.'); }
      finally { sharing.current = false; if (alive.current) setBusy(false); }
    },
  };
}
