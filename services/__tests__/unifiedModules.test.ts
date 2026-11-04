import fs from 'node:fs';
import path from 'node:path';
import registry from '../../niche-modules.json';
import { inferImportNiche } from '../../shared/ebayImportScope';
const root=path.resolve(__dirname,'../..');
describe('Unified SWISH module source contracts (not authenticated acceptance)',()=>{
 test.each(Object.entries(registry.products))('%s keeps its canonical identity and independent entry', (id,module)=>{
  expect(module.id).toBe(id);expect(module.specialists).toContain(module.defaultSpecialist);
  expect(fs.existsSync(path.join(root,'app',module.entry))).toBe(true);
  expect(fs.existsSync(path.join(root,'niches',id,'module.json'))).toBe(true);
  expect(module.specialists).not.toContain('curiosities_collectibles');
 });
 test('shared specialist ownership remains disjoint',()=>{
  const owners=new Map<string,string>();
  for(const [id,module] of Object.entries(registry.products))for(const specialist of [...module.specialists,...module.legacySpecialists]){
   expect(owners.get(specialist) ?? id).toBe(id);owners.set(specialist,id);
  }
 });
 test('the master selector no longer renders a public list of products',()=>{
  const selector=fs.readFileSync(path.join(root,'app/niche-select.tsx'),'utf8');expect(selector).toContain('/swish');expect(selector).not.toContain('PRODUCTION_NICHES');
 });
 test('all module source and server requests use trusted scope guards',()=>{
  const context=fs.readFileSync(path.join(root,'contexts/AppContext.tsx'),'utf8');expect(context).toContain('loadModuleAccess');expect(context).toContain('activateModuleScope');expect(context).not.toContain('isSwishMasterAdmin(user?.email)');
  for(const name of ['swish-identify','swish-islamic-identify','swish-market-value','swish-list-generate','swish-ebay-list','swish-ebay-sync','swish-ebay-orders','swish-image-download'])expect(fs.readFileSync(path.join(root,'supabase/functions',name,'index.ts'),'utf8')).toContain('serveModule(');
 });
 test('automatic eleven-channel OTA publication is retired',()=>{
  const workflow=fs.readFileSync(path.join(root,'.github/workflows/publish-ota-update.yml'),'utf8');expect(workflow).not.toContain('eas-cli');expect(workflow).not.toContain('matrix:');
 });
 test('uncertain import evidence cannot silently cross niches',()=>{
  expect(inferImportNiche('Clothing','REISS parka jacket')).toBe('clothing');
  expect(inferImportNiche('Coins','parka jacket')).toBeNull();
 });
 test('generated import classifier is byte-identical',()=>{
  expect(fs.readFileSync(path.join(root,'supabase/functions/_shared/ebayImportScope.ts'),'utf8')).toBe(fs.readFileSync(path.join(root,'shared/ebayImportScope.ts'),'utf8'));
 });
});
