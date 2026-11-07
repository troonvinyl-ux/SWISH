// Shared recovery contracts with mocked data. No user data or provider calls.
jest.mock('@/template',()=>({getSupabaseClient:jest.fn()}));
jest.mock('@/services/itemService',()=>({getItem:jest.fn()}));
jest.mock('@/services/photoPersistenceService',()=>({persistCapturedItemPhotos:jest.fn()}));
jest.mock('@/services/originalImageService',()=>({verifyStoredOriginal:jest.fn()}));
import {getSupabaseClient} from '@/template';
import {getItem} from '../itemService';
import {persistCapturedItemPhotos} from '../photoPersistenceService';
import {verifyStoredOriginal} from '../originalImageService';
import {recoverCapturedItemPhotos} from '../capturedPhotoRecoveryService';
import {NICHE_MODULES,PRODUCTION_NICHE_IDS} from '@/constants/niches';
const hash='a'.repeat(64);const paths=[`item/originals/front_${hash}.jpg`,`item/originals/back_${hash}.jpg`];
const urls=paths.map(path=>`https://storage.test/storage/v1/object/public/item-images/${path}`);
function setup(niche:typeof PRODUCTION_NICHE_IDS[number]='collectibles'){
 const item:any={id:'item',tenantId:'tenant',specialistId:NICHE_MODULES[niche].defaultSpecialist,media:[],attributes:{},updatedAt:'v1'};
 (getItem as jest.Mock).mockResolvedValueOnce({item,error:null}).mockResolvedValue({item:{...item,media:urls},error:null});
 const storage={list:jest.fn(async(folder:string)=>({data:folder==='item'?[]:paths.map((path,index)=>({id:String(index),name:path.split('/').pop()})),error:null})),getPublicUrl:jest.fn((path:string)=>({data:{publicUrl:`https://storage.test/storage/v1/object/public/item-images/${path}`}}))};
 (getSupabaseClient as jest.Mock).mockReturnValue({storage:{from:()=>storage}});
 (persistCapturedItemPhotos as jest.Mock).mockResolvedValue({complete:true,errors:[],urls});
 (verifyStoredOriginal as jest.Mock).mockResolvedValue(undefined);return {item,storage};
}
beforeEach(()=>jest.resetAllMocks());
test.each(PRODUCTION_NICHE_IDS)('%s recovers stored roles using the same canonical writer',async niche=>{
 setup(niche);const result=await recoverCapturedItemPhotos('tenant','item',niche);expect(result.error).toBeNull();expect(result.item?.media).toEqual(expect.arrayContaining(urls));
 expect(persistCapturedItemPhotos).toHaveBeenCalledWith('tenant','item',expect.arrayContaining([expect.objectContaining({slotId:'front'}),expect.objectContaining({slotId:'back'})]),{processImages:false});expect(verifyStoredOriginal).toHaveBeenCalledTimes(2);
});
test('partial canonical media also recovers the missing uploaded side',async()=>{
 const {item}=setup();(getItem as jest.Mock).mockReset().mockResolvedValueOnce({item:{...item,media:[urls[0]],attributes:{_photo_pipeline:{status:'retry_required',expected:[{slotId:'front',url:urls[0]},{slotId:'back'}]}}},error:null}).mockResolvedValue({item:{...item,media:urls},error:null});
 expect((await recoverCapturedItemPhotos('tenant','item','collectibles')).error).toBeNull();expect(persistCapturedItemPhotos).toHaveBeenCalledTimes(1);
});
test('wrong tenant/niche stops before storage access',async()=>{
 const {item,storage}=setup();(getItem as jest.Mock).mockReset().mockResolvedValue({item:{...item,tenantId:'other'},error:null});
 expect((await recoverCapturedItemPhotos('tenant','item','collectibles')).error).toContain('ownership');expect(storage.list).not.toHaveBeenCalled();
});
test('ambiguous same-role originals are never guessed',async()=>{
 const {storage}=setup();storage.list.mockResolvedValueOnce({data:[],error:null}).mockResolvedValueOnce({data:[{id:'1',name:`front_${hash}.jpg`},{id:'2',name:`front_${'b'.repeat(64)}.jpg`}],error:null});
 expect((await recoverCapturedItemPhotos('tenant','item','collectibles')).error).toContain('Multiple originals');expect(persistCapturedItemPhotos).not.toHaveBeenCalled();
});
test('failed fingerprints do not attach fabricated evidence',async()=>{
 setup();(verifyStoredOriginal as jest.Mock).mockRejectedValueOnce(new Error('fingerprint differs'));
 expect((await recoverCapturedItemPhotos('tenant','item','collectibles')).error).toContain('fingerprint');expect(persistCapturedItemPhotos).not.toHaveBeenCalled();
});
