import { PremiumScanner } from '@/components/feature/PremiumScanner';
import { QuickListWorkspace } from '@/components/feature/QuickListWorkspace';
import { useApp } from '@/hooks/useApp';
import { resolveProductionNiche } from '@/services/nicheRouting';
/** Keep the Antique deep link and enforce its identity while sharing the short listing flow. */
export default function AntiqueCaptureScreen(){const {fixedNicheId,activeNicheId}=useApp();return resolveProductionNiche(fixedNicheId??activeNicheId)==='antiques'?<QuickListWorkspace nicheId="antiques" tabPage={false}/>:<PremiumScanner requiredNiche="antiques"/>;}
