import fs from 'node:fs';
import path from 'node:path';
import registry from '../../niche-modules.json';
import { NICHES } from '@/constants/niches';
import { SPECIALISTS } from '@/constants/specialists';
import { getSpecialistProfile } from '@/shared/specialistIntelligence';
import { resolveNicheFromNativeAppId, isRouteAllowedForBuild, getProductionNicheSpecialistIds } from '@/services/nicheRouting';
const source=(file:string)=>fs.readFileSync(path.join(process.cwd(),file),'utf8');
describe('Unified portfolio acceptance foundation',()=>{
 test('original eleven plus music share one canonical registry',()=>expect(Object.keys(registry.products)).toHaveLength(13));
 test.each(Object.entries(registry.products))('%s has isolated ownership and all five footer destinations',(id,product)=>{
  expect(resolveNicheFromNativeAppId(product.androidPackage)).toBe(id);
  expect(NICHES[id as keyof typeof NICHES].defaultSpecialist).toBe(product.defaultSpecialist);
  expect(SPECIALISTS[product.defaultSpecialist as keyof typeof SPECIALISTS].captureRequirements.some(slot=>slot.required)).toBe(true);
  expect(getSpecialistProfile(id)?.fields.length).toBeGreaterThan(0);
  const allowed=('buildSharedRoutes' in product?product.buildSharedRoutes:registry.sharedRoutes) as string[];
  for(const route of ['index','scan','inventory','listings','account']) expect(allowed).toContain('(tabs)/'+route+'.tsx');
  for(const [otherId,other] of Object.entries(registry.products)) {
   if(otherId===id) continue;
   expect(isRouteAllowedForBuild('/'+other.entry.replace('.tsx',''),id)).toBe(false);
   expect(getProductionNicheSpecialistIds(id).filter(specialist=>other.specialists.includes(specialist as never))).toEqual([]);
  }
 });
 test('Collectibles does not own any coin specialist or dedicated route',()=>{
  expect(registry.products.collectibles.specialists).toEqual(['collectibles']);
  expect(registry.products.collectibles.androidPackage).toBe('com.swish.collectiblesflipper');
  expect(registry.products.collectibles.dedicatedRoutes).toEqual([]);
  expect(isRouteAllowedForBuild('/coin-flipper','collectibles')).toBe(false);
 });
 test('OAuth start never writes to active marketplace credentials',()=>{
  const oauth=source('supabase/functions/swish-ebay-oauth/index.ts');
  const start=oauth.split('async function createOAuthSession(')[1].split('async function handleSubscriberAuthorization(')[0];
  expect(start).not.toContain(".from('marketplace_connectors')");
  expect(start).toContain('pending_credential_ref: credentialRef');
  expect(oauth).toContain(".eq('used', false).gt('expires_at'");
 });
 test('listing dependency is packaged and marketplace writes have resource gates',()=>{
  expect(fs.existsSync('supabase/functions/_shared/edgeFunctionLogging.ts')).toBe(true);
  expect(source('supabase/functions/swish-ebay-list/index.ts')).toContain("['publish', 'revise', 'end', 'revise_sku']");
  expect(source('supabase/functions/swish-ebay-list/index.ts')).toContain('aspect.localizedAspectName');
 });
 test('native artifacts fail closed without approved persistent certificate',()=>{
  expect(source('scripts/verify-apk.sh')).toContain('SWISH_RELEASE_CERT_SHA256');
  expect(source('.github/workflows/build-swish-suite.yml')).toContain('tech, collectibles]');
  expect(source('.github/workflows/_niche-android.yml')).toContain('configure-niche-signing.mjs');
 });
});
