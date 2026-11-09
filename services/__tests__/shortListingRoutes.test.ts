// Source-only route contracts; not device/native or live seller acceptance.
import fs from 'node:fs';
const source=(path:string)=>fs.readFileSync(path,'utf8');
test('all normal scanner entry points share the short listing workspace',()=>{
 for(const path of ['app/capture.tsx','app/antique-capture.tsx','app/(tabs)/scan.tsx','app/coin-flipper.tsx'])expect(source(path)).toContain('QuickListWorkspace');
 expect(source('app/capture.tsx')).toContain('tunes.state.savedId');
 expect(source('app/antique-capture.tsx')).toContain('requiredNiche="antiques"');
});
test('save-only opens Draft while publish actions keep one real marketplace pipeline',()=>{
 expect(source('app/(tabs)/inventory.tsx').replace(/\s/g,'')).toContain("['stock','draft','live','sold'].includes(requestedTab)");
 expect(source('app/create-listing.tsx')).toContain("tab:'draft'");
 expect(source('components/feature/QuickListWorkspace.tsx')).toContain('flow.confirm(false)');
 expect(source('hooks/useListingEditor.ts')).toContain('submitListingToMarketplace(state.tenantId,state.listingId');
 expect(source('services/quickListService.ts')).toContain("if(mode==='draft')return {error:null}");
});
