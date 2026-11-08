import { useContext } from 'react';
import { AppUpdatesContext } from '@/contexts/AppUpdatesContext';
// One updater is shared across the root notice, More and owner screens.
export function useAppUpdates() {
  const context = useContext(AppUpdatesContext);
  if (!context) throw new Error('useAppUpdates must be used within AppUpdatesProvider');
  return context;
}
