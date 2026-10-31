import { useCallback, useEffect, useRef, useState } from 'react';
import { searchManifestSold, type ManifestSoldResult } from '@/services/manifestSoldService';
export interface ManifestSoldState { loading: boolean; result: ManifestSoldResult | null; error: string | null }
export function useManifestSoldComparisons(scope: string, manifestKey: string, tenantId: string | null, nicheId: string | null) {
  const identity = `${scope}:${manifestKey}`;
  const active = useRef(identity); const epoch = useRef(0); const alive = useRef(true);
  if (active.current !== identity) { active.current = identity; epoch.current++; }
  const locks = useRef(new Set<string>());
  const [state,setState] = useState<{ identity:string; rows:Record<string,ManifestSoldState> }>({identity,rows:{}});
  useEffect(() => { alive.current = true; return () => { alive.current = false; epoch.current++; }; },[]);
  const checkSold = useCallback(async (rowId: string, query: string) => {
    if (!tenantId || !nicheId || !manifestKey) {
      setState(previous => ({identity,rows:{...(previous.identity === identity ? previous.rows : {}),[rowId]:{loading:false,result:null,error:'Sign in and wait for your niche to load.'}}})); return;
    }
    const lockKey = `${identity}:${rowId}`;
    if (locks.current.has(lockKey)) return;
    locks.current.add(lockKey);
    const version = epoch.current;
    const current = () => alive.current && active.current === identity && epoch.current === version;
    const commit = (value:ManifestSoldState) => { if (current()) setState(previous => ({identity,rows:{...(previous.identity === identity ? previous.rows : {}),[rowId]:value}})); };
    commit({loading:true,result:null,error:null});
    try { commit({loading:false,result:await searchManifestSold(tenantId,nicheId,query),error:null}); }
    catch (error) { commit({loading:false,result:null,error:error instanceof Error ? error.message : 'Sold prices could not load. Try again.'}); }
    finally { locks.current.delete(lockKey); }
  },[identity,manifestKey,tenantId,nicheId]);
  // No lookups on mount, scroll or navigation. Only an explicit product button makes a request.
  return { soldRows:state.identity === identity ? state.rows : {}, checkSold };
}
