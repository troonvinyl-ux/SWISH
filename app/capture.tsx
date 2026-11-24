import { useLocalSearchParams } from 'expo-router';
import { ListingStudioWorkspace } from '@/components/feature/ListingStudioWorkspace';
import { MusicCaptureContinuation } from '@/components/feature/MusicCaptureContinuation';
import { PremiumScanner } from '@/components/feature/PremiumScanner';
import { useApp } from '@/hooks/useApp';
import { useTunesCatalogue } from '@/hooks/useTunesCatalogue';
import { resolveProductionNiche } from '@/services/nicheRouting';
/** Default capture is Next -> List/Save. Catalogue-only music keeps its existing item identity. */
export default function CaptureScreen(){
 const {advanced}=useLocalSearchParams<{advanced?:string}>();
 const {fixedNicheId,activeNicheId}=useApp();const tunes=useTunesCatalogue();const niche=resolveProductionNiche(fixedNicheId??activeNicheId);
 if(niche==='tunes_flip'&&tunes.state.savedId)return <MusicCaptureContinuation/>;
 if(advanced==='1')return <PremiumScanner requiredNiche={niche??undefined}/>;
 return <ListingStudioWorkspace global={!niche}/>;
}
