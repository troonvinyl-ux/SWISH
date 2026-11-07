import { MusicCaptureContinuation } from '@/components/feature/MusicCaptureContinuation';
import { QuickListWorkspace } from '@/components/feature/QuickListWorkspace';
import { PremiumScanner } from '@/components/feature/PremiumScanner';
import { useApp } from '@/hooks/useApp';
import { useTunesCatalogue } from '@/hooks/useTunesCatalogue';
import { resolveProductionNiche } from '@/services/nicheRouting';
/** Default capture is Next -> List/Save. Catalogue-only music keeps its existing item identity. */
export default function CaptureScreen(){
 const {fixedNicheId,activeNicheId}=useApp();const tunes=useTunesCatalogue();const niche=resolveProductionNiche(fixedNicheId??activeNicheId);
 if(niche==='tunes_flip'&&tunes.state.savedId)return <MusicCaptureContinuation/>;
 return niche?<QuickListWorkspace nicheId={niche} tabPage={false}/>:<PremiumScanner/>;
}
