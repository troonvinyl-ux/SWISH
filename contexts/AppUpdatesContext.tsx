import { createContext, useState, type ReactNode } from 'react';
import { useAppUpdateController } from '@/hooks/useAppUpdateController';
import { getAppUpdatesRuntime, idleNativeUpdateState, supportsAppUpdates, type NativeUpdateState } from '@/services/appUpdatesRuntimeService';
import { NativeUpdateObserver, NativeUpdateObserverBoundary } from '@/components/feature/NativeUpdateObserver';
export type AppUpdatesContextType = ReturnType<typeof useAppUpdateController>;
export const AppUpdatesContext = createContext<AppUpdatesContextType | undefined>(undefined);
export function AppUpdatesProvider({ children }: { children: ReactNode }) {
  const [nativeState, setNativeState] = useState<NativeUpdateState>(idleNativeUpdateState);
  const updates = useAppUpdateController(nativeState);
  const runtime = supportsAppUpdates() ? getAppUpdatesRuntime() : null;
  const useNativeUpdates = runtime?.useUpdates;
  return <AppUpdatesContext.Provider value={updates}>
    {children}
    {typeof useNativeUpdates === 'function' ? <NativeUpdateObserverBoundary onState={setNativeState}>
      <NativeUpdateObserver useNativeUpdates={useNativeUpdates} onState={setNativeState} />
    </NativeUpdateObserverBoundary> : null}
  </AppUpdatesContext.Provider>;
}
