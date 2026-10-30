// Surplus Flip uses the shared manifest/decomposition engine, not a separate inventory stack.
// Canonical specialist remains surplus_trader; all persistence is performed by services + RLS RPC.
import { ManifestOpportunityWorkspace } from '@/components/feature/ManifestOpportunityWorkspace';
interface SurplusFlipScreenProps { isHomeTab?: boolean }
export default function SurplusFlipScreen({ isHomeTab = false }: SurplusFlipScreenProps) {
  return <ManifestOpportunityWorkspace isHomeTab={isHomeTab}/>;
}
