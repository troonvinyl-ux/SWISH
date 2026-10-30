import fs from 'node:fs';
import path from 'node:path';
const source=(name:string)=>fs.readFileSync(path.resolve(__dirname,'../..',name),'utf8');
describe('Specialist persistence boundary contracts (source checks, not integration tests)',()=>{
  test('draft save uses one atomic canonical command rather than independent inserts',()=>{ expect(source('services/listingService.ts')).toContain("rpc('swish_create_listing_draft'"); });
  test('photo retry records canonical item ID before uploads',()=>{ const code=source('hooks/useGenericCapture.ts');expect(code.indexOf('id=response.item.id')).toBeLessThan(code.indexOf('await uploadItemImages'));expect(code).toContain('if(!id)');expect(code).toContain('persistCaptureDraft(scope,savedDraft)'); });
  test('shared analysis and evidence survive canonical inventory creation',()=>{ const code=source('services/aiIdentificationService.ts');expect(code).toContain('_identification_evidence:');expect(code).toContain('_specialist_analysis: result.specialistAnalysis'); });
  test('field edits use tenant, niche and optimistic concurrency boundaries',()=>{ const code=source('services/specialistItemService.ts');expect(code).toContain(".eq('tenant_id',tenantId).in('specialist_id',specialists)");expect(code).toContain(".eq('updated_at',row.updated_at)");expect(code).toContain('_specialist_corrections'); });
  test('ordinary capture navigation does not call AI until requested',()=>{ const code=source('hooks/useGenericCapture.ts');const effect=code.slice(code.indexOf('useEffect(()=>'),code.indexOf('const changeMode='));expect(effect).not.toContain('identifyItemWithAI('); });
});
