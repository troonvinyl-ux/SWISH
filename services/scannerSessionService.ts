import type { CaptureDraft } from './captureDraftService';

/** New scanner visits never hydrate another physical item's photos or identity. */
export function createEmptyCaptureDraft(specialistId: string): CaptureDraft {
  return { images: [], result: null, savedId: null, mode: 'item', specialistId, answers: {} };
}

/** A scope alone is not sufficient: leaving and returning must reject late work. */
export function createScannerSession() {
  let sequence = 0;
  // A fresh process or remounted scanner must not recycle scan-1 for another copy.
  const visitNamespace = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,12)}`;
  const session = {
    current: '',
    begin(ownerScope: string): string {
      session.current = `${ownerScope}:scan-${visitNamespace}-${++sequence}`;
      return session.current;
    },
    end(token: string): void {
      if (session.current === token) session.current = '';
    },
    isCurrent(token: string): boolean {
      return Boolean(token) && session.current === token;
    },
  };
  return session;
}
