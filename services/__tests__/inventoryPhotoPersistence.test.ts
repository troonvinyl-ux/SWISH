// Wrapper and capture-source contracts. Mocked services, not live acceptance.
jest.mock('@/template',()=>({getSupabaseClient:jest.fn()}));
jest.mock('react-native',()=>({Platform:{OS:'ios'}}));
jest.mock('expo-image-picker',()=>({}));
jest.mock('expo-image-manipulator',()=>({}));
jest.mock('@/services/photoPersistenceService',()=>({persistCapturedItemPhotos:jest.fn(),linkPersistedItemPhotos:jest.fn()}));
import fs from 'node:fs';
import {getSupabaseClient} from '@/template';
import {uploadItemImages,updateItemMedia} from '../aiIdentificationService';
import {persistCapturedItemPhotos,linkPersistedItemPhotos} from '../photoPersistenceService';
beforeEach(()=>jest.clearAllMocks());
test('legacy/niche callers delegate to the same canonical photo writer',async()=>{
 const q:any={select:jest.fn(()=>q),eq:jest.fn(()=>q),maybeSingle:jest.fn().mockResolvedValue({data:{tenant_id:'tenant',specialist_id:'coins'},error:null})};
 (getSupabaseClient as jest.Mock).mockReturnValue({from:()=>q});
 const images=[{uri:'file://front',slotId:'front',slotLabel:'Front'}];
 (persistCapturedItemPhotos as jest.Mock).mockResolvedValue({urls:['https://stored/front.jpg'],errors:[],complete:true,images});
 expect((await uploadItemImages('item',images)).errors).toEqual([]);
 expect(persistCapturedItemPhotos).toHaveBeenCalledWith('tenant','item',images);
 await updateItemMedia('tenant','item',['https://stored/front.jpg'],'version');
 expect(linkPersistedItemPhotos).toHaveBeenCalledWith('tenant','item',['https://stored/front.jpg'],'version');
});
test('link failures surface rather than creating successful inventory feedback',async()=>{
 (linkPersistedItemPhotos as jest.Mock).mockRejectedValue(new Error('Photo references could not be confirmed'));
 await expect(updateItemMedia('tenant','item',['https://stored/front.jpg'])).rejects.toThrow('confirmed');
});
test('partial uploads are returned as actionable errors',async()=>{
 const q:any={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{tenant_id:'tenant',specialist_id:'collectibles'},error:null})};
 (getSupabaseClient as jest.Mock).mockReturnValue({from:()=>q});
 (persistCapturedItemPhotos as jest.Mock).mockResolvedValue({urls:['https://stored/front.jpg'],errors:['Back requires retry'],complete:false});
 expect((await uploadItemImages('item',[])).errors).toEqual(['Back requires retry']);
});
test('Quick List has no separate original-upload implementation and preserves result recovery',()=>{
 const service=fs.readFileSync('services/quickListService.ts','utf8');
 expect(service).toContain('persistCapturedItemPhotos(tenantId,itemId,images');expect(service).not.toContain('uploadUntouchedOriginal(');
 expect(service).toContain('quickInventoryIdentification(state.result)');expect(service).toContain('market:null');
 const hook=fs.readFileSync('hooks/useGenericCapture.ts','utf8');expect(hook).toContain('persistCapturedItemPhotos(tenant.id,id,visible.images)');expect(hook).toContain('savedId:id,images:visible.images');
});
