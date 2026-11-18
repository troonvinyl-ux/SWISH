import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { scannerShouldSuspend } from '@/services/scannerLifecycleService';

/** Shared camera/session lifecycle; browser access happens only after mounting. */
export function useScannerForeground() {
  const [foreground, setForeground] = useState(true);

  useEffect(() => {
    let nativeVisible = !scannerShouldSuspend(AppState.currentState);
    const update = () => setForeground(nativeVisible && (Platform.OS !== 'web' || typeof document === 'undefined' || !document.hidden));
    update();

    const subscription = AppState.addEventListener('change', state => {
      if (scannerShouldSuspend(state)) nativeVisible = false;
      else if (state === 'active') nativeVisible = true;
      update();
    });
    if (Platform.OS === 'web' && typeof document !== 'undefined') document.addEventListener('visibilitychange', update);

    return () => {
      subscription.remove();
      if (Platform.OS === 'web' && typeof document !== 'undefined') document.removeEventListener('visibilitychange', update);
    };
  }, []);

  return foreground;
}
