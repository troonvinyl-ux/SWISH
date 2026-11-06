import { ModuleEntry } from '@/components/layout/ModuleEntry';

/** Activate and verify the Collectibles server-side module scope before entering the app. */
export default function CollectiblesEntryRoute() {
  return <ModuleEntry nicheId="collectibles" />;
}
