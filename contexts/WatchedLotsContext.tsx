import { createContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '@/template';
import { useApp } from '@/hooks/useApp';
import { resolveProductionNiche } from '@/services/nicheRouting';
import { listWatchedLots, saveWatchedLot, openWatchedLot, removeWatchedLot, watchedLotScopeKey,
  type WatchedLot, type WatchedLotScope, type WatchedLotSnapshot } from '@/services/watchedLotService';
import type { ManifestSession } from '@/services/manifestSessionService';

interface WatchedLotsValue {
  rows: WatchedLot[]; ready: boolean; loading: boolean; busy: boolean; hasMore: boolean; error: string | null;
  refresh: () => Promise<void>; loadMore: () => Promise<void>; clearError: () => void;
  saveWatch: (draft: ManifestSession) => Promise<WatchedLot | null>;
  openWatch: (id: string) => Promise<WatchedLotSnapshot | null>;
  removeWatch: (id: string) => Promise<boolean>;
}
interface ShelfState { scope: string; rows: WatchedLot[]; loading: boolean; busy: boolean; hasMore: boolean; error: string | null }
const emptyShelf = (scope: string): ShelfState => ({ scope,rows:[],loading:false,busy:false,hasMore:false,error:null });
export const WatchedLotsContext = createContext<WatchedLotsValue | undefined>(undefined);
export function WatchedLotsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { tenant,activeNicheId,fixedNicheId } = useApp();
  const nicheId = resolveProductionNiche(fixedNicheId ?? activeNicheId);
  const scope = useMemo<WatchedLotScope | null>(() => user?.id && tenant?.id && nicheId
    ? { userId:user.id,tenantId:tenant.id,nicheId } : null,[user?.id,tenant?.id,nicheId]);
  const key = scope ? watchedLotScopeKey(scope) : '';
  const current = useRef(key);
  const scopeEpoch = useRef(0);
  if (current.current !== key) { current.current=key;scopeEpoch.current++; }
  const alive = useRef(true);
  const request = useRef(0);
  const operationLock = useRef(false);
  const fetchLock = useRef<{ key: string; token: number } | null>(null);
  const refreshRef = useRef<() => Promise<void>>(async()=>{});
  const [state,setState] = useState<ShelfState>(()=>emptyShelf(key));
  const shelf = state.scope === key ? state : emptyShelf(key);
  const shelfRef = useRef(shelf); shelfRef.current = shelf;
  const commit = useCallback((expected: string, update: (previous: ShelfState) => ShelfState) => {
    if (alive.current && current.current === expected) setState(previous => update(previous.scope === expected ? previous : emptyShelf(expected)));
  },[]);
  const clearError = useCallback(()=>commit(key,previous=>({...previous,error:null})),[commit,key]);
  const fetchPage = useCallback(async (more: boolean) => {
    if (!scope || operationLock.current || fetchLock.current?.key === key) return;
    const before = shelfRef.current;
    const offset = more ? before.rows.length : 0;
    if (more && !before.hasMore) return;
    const token = ++request.current;
    const epoch = scopeEpoch.current;
    fetchLock.current = { key,token };
    commit(key,previous=>({...previous,loading:true,error:null}));
    try {
      const result = await listWatchedLots(scope,offset);
      if (token !== request.current || epoch !== scopeEpoch.current) return;
      commit(key,previous => {
        const merged = more ? [...previous.rows,...result.rows] : result.rows;
        return { ...previous,rows:Array.from(new Map(merged.map(row=>[row.id,row])).values()),hasMore:result.hasMore };
      });
    } catch (error: unknown) {
      if (token === request.current && epoch === scopeEpoch.current) commit(key,previous=>({...previous,error:error instanceof Error ? error.message : 'Your shortlist could not load. Try again.'}));
    } finally {
      if (fetchLock.current?.token === token) fetchLock.current = null;
      if (token === request.current && epoch === scopeEpoch.current) commit(key,previous=>({...previous,loading:false}));
    }
  },[scope,key,commit]);
  const refresh = useCallback(()=>fetchPage(false),[fetchPage]);
  const loadMore = useCallback(()=>fetchPage(true),[fetchPage]);
  refreshRef.current = refresh;
  useEffect(()=>{ alive.current=true;return ()=>{alive.current=false;request.current++;}; },[]);
  useEffect(()=>{
    request.current++; fetchLock.current=null; setState(emptyShelf(key)); void refresh();
  },[key,refresh]);
  useEffect(()=>{
    const subscription=AppState.addEventListener('change',status=>{if(status==='active')void refresh();});
    return ()=>subscription.remove();
  },[refresh]);
  const perform = useCallback(async <T,>(action: (activeScope: WatchedLotScope, stillCurrent: () => boolean) => Promise<T>): Promise<T | null> => {
    if (operationLock.current) return null;
    if (!scope) { commit(key,previous=>({...previous,error:'Sign in and select a niche to use your watched lots.'}));return null; }
    operationLock.current=true; request.current++;
    commit(key,previous=>({...previous,busy:true,loading:false,error:null}));
    const epoch = scopeEpoch.current;
    const stillCurrent = () => alive.current && current.current === key && scopeEpoch.current === epoch;
    try {
      const result = await action(scope,stillCurrent);
      return stillCurrent() ? result : null;
    } catch (error: unknown) {
      if (stillCurrent()) commit(key,previous=>({...previous,error:error instanceof Error ? error.message : 'That change could not be saved. Try again.'}));
      return null;
    } finally {
      operationLock.current=false;
      if (stillCurrent()) commit(key,previous=>({...previous,busy:false}));
      else if (alive.current) void refreshRef.current();
    }
  },[scope,key,commit]);
  const saveWatch = useCallback(async (draft: ManifestSession) => {
    const row = await perform((activeScope,stillCurrent)=>saveWatchedLot(activeScope,draft,stillCurrent));
    if (row) commit(key,previous=>({...previous,rows:[row,...previous.rows.filter(entry=>entry.id!==row.id)]}));
    return row;
  },[perform,commit,key]);
  const openWatch = useCallback((id: string)=>perform(activeScope=>openWatchedLot(activeScope,id)),[perform]);
  const removeWatch = useCallback(async (id: string) => {
    const removed = await perform(async activeScope=>{await removeWatchedLot(activeScope,id);return true;});
    if (removed) commit(key,previous=>({...previous,rows:previous.rows.filter(row=>row.id!==id)}));
    return removed === true;
  },[perform,commit,key]);
  const value: WatchedLotsValue = { rows:shelf.rows,ready:!!scope,loading:shelf.loading,busy:shelf.busy,hasMore:shelf.hasMore,error:shelf.error,
    refresh,loadMore,clearError,saveWatch,openWatch,removeWatch };
  return <WatchedLotsContext.Provider value={value}>{children}</WatchedLotsContext.Provider>;
}
