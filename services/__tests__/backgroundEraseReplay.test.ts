// Mocked client replay regressions. No credentials or live provider requests.
jest.mock('@/template',()=>({getSupabaseClient:()=>mockClient}));
jest.mock('expo-image-manipulator',()=>({manipulateAsync:jest.fn().mockResolvedValue({uri:'file://transport.jpg',base64:'YWJj',width:1000,height:1000}),SaveFormat:{JPEG:'jpeg'}}));
jest.mock('@react-native-async-storage/async-storage',()=>({__esModule:true,default:{getItem:jest.fn().mockResolvedValue(null),setItem:jest.fn().mockResolvedValue(undefined)}}));
jest.mock('expo-crypto',()=>({CryptoDigestAlgorithm:{SHA256:'SHA256'},digestStringAsync:jest.fn().mockResolvedValue('fixture-hash')}));
import { prepareCapturedImages } from '../sharedImagePreparationService';
import { SMART_STUDIO_VERSION } from '@/shared/smartStudio';
import { backgroundEraseQuality } from './fixtures/backgroundEraseFixture';
const mockInvoke=jest.fn();
const mockClient={auth:{getSession:jest.fn().mockResolvedValue({data:{session:{user:{id:'user'}}},error:null})},functions:{invoke:mockInvoke}};
const source=[{uri:'file://original.jpg',slotId:'main',slotLabel:'Main item'}];
beforeEach(()=>jest.clearAllMocks());
test('failed removal attempt is retained; identify/save does not silently repeat the provider request',async()=>{
 mockInvoke.mockResolvedValue({data:null,error:{message:'BackgroundErase: provider unavailable'}});
 const attempted=await prepareCapturedImages(source,{tenantId:'tenant',nicheId:'collectibles'});
 expect(attempted[0].studio?.status).toBe('fallback');expect(attempted[0].uri).toBe(source[0].uri);expect(attempted[0].enhancedUri).toBeUndefined();
 const retry=await prepareCapturedImages(attempted,{tenantId:'tenant',nicheId:'collectibles'});expect(retry).toEqual(attempted);expect(mockInvoke).toHaveBeenCalledTimes(1);
 expect(source[0]).not.toHaveProperty('studio');
});
test('successful provider result is reused with no new request and only the Edge gateway receives the image',async()=>{
 mockInvoke.mockResolvedValue({data:{version:SMART_STUDIO_VERSION,status:'ready',enhancedUri:'https://storage.test/cutout.png',confidence:0,warnings:[],quality:backgroundEraseQuality},error:null});
 const prepared=await prepareCapturedImages(source,{tenantId:'tenant',nicheId:'coins'});
 expect(prepared[0].enhancedUri).toBe('https://storage.test/cutout.png');expect(prepared[0].uri).toBe(source[0].uri);
 await prepareCapturedImages(prepared,{tenantId:'tenant',nicheId:'coins'});expect(mockInvoke).toHaveBeenCalledTimes(1);
 expect(mockInvoke.mock.calls[0][0]).toBe('swish-coin-image-enhance');expect(Object.keys(mockInvoke.mock.calls[0][1].body).sort()).toEqual(['imageDataUrl','nicheId','tenantId']);
});
