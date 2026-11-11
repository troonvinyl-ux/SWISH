// Async work belongs to its captured account/module/listing scope, never the next editor.
import { useRef, useState } from 'react';
import type { ListingCopyField } from '@/services/listingCopyService';
export function useScopedListingActivity(scope: string) {
  const owner = useRef<string | null>(null);
  const [activity, setActivity] = useState({ scope: '', busy: false, generating: null as ListingCopyField | null });
  // Each async closure retains this scope. A late finally cannot unlock another workspace.
  const actionLock = {
    get current() { return owner.current === scope; },
    set current(value: boolean) { if (value) owner.current = scope; else if (owner.current === scope) owner.current = null; },
  };
  const setBusy = (busy: boolean) => setActivity(previous => busy ? { ...previous, scope, busy, generating: previous.scope === scope ? previous.generating : null } : previous.scope === scope ? { ...previous, busy } : previous);
  const setGenerating = (generating: ListingCopyField | null) => setActivity(previous => generating ? { ...previous, scope, generating } : previous.scope === scope ? { ...previous, generating: null } : previous);
  return { actionLock, busy: activity.scope === scope && activity.busy, generating: activity.scope === scope ? activity.generating : null, setBusy, setGenerating };
}
