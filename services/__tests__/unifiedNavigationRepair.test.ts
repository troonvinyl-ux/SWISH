import fs from 'node:fs';
import path from 'node:path';
import registry from '../../niche-modules.json';
import { isRouteAllowedForModule, resolveProductionNiche } from '../nicheRouting';
const root=path.resolve(__dirname,'../..');
const source=(file:string)=>fs.readFileSync(path.join(root,file),'utf8');
describe('Unified navigation regression contracts (not installed-device acceptance)',()=>{
 test.each(Object.entries(registry.products))('%s has a canonical, entitled entry and an isolated scanner', (id,module)=>{
  expect(resolveProductionNiche(module.defaultSpecialist)).toBe(id);
  expect(source(`app/${module.entry}`)).toContain(`nicheId="${id}"`);
  const route=module.modulePath.replace(/^\//,'');
  expect(fs.existsSync(path.join(root,'app',route+'.tsx'))).toBe(true);
  expect(isRouteAllowedForModule(module.scannerRoute,id)).toBe(true);
  for(const other of Object.keys(registry.products).filter(value=>value!==id))expect(isRouteAllowedForModule('/'+registry.products[other as keyof typeof registry.products].entry.replace(/\.tsx$/,''),id)).toBe(false);
 });
 test('the root navigator is not keyed or replaced by authorization spinners',()=>{
  expect(source('app/_layout.tsx')).not.toMatch(/Provider\s+key=/);
  const guard=source('components/layout/NicheRouteBoundary.tsx');
  expect(guard).toContain('{children}</View>');expect(guard).not.toMatch(/if\s*\(loading\s*\|\|\s*moduleLoading\)\s*return/);
 });
 test('card selection uses the canonical entry and module errors are not redirects',()=>{
  expect(source('hooks/useUnifiedShell.ts')).toContain('router.replace(moduleEntryPath(id)');
  expect(source('components/layout/ModuleEntry.tsx')).not.toMatch(/if\s*\(!permitted\s*\|\|\s*error\)\s*return\s*<Redirect/);
  expect(source('app/index.tsx')).toContain('app.isMasterAdmin, app.activeNicheId');
 });
 test('collectibles dashboard actions resolve to registered shared workflows',()=>{
  for(const route of ['/capture','/opportunities','/ebay-import','/create-listing','/stock-listing/real-id','/inventory'])expect(isRouteAllowedForModule(route,'collectibles')).toBe(true);
  expect(source('components/feature/ModuleHome.tsx')).toContain("nicheId==='collectibles'?<Collectibles/>");
  expect(source('hooks/useCollectiblesDashboard.ts')).toContain('/create-listing?id=');
 });
 test('Antiques standard footer order is Home, Inventory, Camera, Listings, More',()=>{
  const tabs=source('app/(tabs)/_layout.tsx');const names=['index','inventory','scan','listings','account'];const offsets=names.map(name=>tabs.indexOf(`name="${name}"`));expect(offsets.every(value=>value>=0)).toBe(true);expect(offsets).toEqual([...offsets].sort((a,b)=>a-b));expect(tabs).not.toContain('<Tabs key=');
 });
 test('live eBay diagnostics reject HTTP error bodies before returning policies',()=>{
  const server=source('supabase/functions/swish-ebay-list/index.ts');expect(server).toContain('if (!response.ok) throw new Error(`eBay ${name} policy API returned HTTP ${response.status}');
  expect(server).toContain('diagnostics: { live: true');
 });
 test('verification requires trusted backend ownership, never publishes and exposes no credential fields',()=>{
  const runner=source('supabase/functions/swish-verification/index.ts');expect(runner).toContain("admin.rpc('swish_owner_for_user'");expect(runner).toContain('owner.data !== true');expect(runner).not.toContain("route: 'publish'");expect(runner).not.toContain("from('items').insert");expect(runner).not.toContain('credential_ref');
 });
 test('client/backend specialist prompts remain byte-identical',()=>{expect(source('shared/specialistIntelligence.ts')).toBe(source('supabase/functions/_shared/specialistIntelligence.ts'));});
});
