// PURE / MOCKED / SOURCE TESTS, not live eBay or device acceptance.
jest.mock('@/template',()=>({getSupabaseClient:jest.fn()}));
import fs from 'node:fs';import path from 'node:path';
import {getSupabaseClient} from '@/template';
import {isBackendUnavailable,describeAccessFailure} from '@/services/backendAvailabilityService';
import {getAntiqueCategoryHint,rankAntiqueCategoryCandidates,suggestAntiqueCategories,saveAntiqueCategory} from '@/services/listingEditorService';
const item={canonicalTitle:'Apulian Style Red-Figure Stemmed Lekanis Lid',specialistId:'antiques',attributes:{}};
const source=(file:string)=>fs.readFileSync(path.join(process.cwd(),file),'utf8');
describe('Backend availability presentation',()=>{
 test.each(['Timed out acquiring connection from connection pool.','[503] Service unavailable','Network request failed','Gateway timeout'])('distinguishes %s from invalid credentials',message=>{expect(isBackendUnavailable(message)).toBe(true);expect(describeAccessFailure(message).title).toBe('SWISH backend temporarily unavailable');expect(describeAccessFailure(message).retryLabel).toBe('Retry connection');});
 test('actual authorization failures remain fail-closed',()=>{expect(isBackendUnavailable('Access denied')).toBe(false);expect(describeAccessFailure('Access denied').title).toBe('Account verification required');});
});
describe('Material-led Antique categories',()=>{
 test('Lekanis lid queries pottery without claiming ancient provenance',()=>{const hint=getAntiqueCategoryHint(item)!;expect(hint.label).toBe('Pottery / ceramics');expect(hint.query).toBe('pottery ceramic lekanis lid');expect(hint.query).not.toMatch(/ancient|authentic|greek coin/i);expect(hint.note).toMatch(/does not establish ancient origin or authenticity/);});
 test.each(['Porcelain bowl','Terracotta amphora','Stoneware vase','Earthenware plate'])('recognizes %s',title=>expect(getAntiqueCategoryHint({...item,canonicalTitle:title})?.ceramic).toBe(true));
 test('material assists category search for generic titles',()=>expect(getAntiqueCategoryHint({...item,canonicalTitle:'Decorated vessel',material:'Ceramic'})?.ceramic).toBe(true));
 test('does not change coin or unrelated furniture workflows',()=>{expect(getAntiqueCategoryHint({...item,specialistId:'coins'})).toBeNull();expect(getAntiqueCategoryHint({...item,canonicalTitle:'Oak writing desk'})?.ceramic).toBe(false);});
 test('does not mistake militaria, coins or a parent for a suitable leaf',()=>{
  const rows=[{id:'coin',name:'Ancient Greek Coins',isLeaf:true},{id:'military',name:'Ceramics/ Pottery',categoryPath:'Collectables > Militaria > Ceramics/ Pottery',isLeaf:true},{id:'parent',name:'Pottery, Ceramics & Glass',isLeaf:false},{id:'live-leaf',name:'Ceramic & Porcelain',categoryPath:'Antiques > Ceramic & Porcelain',isLeaf:true},{id:'live-leaf',name:'Duplicate ceramic result',isLeaf:true}];expect(rankAntiqueCategoryCandidates(rows,getAntiqueCategoryHint(item)!).map(row=>row.id)).toEqual(['live-leaf']);
 });
});
describe('Existing eBay integration reused',()=>{
 beforeEach(()=>jest.clearAllMocks());
 test('retrieves actual provider IDs preserving source/path without saving',async()=>{
  const invoke=jest.fn().mockResolvedValue({data:{success:true,source:'ebay_live',suggestions:[{id:'provider-id',name:'Ceramic & Porcelain',categoryPath:'Antiques > Ceramic & Porcelain',isLeaf:true}]},error:null});const rpc=jest.fn(),from=jest.fn();(getSupabaseClient as jest.Mock).mockReturnValue({functions:{invoke},rpc,from});
  const result=await suggestAntiqueCategories('tenant',item);expect(invoke).toHaveBeenCalledWith('swish-ebay-category',{body:{route:'get_category_suggestions',tenantId:'tenant',query:'pottery ceramic lekanis lid'}});expect(result.suggestions[0].id).toBe('provider-id');expect(result.source).toBe('ebay_live');expect(rpc).not.toHaveBeenCalled();expect(from).not.toHaveBeenCalled();
 });
 test('unrelated suggestions cannot silently become a ceramic category',async()=>{
  const invoke=jest.fn().mockResolvedValue({data:{success:true,suggestions:[{id:'coin',name:'Ancient Coins',isLeaf:true}]},error:null});(getSupabaseClient as jest.Mock).mockReturnValue({functions:{invoke}});const result=await suggestAntiqueCategories('tenant',item);expect(result.suggestions).toEqual([]);expect(result.error).toMatch(/No suitable pottery/);expect(invoke).toHaveBeenCalledTimes(2);
 });
 test('taxonomy uncertainty prevents a category write',async()=>{
  const from=jest.fn();(getSupabaseClient as jest.Mock).mockReturnValue({from,functions:{invoke:jest.fn().mockResolvedValue({data:{success:null,isLeaf:null,error:'Category remains unverified'},error:null})}});expect((await saveAntiqueCategory('tenant','item','unverified-id','Pottery')).error).not.toBeNull();expect(from).not.toHaveBeenCalled();
 });
});
describe('Retry and pool-pressure guards',()=>{
 test('module activation does not automatically loop after failure',()=>{const hook=source('hooks/useModuleEntry.ts');expect(hook).toContain('attempted.current === scope');expect(hook).toContain('flight.current');expect(hook).not.toContain('setAttempt');});
 test('optional settings are independent of account verification',()=>{
  const context=source('contexts/AppContext.tsx').split('const loadTenant =')[1].split('useEffect(')[0];expect(context.indexOf('await loadAccess()')).toBeLessThan(context.indexOf('void getBusinessConfig'));expect(context).not.toContain('if (config.error) throw');expect(context).toContain('tenantFlight.current');
 });
 test('badge requests are deduplicated and cannot run without verified access',()=>{expect(source('services/listingService.ts')).toContain('backendRead(`tab-counts:');expect(source('services/backendRequestService.ts')).toContain('flights.get(scopedKey)');expect(source('hooks/useNicheListingCount.ts')).toContain('!accessReady||moduleLoading');});
 test('automatically prepared categories remain editable and require live taxonomy',()=>{const page=source('app/create-listing.tsx');expect(page).toContain('<ListingReadyPanel');expect(page).toContain('Choose missing category');const service=source('services/quickListService.ts');expect(service).toContain('forceLive:true');expect(service).toContain("aspects.data?.isLeaf!==true");expect(source('supabase/functions/swish-ebay-category/index.ts')).toContain('if (forceLive) return { aspects: [], isLeaf: null');});
});
