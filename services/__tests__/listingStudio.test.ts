// Pure fixtures verify guidance policy; they are NOT live AI or device acceptance.
import fs from 'node:fs';
import { emptyStudio, nextStudioRole, normalizeStudioEvidence, studioConfiguration, studioSignature } from '../../shared/listingStudio';
import { PRODUCTION_NICHE_IDS } from '../../constants/niches';
const photo=(slotId:string)=>({slotId,uri:`file:///fixture-${slotId}.jpg`});
const evidence=(niche:string,images:Array<{slotId:string}>,raw:Record<string,unknown>)=>normalizeStudioEvidence(raw,'fixture',images,niche,PRODUCTION_NICHE_IDS);
test.each(PRODUCTION_NICHE_IDS)('registered niche %s has shared evidence roles and no invented prices',niche=>{
 const configuration=studioConfiguration(niche);expect(configuration.roles.length).toBeGreaterThan(1);expect(configuration.tools.length).toBeGreaterThan(0);expect(configuration).not.toHaveProperty('price');expect(emptyStudio(niche).evidence).toBeNull();
});
test('A: coin obverse leads to reverse, without re-requesting the supplied face',()=>{
 const images=[photo('obverse')];expect(nextStudioRole('coins',images,null).id).toBe('reverse');
 const assessed=evidence('coins',images,{nextRole:'obverse',candidate:'Provisional coin',photos:[{slotId:'obverse',role:'obverse',usable:true,observations:['Portrait visible']}],missing:['Reverse'],ready:true});
 expect(nextStudioRole('coins',images,assessed).id).toBe('reverse');expect(assessed.ready).toBe(false);
 expect(nextStudioRole('coins',[...images,photo('reverse')],evidence('coins',[...images,photo('reverse')],{nextRole:'legend'})).id).toBe('packet');
});
test('B: music front sleeve requests a label; matrix is evidence-triggered',()=>{
 const images=[photo('front_sleeve')];expect(nextStudioRole('tunes_flip',images,null).id).toBe('label_a');
 expect(nextStudioRole('tunes_flip',images,evidence('tunes_flip',images,{nextRole:'matrix',objectType:'vinyl'})).id).toBe('matrix');
});
test('C: tech asks for model evidence; clothing never demands coin faces',()=>{
 expect(nextStudioRole('tech',[photo('main')],null).id).toBe('model_label');
 expect(studioConfiguration('clothing','garment').roles.some(r=>r.id==='obverse'||r.id==='soles')).toBe(false);
 expect(studioConfiguration('clothing','sneaker').roles.some(r=>r.id==='soles')).toBe(true);
});
test('D: Auto Detect recommends canonical IDs, never aliases or invented niches',()=>{
 const images=[photo('main')];expect(evidence('auto',images,{recommendedNiche:'music'}).recommendedNiche).toBeNull();
 expect(evidence('auto',images,{recommendedNiche:'tunes_flip'}).recommendedNiche).toBe('tunes_flip');
 expect(nextStudioRole('auto',images,null).id).toBe('label');
});
test('books use title and edition evidence inside an existing niche',()=>{
 expect(studioConfiguration('antiques','book').roles.map(p=>p.id)).toContain('title_page');
 expect(nextStudioRole('antiques',[photo('main')],evidence('antiques',[photo('main')],{objectType:'book'})).id).toBe('title_page');
});
test('unknown scores and foreign photo evidence are never invented or accepted',()=>{
 const images=[photo('main')],assessed=evidence('tech',images,{confidence:0.99,ready:true,photos:[{slotId:'other-owner',role:'model_label',usable:true,observations:['Model']} ]});
 expect(assessed.confidence).toBeNull();expect(assessed.photos).toHaveLength(0);expect(assessed.ready).toBe(false);
});
test('unusable evidence permits an explicit retake, not repeated normal requests',()=>{
 const images=[photo('obverse'),photo('reverse')],assessed=evidence('coins',images,{nextRole:'reverse',photos:[{slotId:'reverse',role:'reverse',usable:false,limitations:['Glare obscures the legend']} ]});
 expect(nextStudioRole('coins',images,assessed).id).toBe('reverse');expect(nextStudioRole('coins',images,assessed).label).toMatch(/Retake/);
});
test('revision fingerprints detect notes, order and replacement without retaining image bytes',()=>{
 const images=[{slotId:'main',uri:'data:image/jpeg;base64,'+'a'.repeat(100000)}];const signature=studioSignature(images,'tech');
 expect(signature.length).toBeLessThan(100);expect(signature).not.toContain('base64');expect(studioSignature(images,'tech','correction')).not.toBe(signature);
 expect(studioSignature([photo('main'),photo('back')],'tech')).not.toBe(studioSignature([photo('back'),photo('main')],'tech'));
});
test('E/F source contract reuses full-screen camera and authoritative publication checks',()=>{
 const camera=fs.readFileSync('components/feature/SharedCaptureCamera.tsx','utf8'),ui=fs.readFileSync('components/feature/ListingStudioWorkspace.tsx','utf8'),service=fs.readFileSync('services/quickListService.ts','utf8'),scope=fs.readFileSync('supabase/functions/_shared/moduleScope.ts','utf8');
 expect(camera).toContain('StyleSheet.absoluteFillObject');expect(camera).toContain('enableTorch');expect(camera).toContain('autofocus="on"');expect(camera).toContain('props.studio.thumbnails');
 expect(ui).toContain('useListingStudio');expect(ui).toContain('state.unconfirmed');expect(ui).toContain('flow.checkLive()');expect(ui).toContain('flow.confirm(true)');
 expect(service).toContain("listingStatus!=='Active'");expect(service).toContain('confirmQuickLive');expect(service).toContain('draft.itemId');
 expect(scope).toContain("body.route==='studio_observe'");expect(scope).toContain('tenant_memberships');expect(scope).toContain('_studioAllowedNiches:allowed');
});


test('Done keeps the niche chooser inside the camera until draft review starts',()=>{
 const camera=fs.readFileSync('components/feature/SharedCaptureCamera.tsx','utf8');
 const studio=fs.readFileSync('hooks/useListingStudio.ts','utf8');
 const sheet=fs.readFileSync('components/feature/StudioToolSheet.tsx','utf8');
 expect(camera).toMatch(/accessibilityLabel="Done, build editable listing"[^\n]*onPress=\{props.studio.onDone\}/);
 expect(studio).toContain("if(!confirmCurrentNiche&&recommendation&&recommendation!==owner.niche){setSelectedPhoto(null);setPanel('niches')");
 expect(studio).toContain('setReview(true)');
 expect(sheet).toContain('onPress={p.confirmNicheAndBuild}');
});
