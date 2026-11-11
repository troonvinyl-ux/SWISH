// Mocked persistence/short-flow contracts. Does not publish or process actual photographs.
jest.mock('@react-native-async-storage/async-storage',()=>({getItem:jest.fn(),setItem:jest.fn()}));
jest.mock('@/template',()=>({getSupabaseClient:jest.fn()}));
jest.mock('../aiIdentificationService',()=>({identifyItemWithAI:jest.fn(),saveIdentifiedItem:jest.fn(),prepareImageForAI:jest.fn()}));
jest.mock('../listingService',()=>({generateListing:jest.fn(),saveListing:jest.fn(),submitListingToMarketplace:jest.fn()}));
jest.mock('../listingEditorService',()=>({invokeListingOperation:jest.fn(),saveListingEditor:jest.fn()}));
jest.mock('../marketValueService',()=>({getMarketValue:jest.fn()}));
jest.mock('../photoPersistenceService',()=>({persistCapturedItemPhotos:jest.fn()}));
jest.mock('../smartStudioStorageService',()=>({linkStudioImages:jest.fn()}));
jest.mock('../itemService',()=>({getItem:jest.fn()}));
import fs from 'node:fs';
import {getItem} from '../itemService';
import {saveListingEditor} from '../listingEditorService';
import {submitListingToMarketplace} from '../listingService';
import {saveQuickReview} from '../quickListService';
import {backgroundEraseQuality} from './fixtures/backgroundEraseFixture';
import {SMART_STUDIO_VERSION} from '@/shared/smartStudio';
const original='https://stored.test/front.jpg',processed='https://stored.test/front.png';
const draft:any={itemId:'item',listing:{id:'draft',shippingCost:0},quantity:1,photos:[original],requirements:{categoryId:'',categoryName:'',error:'Taxonomy unavailable',aspects:[],conditions:{categoryId:'',itemConditionRequired:false,itemConditions:[]}}};
const input={title:'Observed product',description:'Observed condition only',price:'',conditionId:'',conditionNotes:'',specifics:[]};
beforeEach(()=>{jest.clearAllMocks();(getItem as jest.Mock).mockResolvedValue({error:null,item:{tenantId:'tenant',specialistId:'collectibles',condition:'Not assessed',sku:'',inventoryId:'SWISH-1',media:[original],attributes:{_smart_studio_images:{front:{version:SMART_STUDIO_VERSION,status:'ready',originalUri:original,enhancedUri:processed,quality:backgroundEraseQuality}}}}});(saveListingEditor as jest.Mock).mockResolvedValue({error:null});});
test('Save for later persists a zero-price incomplete draft without publication, fabricated condition or original thumbnails',async()=>{
 expect(await saveQuickReview('tenant','collectibles',draft,input,'draft')).toEqual({error:null});
 expect(saveListingEditor).toHaveBeenCalledWith(expect.objectContaining({listingId:'draft',price:'0',condition:'Not assessed',conditionId:'',sku:'SWISH-1',media:[original]}));
 expect(submitListingToMarketplace).not.toHaveBeenCalled();
});
test('the same incomplete draft cannot be published without verified requirements',async()=>{expect((await saveQuickReview('tenant','collectibles',draft,input,'publish')).error).toBe('Taxonomy unavailable');expect(saveListingEditor).not.toHaveBeenCalled();expect(submitListingToMarketplace).not.toHaveBeenCalled();});
test('wrong-tenant drafts cannot even be saved for later',async()=>{expect((await saveQuickReview('other-tenant','collectibles',draft,input,'draft')).error).toMatch(/ownership/);expect(saveListingEditor).not.toHaveBeenCalled();});
test('ordinary capture has Next followed by List now or Save for later, with no forced second review',()=>{
 const ui=fs.readFileSync('components/feature/QuickListWorkspace.tsx','utf8');expect(ui).toContain("'Next'");expect(ui).toContain("pathname:'/ebay-listing-editor'");expect(ui).not.toContain('<ListingReadyPanel');expect(ui).not.toContain('APPROVE REVIEW');expect(ui).not.toContain('Prepare with retained evidence');
 const create=fs.readFileSync('app/create-listing.tsx','utf8');expect(create).toContain('usePreparedListing');expect(create).not.toContain('Generate Listing');expect(create).not.toContain('runEbayVisualSearch');
 const editor=fs.readFileSync('app/ebay-listing-editor.tsx','utf8');expect(editor).toContain('editor.submit()');expect(editor).toContain("?'Revise on eBay':'List now'");expect(editor).toContain('>Save for later</Text>');expect(editor).toContain('<ListingCopyFields');expect(editor).not.toContain("pathname:'/listing-preflight'");
});
