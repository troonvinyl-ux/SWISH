import { Component, useEffect, type ReactNode } from 'react';
import type { ExpoUpdatesRuntime, NativeUpdateState } from '@/services/appUpdatesRuntimeService';
import { idleNativeUpdateState } from '@/services/appUpdatesRuntimeService';

interface NativeUpdateObserverProps {
  useNativeUpdates: ExpoUpdatesRuntime['useUpdates'];
  onState: (state: NativeUpdateState) => void;
}
/** Only mounted by the update provider when the installed runtime supports updates. */
export function NativeUpdateObserver({ useNativeUpdates, onState }: NativeUpdateObserverProps) {
  const nativeState = useNativeUpdates();
  useEffect(() => {
    onState({ isChecking: nativeState.isChecking === true, isDownloading: nativeState.isDownloading === true, isUpdatePending: nativeState.isUpdatePending === true });
  }, [nativeState.isChecking, nativeState.isDownloading, nativeState.isUpdatePending, onState]);
  return null;
}
interface NativeUpdateObserverBoundaryProps { children: ReactNode; onState: (state: NativeUpdateState) => void }
/** A preview/native-hook mismatch must not unmount auth, navigation or a capture. */
export class NativeUpdateObserverBoundary extends Component<NativeUpdateObserverBoundaryProps, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onState(idleNativeUpdateState); }
  render() { return this.state.failed ? null : this.props.children; }
}
