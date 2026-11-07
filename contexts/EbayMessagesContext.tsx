// One shared inbox state over existing message services. No alternative database or persisted buyer cache.
import { createContext, useCallback, useRef, useState, type ReactNode } from 'react';
import { useAlert } from '@/template';
import { useModuleOperationGuard } from '@/hooks/useModuleOperationGuard';
import { listEbayMessages, syncEbayMessages, updateEbayMessageFlag, sendEbayReply, suggestEbayReply, type EbayMessage, type EbayReplyInput, type EbayReplyResult } from '@/services/ebayMessageService';
export interface EbayMessagesContextValue {
  scope: string; ready: boolean; messages: EbayMessage[]; loading: boolean; syncing: boolean; error: string | null;
  refresh: () => Promise<void>; sync: () => Promise<void>;
  markRead: (id: string) => Promise<void>; archive: (id: string) => Promise<void>;
  sendReply: (input: EbayReplyInput) => Promise<EbayReplyResult>;
  suggestReply: (message: EbayMessage) => string; isCurrentScope: (scope: string) => boolean;
}
export const EbayMessagesContext = createContext<EbayMessagesContextValue | undefined>(undefined);
export function EbayMessagesProvider({ children }: { children: ReactNode }) {
  const guard = useModuleOperationGuard(); const { showAlert } = useAlert();
  const [snapshot, setSnapshot] = useState<{ scope: string; rows: EbayMessage[]; error: string | null; loading: boolean }>({ scope: '', rows: [], error: null, loading: false });
  const [syncScope, setSyncScope] = useState('');
  const sequence = useRef(0), syncFlight = useRef('');
  const refresh = useCallback(async () => {
    const scope = guard.scope; if (!guard.isCurrent(scope)) return;
    const version = ++sequence.current;
    setSnapshot(previous => ({ scope, rows: previous.scope === scope ? previous.rows : [], error: null, loading: true }));
    try {
      const result = await listEbayMessages(guard.tenantId);
      if (!guard.isCurrent(scope) || version !== sequence.current) return;
      setSnapshot({ scope, rows: result.error ? [] : result.messages, error: result.error, loading: false });
    } catch (cause) {
      if (guard.isCurrent(scope) && version === sequence.current) setSnapshot({ scope, rows: [], error: cause instanceof Error ? cause.message : 'Messages could not be loaded.', loading: false });
    }
  }, [guard.scope, guard.tenantId, guard.isCurrent]);
  const sync = useCallback(async () => {
    const scope = guard.scope; if (!guard.isCurrent(scope) || syncFlight.current === scope) return;
    syncFlight.current = scope; setSyncScope(scope);
    try {
      const result = await syncEbayMessages(guard.tenantId);
      if (!guard.isCurrent(scope)) return;
      await refresh();
      if (guard.isCurrent(scope) && result.error) showAlert('Message sync incomplete', result.error);
    } finally { if (syncFlight.current === scope) syncFlight.current = ''; if (guard.isCurrent(scope)) setSyncScope(''); }
  }, [guard.scope, guard.tenantId, guard.isCurrent, refresh, showAlert]);
  const flag = useCallback(async (id: string, field: 'is_read' | 'is_archived') => {
    const scope = guard.scope;
    if (!guard.isCurrent(scope) || snapshot.scope !== scope || !snapshot.rows.some(row => row.id === id)) return;
    try {
      const result = await updateEbayMessageFlag(guard.tenantId, id, field);
      if (!guard.isCurrent(scope)) return;
      if (result.error) { showAlert('Message change not confirmed', result.error); return; }
      setSnapshot(previous => previous.scope !== scope ? previous : { ...previous, rows: previous.rows.map(row => row.id === id ? { ...row, ...(field === 'is_read' ? { isRead: true } : { isArchived: true }) } : row) });
    } catch (cause) {
      if (guard.isCurrent(scope)) showAlert('Message change not confirmed', cause instanceof Error ? cause.message : 'Connection failed. Reload before retrying.');
    }
  }, [guard.scope, guard.tenantId, guard.isCurrent, snapshot, showAlert]);
  const markRead = useCallback((id: string) => flag(id, 'is_read'), [flag]);
  const archive = useCallback((id: string) => flag(id, 'is_archived'), [flag]);
  const sendReply = useCallback(async (input: EbayReplyInput): Promise<EbayReplyResult> => {
    const scope = guard.scope;
    if (!guard.isCurrent(scope) || snapshot.scope !== scope || !snapshot.rows.some(row => row.id === input.messageId)) return { ebaySuccess: false, localSyncPending: false, message: '', error: 'Message is not in the active workspace. Reopen the inbox.' };
    const result = await sendEbayReply(guard.tenantId, input);
    if (!guard.isCurrent(scope)) return { ebaySuccess: false, localSyncPending: false, message: '', error: 'Workspace changed. Check the original conversation before sending again.' };
    if (result.ebaySuccess) setSnapshot(previous => previous.scope !== scope ? previous : { ...previous, rows: previous.rows.map(row => row.id === input.messageId ? { ...row, isReplied: true } : row) });
    return result;
  }, [guard.scope, guard.tenantId, guard.isCurrent, snapshot]);
  const current = guard.ready && snapshot.scope === guard.scope;
  return <EbayMessagesContext.Provider value={{ scope: guard.scope, ready: guard.ready, messages: current ? snapshot.rows : [], error: current ? snapshot.error : null, loading: guard.ready && (!current || snapshot.loading), syncing: guard.ready && syncScope === guard.scope, refresh, sync, markRead, archive, sendReply, suggestReply: suggestEbayReply, isCurrentScope: guard.isCurrent }}>{children}</EbayMessagesContext.Provider>;
}
