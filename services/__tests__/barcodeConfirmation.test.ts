jest.mock('@react-native-async-storage/async-storage',()=>({setItem:jest.fn().mockResolvedValue(undefined)}));
jest.mock('@/template',()=>({getSupabaseClient:jest.fn()}));
jest.mock('../quickListService',()=>({createQuickInventory:jest.fn()}));
jest.mock('../captureIdentityService',()=>({captureCanonicalId:jest.fn().mockResolvedValue('canonical-item')}));
jest.mock('../itemService',()=>({getItem:jest.fn()}));
jest.mock('../listingService',()=>({saveListing:jest.fn(),getItemListings:jest.fn()}));
jest.mock('../photoPersistenceService',()=>({persistCapturedItemPhotos:jest.fn()}));
jest.mock('../aiIdentificationService',()=>({captureFromCamera:jest.fn(),pickFromLibrary:jest.fn()}));
jest.mock('../captureDraftService',()=>({retainCaptureImage:jest.fn()}));
import fs from 'node:fs';
import {getSupabaseClient} from '@/template';
import {NICHE_MODULES} from '@/constants/niches';
import {barcodeDraft,barcodeIdentificationForInventory,confirmBarcodeProduct} from '../barcodeConfirmationService';
import {createQuickInventory} from '../quickListService';
import {getItem} from '../itemService';
import {saveListing,getItemListings} from '../listingService';
import {persistCapturedItemPhotos} from '../photoPersistenceService';
import type {ProductLead} from '@/shared/quickList';
const lead:ProductLead={id:'ai:5014503238124:0',gtin:'5014503238124',title:'Doctor Who – Series 3, Volume 1',brand:'',publisher:'BBC',releaseYear:'2007',format:'DVD',specifics:{Publisher:'BBC',Format:'DVD','Release Year':'2007'},categoryId:'',categoryName:'',suggestedEbayCategory:'DVDs & Blu-rays',source:'OnSpace AI',url:'',sourceUrls:[],verificationStatus:'ai_suggested',confidence:0.79};
const item:any={id:'canonical-item',tenantId:'tenant',specialistId:NICHE_MODULES.collectibles.defaultSpecialist,media:[],attributes:{_capture_session_id:'scan',_barcode_identification:lead}};
const input=()=>({tenantId:'tenant',userId:'user',nicheId:'collectibles' as const,sessionId:'scan',lead,images:[],isCurrent:()=>true});
let stored:any=null;
beforeEach(()=>{
 jest.clearAllMocks();stored=null;
 const query:any={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:stored,error:null})};
 (getSupabaseClient as jest.Mock).mockReturnValue({auth:{getSession:async()=>({data:{session:{user:{id:'user'}}},error:null})},from:()=>query});
 (createQuickInventory as jest.Mock).mockImplementation(async()=>{stored={id:item.id,tenant_id:'tenant',specialist_id:item.specialistId,attributes:item.attributes};return item;});
 (getItem as jest.Mock).mockResolvedValue({item,error:null});
 (getItemListings as jest.Mock).mockResolvedValue({listings:[],error:null});
 (saveListing as jest.Mock).mockResolvedValue({listing:{id:'existing-draft'},error:null});
 (persistCapturedItemPhotos as jest.Mock).mockResolvedValue({complete:true,errors:[],urls:[]});
});
test.each(['tech','collectibles','tunes_flip','trading_cards'] as const)('%s uses canonical specialist with explicit user-confirmed provenance, no invented condition or price',niche=>{
 const result=barcodeIdentificationForInventory(lead,niche);expect(result.specialistId).toBe(NICHE_MODULES[niche].defaultSpecialist);
 expect(result.identificationSource).toBe('user_confirmed');expect(result.identificationState).toBe('candidate');expect(result.condition).toBe('');expect(result.valuationMid).toBe(0);
 expect(result.attributes._barcode_identification.verificationStatus).toBe('ai_suggested');expect(result.attributes._barcode_identification.catalogueAssociationVerified).toBe(false);expect(result.attributes.year).toBe('2007');
 expect(barcodeDraft(lead).item_specifics.EAN).toBe(lead.gtin);expect(barcodeDraft(lead).recommended_price).toBe(0);expect(barcodeDraft(lead).description).toContain('BBC');
});
test('confirmation without photos creates one canonical item and directly opens a populated atomic draft',async()=>{
 const result=await confirmBarcodeProduct(input());expect(result.listingId).toBe('existing-draft');expect(createQuickInventory).toHaveBeenCalledTimes(1);expect(persistCapturedItemPhotos).not.toHaveBeenCalled();expect(saveListing).toHaveBeenCalledWith('tenant','canonical-item',expect.objectContaining({title:lead.title,recommended_price:0}));
});
test('duplicate confirmations/retries reuse the physical scan ID and existing draft',async()=>{
 const [a,b]=await Promise.all([confirmBarcodeProduct(input()),confirmBarcodeProduct(input())]);expect(a).toBe(b);expect(createQuickInventory).toHaveBeenCalledTimes(1);
 (getItemListings as jest.Mock).mockResolvedValue({listings:[{id:'existing-draft',tenantId:'tenant',marketplaceId:'ebay',status:'draft'}],error:null});
 await confirmBarcodeProduct(input());expect(createQuickInventory).toHaveBeenCalledTimes(1);expect(saveListing).toHaveBeenCalledTimes(1);
});
test('optional photos use the existing processed-original persistence path',async()=>{
 const images:any=[{uri:'file://photo',slotId:'front',slotLabel:'Front'}];const active=()=>true;await confirmBarcodeProduct({...input(),images,isCurrent:active});
 expect(persistCapturedItemPhotos).toHaveBeenCalledWith('tenant','canonical-item',images,{appendOnly:true,processImages:true,isCurrent:active});
});
test('photo failure retains item and does not create a replacement draft on retry',async()=>{
 const images:any=[{uri:'file://photo',slotId:'front',slotLabel:'Front'}];(persistCapturedItemPhotos as jest.Mock).mockResolvedValueOnce({complete:false,errors:['upload failed']});
 await expect(confirmBarcodeProduct({...input(),images})).rejects.toThrow('saved');expect(saveListing).not.toHaveBeenCalled();
 await confirmBarcodeProduct({...input(),images});expect(createQuickInventory).toHaveBeenCalledTimes(1);expect(saveListing).toHaveBeenCalledTimes(1);
});
test('changed account/scope and wrong specialist fail closed before item creation',async()=>{
 await expect(confirmBarcodeProduct({...input(),isCurrent:()=>false})).rejects.toThrow('Workspace changed');expect(createQuickInventory).not.toHaveBeenCalled();
 stored={id:'canonical-item',tenant_id:'tenant',specialist_id:'coins',attributes:{_capture_session_id:'scan'}};
 await expect(confirmBarcodeProduct(input())).rejects.toThrow('another scan or specialist');expect(createQuickInventory).not.toHaveBeenCalled();
});
test('the shared Quick List confirmation shows Confirm/Edit/Add Photos/Try Another before a photo requirement',()=>{
 expect(fs.readFileSync('components/feature/QuickListWorkspace.tsx','utf8')).toContain('BarcodeProductConfirmation');
 expect(fs.readFileSync('components/feature/UniversalBarcodeTool.tsx','utf8')).toContain('useUniversalBarcode');
 const ui=fs.readFileSync('components/feature/BarcodeProductConfirmation.tsx','utf8');for(const label of ['Confirm Product','Edit Details','Add Photos','Try Another Match','AI-SUGGESTED · NOT VERIFIED'])expect(ui).toContain(label);
 expect(fs.readFileSync('hooks/useListingEditor.ts','utf8')).toContain('_barcode_identification?.userConfirmed===true');
 const gateway=fs.readFileSync('supabase/functions/swish-ebay-browse/index.ts','utf8');expect(gateway).toContain('lookupAIBarcode');expect(gateway).toContain('nicheBarcodeAllowed');
});
