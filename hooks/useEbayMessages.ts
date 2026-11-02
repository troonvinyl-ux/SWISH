import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth, useAlert } from '@/template';
import { useApp } from './useApp';
import { listEbayMessages, syncEbayMessages, sendEbayReply, updateEbayMessageFlag, type EbayMessage, type EbayReplyInput, type EbayReplyResult } from '@/services/ebayMessageService';
interface Snapshot { scope: string; messages: EbayMessage[]; loading: boolean; error: string | null }
export function useEbayMessages() {
  const { tenant } = useApp(); const { user } = useAuth(); const { showAlert } = useAlert();
  const scope = `${user?.id ?? ''}:${tenant?.id ?? ''}`;
  const current = useRef(scope); current.current = scope;
  const generation = useRef(0); const operation = useRef(false);
  const [snapshot, setSnapshot] = useState<Snapshot>({ scope: '', messages: [], loading: false, error: null });
  const [syncing, setSyncing] = useState(false);
  const load = useCallback(async () => {
    const version = ++generation.current;
    if (!tenant?.id || !user) { setSnapshot({ scope, messages: [], loading: false, error: null }); return; }
    setSnapshot(previous => ({ scope, messages: previous.scope === scope ? previous.messages : [], loading: true, error: null }));
    try {
      const result = await listEbayMessages(tenant.id);
      if (current.current !== scope || generation.current !== version) return;
      setSnapshot({ scope, messages: result.messages, loading: false, error: result.error });
    } catch {
      if (current.current === scope && generation.current === version) setSnapshot({ scope, messages: [], loading: false, error: 'Messages could not be loaded. Retry.' });
    }
  }, [tenant?.id, user?.id, scope]);
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);
  const handleSync = useCallback(async () => {
    if (!tenant?.id || operation.current) return;
    operation.current = true; setSyncing(true);
    try {
      const result = await syncEbayMessages(tenant.id);
      if (current.current !== scope) return;
      if (result.error) showAlert('Sync incomplete', result.error);
      await load();
    } finally { operation.current = false; if (current.current === scope) setSyncing(false); }
  }, [tenant?.id, scope, showAlert, load]);
  useEffect(() => { setSyncing(false); }, [scope]);
  const changeFlag = useCallback(async (id: string, flag: 'is_read' | 'is_archived') => {
    if (!tenant?.id) return;
    const result = await updateEbayMessageFlag(tenant.id, id, flag);
    if (current.current !== scope) return;
    if (result.error) { showAlert('Message change failed', result.error); return; }
    setSnapshot(previous => previous.scope === scope ? { ...previous, messages: previous.messages.map(message => message.id === id ? { ...message, ...(flag === 'is_read' ? { isRead: true } : { isArchived: true }) } : message) } : previous);
  }, [tenant?.id, scope, showAlert]);
  const reply = useCallback(async (params: EbayReplyInput): Promise<EbayReplyResult> => {
    if (!tenant?.id || operation.current) return { ebaySuccess: false, localSyncPending: false, message: '', error: 'Another message operation is in progress or the business account is unavailable.' };
    operation.current = true;
    try {
      const result = await sendEbayReply(tenant.id, params);
      if (current.current !== scope) return { ebaySuccess: false, localSyncPending: false, message: '', error: 'Account changed. Check the original eBay conversation before retrying.' };
      if (result.ebaySuccess) await load();
      return result;
    } finally { operation.current = false; }
  }, [tenant?.id, scope, load]);
  const handleMarkRead = useCallback((id: string) => { void changeFlag(id, 'is_read'); }, [changeFlag]);
  const handleArchive = useCallback((id: string) => { void changeFlag(id, 'is_archived'); }, [changeFlag]);
  return { messages: snapshot.scope === scope ? snapshot.messages : [], loading: Boolean(tenant && user) && (snapshot.scope !== scope || snapshot.loading), error: snapshot.scope === scope ? snapshot.error : null, syncing, load, handleSync, handleMarkRead, handleArchive, reply };
}
