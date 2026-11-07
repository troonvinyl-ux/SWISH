import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/template';
import { preparePerformanceExport } from '@/services/performanceExportService';
import { deliverPerformanceJson } from '@/services/performanceExportFileService';
export function usePerformanceExport(enabled: boolean) {
 const { user } = useAuth();
 const uid = user?.id ?? '';
 const current = useRef({ uid, enabled }); current.current = { uid, enabled };
 const mounted = useRef(true), flight = useRef(false), generation = useRef(0);
 const [state, setState] = useState({ uid: '', busy: false, message: '', error: '' });
 useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, []);
 useEffect(() => { generation.current++; setState({ uid, busy: false, message: '', error: '' }); }, [uid, enabled]);
 const exportJson = useCallback(async () => {
  if (flight.current || !current.current.enabled || !uid) return;
  flight.current = true;
  const version = generation.current;
  const valid = () => mounted.current && current.current.uid === uid && current.current.enabled && generation.current === version;
  setState({ uid, busy: true, message: '', error: '' });
  try {
   const prepared = await preparePerformanceExport(uid);
   if (!valid()) return;
   const result = await deliverPerformanceJson(prepared.report, async () => {
    if (!valid()) throw new Error('Owner export was cancelled.');
    await prepared.authorize();
    if (!valid()) throw new Error('Owner export was cancelled.');
   });
   if (valid()) setState({ uid, busy: false, error: '', message: result === 'download_started' ? 'JSON download started.' : 'JSON share sheet opened. Choose a destination; cancellation does not confirm a saved file.' });
  } catch (cause) {
   if (valid()) setState({ uid, busy: false, message: '', error: cause instanceof Error ? cause.message : 'Performance export failed. No file was confirmed.' });
  } finally {
   flight.current = false;
   if (valid()) setState(previous => ({ ...previous, busy: false }));
  }
 }, [uid]);
 return { busy: state.uid === uid && state.busy, message: state.uid === uid ? state.message : '', error: state.uid === uid ? state.error : '', exportJson };
}
