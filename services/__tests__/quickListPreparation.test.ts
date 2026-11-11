// Mocked shared-service preparation. No paid provider calls, live inventory or publication.
jest.mock('@react-native-async-storage/async-storage',()=>({getItem:jest.fn(),setItem:jest.fn()}));
jest.mock('@/template',()=>({getSupabaseClient:jest.fn()}));
jest.mock('@/services/aiIdentificationService',()=>({identifyItemWithAI:jest.fn(),saveIdentifiedItem:jest.fn(),prepareImageForAI:jest.fn()}));
jest.mock('@/services/listingService',()=>({generateListing:jest.fn(),saveListing:jest.fn(),submitListingToMarketplace:jest.fn()}));
jest.mock('@/services/listingEditorService',()=>({invokeListingOperation:jest.fn(),saveListingEditor:jest.fn()}));
jest.mock('@/services/marketValueService',()=>({getMarketValue:jest.fn()}));
jest.mock('@/services/photoPersistenceService',()=>({persistCapturedItemPhotos:jest.fn()}));
jest.mock('@/services/captureIdentityService',()=>({captureCanonicalId:jest.fn()}));
jest.mock('@/services/smartStudioStorageService',()=>({linkStudioImages:jest.fn()}));
jest.mock('@/services/itemService',()=>({getItem:jest.fn()}));
import {getSupabaseClient} from '@/template';
import {invokeListingOperation} from '../listingEditorService';
import {generateListing,saveListing} from '../listingService';
import {getMarketValue} from '../marketValueService';
import {getItem} from '../itemService';
import {quickRequirements,prepareQuickDraft} from '../quickListService';
const lead:any={categoryId:'100',categoryName:'Category'};
const requirements={categoryId:'100',categoryName:'Category',aspects:[],conditions:{categoryId:'100',itemConditionRequired:false,itemConditions:[]}};
const result:any={canonicalTitle:'Observed product',specialistId:'collectibles',attributes:{},attributesConfirmed:{},condition:'Used',confidence:0.9};
beforeEach(()=>{jest.resetAllMocks();(getSupabaseClient as jest.Mock).mockReturnValue({auth:{getSession:async()=>({data:{session:{user:{id:'user'}}},error:null})}});});
test('leaf/aspects and conditions use two parallel calls, not duplicate Taxonomy validation',async()=>{
 (invokeListingOperation as jest.Mock).mockImplementation(async(body:any)=>body.route==='get_category_aspects'?{error:null,data:{success:true,isLeaf:true,marketplaceId:'EBAY_GB',categoryId:'100',aspects:[]}}:{error:null,data:{policy:requirements.conditions}});
 const found=await quickRequirements('tenant-one','Product',lead,'collectibles');expect(found.categoryId).toBe('100');expect(invokeListingOperation).toHaveBeenCalledTimes(2);expect((invokeListingOperation as jest.Mock).mock.calls.map(call=>call[0].route)).not.toContain('validate_category');
 await quickRequirements('tenant-one','Product',lead,'collectibles');expect(invokeListingOperation).toHaveBeenCalledTimes(2);
 await quickRequirements('tenant-two','Product',lead,'collectibles');expect(invokeListingOperation).toHaveBeenCalledTimes(4);
});
test('unverified taxonomy errors are not cached as successful requirements',async()=>{
 let broken=true;(invokeListingOperation as jest.Mock).mockImplementation(async(body:any)=>body.route==='get_category_aspects'?{error:broken?'unavailable':null,data:broken?null:{success:true,isLeaf:true,marketplaceId:'EBAY_GB',categoryId:'100',aspects:[]}}:{error:null,data:{policy:requirements.conditions}});
 await expect(quickRequirements('failed-tenant','Product',lead,'collectibles')).rejects.toThrow('unavailable');broken=false;await expect(quickRequirements('failed-tenant','Product',lead,'collectibles')).resolves.toHaveProperty('categoryId','100');expect(invokeListingOperation).toHaveBeenCalledTimes(4);
});
test('unavailable valuation produces no invented positive price or false completion stamp',async()=>{
 (generateListing as jest.Mock).mockResolvedValue({listing:{title:'Observed product',description:'Seller evidence',recommended_price:999},error:null});
 (getMarketValue as jest.Mock).mockResolvedValue({result:null,error:'No market evidence'});
 (getItem as jest.Mock).mockResolvedValue({item:{tenantId:'tenant',specialistId:'collectibles',media:['https://stored/front','https://stored/back'],attributes:{}},error:null});
 (saveListing as jest.Mock).mockResolvedValue({listing:{id:'draft',shippingCost:0},error:null});const stamp=jest.fn();
 const draft=await prepareQuickDraft('tenant','collectibles','canonical',result,Promise.resolve({urls:['https://stored/front','https://stored/back'],images:[]}),Promise.resolve(requirements),stamp,undefined,'session-one');
 expect(draft.generated.recommended_price).toBe(0);expect(draft.market).toBeNull();expect(draft.warnings?.[0]).toContain('Market value unavailable');expect(stamp).not.toHaveBeenCalled();expect(saveListing).toHaveBeenCalledWith('tenant','canonical',expect.any(Object),'ebay','100');
});
test('unlinked originals block draft creation on the existing canonical item',async()=>{
 (generateListing as jest.Mock).mockResolvedValue({listing:{title:'Product',description:'Evidence'},error:null});(getMarketValue as jest.Mock).mockResolvedValue({result:null,error:'Unavailable'});(getItem as jest.Mock).mockResolvedValue({item:{tenantId:'tenant',specialistId:'collectibles',media:['https://stored/front'],attributes:{}},error:null});
 await expect(prepareQuickDraft('tenant','collectibles','partial',result,Promise.resolve({urls:['https://stored/front','https://stored/back'],images:[]}),Promise.resolve(requirements),()=>{},undefined,'session-two')).rejects.toThrow('not all linked');expect(saveListing).not.toHaveBeenCalled();
});
