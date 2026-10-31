import { createContext, useState, useEffect, useMemo, type ReactNode, type Dispatch, type SetStateAction } from 'react';
import { useAuth } from '@/template';
import { useApp } from '@/hooks/useApp';
import { emptyManifestSession, type ManifestSession } from '@/services/manifestSessionService';
export { emptyManifestSession, type ManifestSession } from '@/services/manifestSessionService';
interface ManifestOpportunityContextValue { scope: string; draft: ManifestSession; setDraft: Dispatch<SetStateAction<ManifestSession>> }
export const ManifestOpportunityContext = createContext<ManifestOpportunityContextValue | undefined>(undefined);
export function ManifestOpportunityProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth(); const { tenant, fixedNicheId, activeNicheId } = useApp();
  const scope = `${user?.id ?? ''}:${tenant?.id ?? ''}:${fixedNicheId ?? activeNicheId}`;
  const [sessions, setSessions] = useState<Record<string, ManifestSession>>({});
  // Account changes discard in-memory drafts; different niches never render the same draft.
  useEffect(() => { setSessions({}); }, [user?.id]);
  const empty = useMemo(emptyManifestSession, [scope]); const draft = sessions[scope] ?? empty;
  const setDraft: Dispatch<SetStateAction<ManifestSession>> = update => setSessions(previous => ({ ...previous,
    [scope]: typeof update === 'function' ? update(previous[scope] ?? empty) : update }));
  return <ManifestOpportunityContext.Provider value={{ scope, draft, setDraft }}>{children}</ManifestOpportunityContext.Provider>;
}
