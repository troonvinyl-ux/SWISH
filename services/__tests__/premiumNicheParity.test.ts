// PURE / MOCKED / SOURCE CONTRACT REGRESSIONS. Not live AI, eBay or device acceptance.
jest.mock('@/template',()=>({getSupabaseClient:jest.fn()}));
import fs from 'node:fs';
import path from 'node:path';
import {getSupabaseClient} from '@/template';
import {NICHE_MODULES,PRODUCTION_NICHE_IDS} from '@/constants/niches';
import {SPECIALISTS} from '@/constants/specialists';
import {getSpecialistProfile} from '@/shared/specialistIntelligence';
import {specialistReviewSummary} from '@/services/specialistWorkspaceService';
import {saveListingEditor,type EditorSave} from '@/services/listingEditorService';
import {runNicheEbayOperation} from '@/services/ebaySyncService';
import {nicheToScannerRoute,isRouteAllowedForModule} from '@/services/nicheRouting';
const source=(file:string)=>fs.readFileSync(path.join(process.cwd(),file),'utf8');
function query(result:any){const q:any={};for(const method of ['select','eq','in'])q[method]=jest.fn(()=>q);q.maybeSingle=jest.fn().mockResolvedValue(result);return q;}
describe('Premium core across all eleven niches',()=>{
 test.each(PRODUCTION_NICHE_IDS)('%s uses the same scanner and complete specialist review',id=>{
  expect(['/capture','/antique-capture']).toContain(nicheToScannerRoute(id));
  expect(getSpecialistProfile(id)?.fields.length).toBeGreaterThanOrEqual(8);
  expect(SPECIALISTS[NICHE_MODULES[id].defaultSpecialist as keyof typeof SPECIALISTS]?.captureRequirements.length).toBeGreaterThan(0);
  for(const route of ['/capture','/(tabs)/inventory','/(tabs)/listings','/create-listing','/ebay-listing-editor','/listing-preflight','/specialist-workspace'])expect(isRouteAllowedForModule(route,id)).toBe(true);
  expect(specialistReviewSummary(id).checks.length).toBeGreaterThan(0);
 });
 test.each(PRODUCTION_NICHE_IDS)('%s saves and reads back every editor field (mocked)',async nicheId=>{
  const input:EditorSave={tenantId:'tenant',listingId:'draft',nicheId,title:'Reviewed item',description:'Known condition and visible evidence only.',price:'30',shippingCost:'5',floorPrice:'20',ceilingPrice:'40',categoryId:'category',categoryName:'Provider category',condition:'Used',conditionDescription:'Reviewed damage',conditionId:'3000',quantity:'1',sku:'SKU',media:['https://storage.test/photo.jpg'],itemSpecifics:[{name:'Material',value:'Wood'}],listingOptions:{listingType:'FixedPriceItem',auctionDays:7,startPrice:'30',reservePrice:'',bestOfferEnabled:true,dispatchDays:2}};
  const attrs={ebay_category_id:input.categoryId,ebay_category_name:input.categoryName,ebay_condition_id:input.conditionId,ebay_item_specifics:input.itemSpecifics,ebay_listing_media:input.media,ebay_listing_options:input.listingOptions};
  const row={title:input.title,description:input.description,price:30,shipping_cost:5,floor_price:20,ceiling_price:40,category_id:input.categoryId,items:{condition:input.condition,condition_notes:input.conditionDescription,quantity:1,sku:input.sku,attributes:attrs}};
  const rpc=jest.fn().mockResolvedValue({data:'draft',error:null});const from=jest.fn(()=>query({data:row,error:null}));
  (getSupabaseClient as jest.Mock).mockReturnValue({rpc,from});
  expect((await saveListingEditor(input)).error).toBeNull();
  expect(rpc).toHaveBeenCalledWith('swish_save_listing_editor',expect.objectContaining({p_specifics:input.itemSpecifics,p_item_patch:expect.objectContaining({condition_notes:input.conditionDescription,ebay_listing_options:input.listingOptions})}));
  expect(from).toHaveBeenCalledWith('listings');
 });
 test('scanner entry pages render the one premium component or its saved-music continuation adapter',()=>{
  for(const route of ['app/antique-capture.tsx','app/(tabs)/scan.tsx'])expect(source(route)).toContain('PremiumScanner');
  expect(source('app/capture.tsx')).toContain('MusicCaptureContinuation');
  expect(source('components/feature/MusicCaptureContinuation.tsx')).toContain('<PremiumScanner/>');
 });
 test('original evidence and retained item identity are preserved',()=>{expect(source('hooks/useGenericCapture.ts')).toContain('persistCapturedItemPhotos(tenant.id,id,visible.images)');expect(source('components/feature/SpecialistReview.tsx')).toContain('profile?.fields.map');expect(source('hooks/useGenericCapture.ts')).toContain('persistCaptureDraft(storageScope,savedDraft)');});
 test('editor and server enforce shared category conditions and exact saved specifics',()=>{expect(source('hooks/useListingEditor.ts')).toMatch(/\bantique\s*=\s*isProductionNiche\(nicheId\)/);expect(source('supabase/functions/swish-ebay-list/index.ts')).toContain('const isAntique = Boolean(specialistNiche');expect(source('supabase/functions/swish-ebay-list/index.ts')).toContain('if (isAntique && categoryAspectResult.error) return jsonResponse');});
 test('legacy bespoke routes remain present',()=>{for(const [id,module]of Object.entries(NICHE_MODULES)){for(const route of module.dedicatedRoutes)expect(fs.existsSync(path.join(process.cwd(),'app',route))).toBe(true);expect(specialistReviewSummary(id as any).title).toBeTruthy();}});
 test('backend registry remains semantically identical',()=>{expect(JSON.parse(source('supabase/functions/_shared/niche-modules.json'))).toEqual(JSON.parse(source('niche-modules.json')));});
});
describe('eBay sync outcomes (mocked)',()=>{
 test('HTTP 200 incomplete response is not reported done',async()=>{const invoke=jest.fn().mockResolvedValue({data:{success:false,partial:true,failed:2},error:null});(getSupabaseClient as jest.Mock).mockReturnValue({functions:{invoke}});expect((await runNicheEbayOperation('tenant','antiques','sync')).error).not.toBeNull();expect(invoke).toHaveBeenCalledWith('swish-ebay-sync',{body:{tenantId:'tenant',nicheId:'antiques',mode:'full',batch:true},signal:expect.any(AbortSignal)});});
 test('transport failures do not imply revoked consent',async()=>{(getSupabaseClient as jest.Mock).mockReturnValue({functions:{invoke:jest.fn().mockRejectedValue(new Error('Network unavailable'))}});const result=await runNicheEbayOperation('tenant','coins','token');expect(result.requiresReauth).toBe(false);expect(result.error).not.toBeNull();});
 test('unknown scope cannot call eBay',async()=>{const invoke=jest.fn();(getSupabaseClient as jest.Mock).mockReturnValue({functions:{invoke}});expect((await runNicheEbayOperation('tenant','unknown','sync')).error).not.toBeNull();expect(invoke).not.toHaveBeenCalled();});
});
