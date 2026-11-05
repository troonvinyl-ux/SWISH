import { memo } from 'react';
import { SharedNicheDashboard } from './SharedNicheDashboard';

interface CollectiblesDashboardProps {}
/** The original design is now the shared template; this entry remains compatible. */
export const CollectiblesDashboard = memo(function CollectiblesDashboard(_props: CollectiblesDashboardProps) {
  return <SharedNicheDashboard nicheId="collectibles" />;
});
