import { useContext } from 'react';
import { WatchedLotsContext } from '@/contexts/WatchedLotsContext';

export function useWatchedLots() {
  const context = useContext(WatchedLotsContext);
  if (!context) throw new Error('useWatchedLots must be used within WatchedLotsProvider');
  return context;
}
