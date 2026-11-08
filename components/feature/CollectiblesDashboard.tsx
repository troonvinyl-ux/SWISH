import { memo } from 'react';
import { SharedNicheDashboard } from './SharedNicheDashboard';

interface CollectiblesDashboardProps { embedded?: boolean }
/** The original design is now the shared template; this entry remains compatible. */
export const CollectiblesDashboard = memo(function CollectiblesDashboard(_props: CollectiblesDashboardProps) {
  return <SharedNicheDashboard nicheId="collectibles" embedded={_props.embedded} />;
});
