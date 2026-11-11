// Mocked transport/Expo tests. No claim of live model or photographic acceptance.
jest.mock('@/template',()=>({getSupabaseClient:()=>mockClient}));
jest.mock('expo-image-manipulator',()=>({manipulateAsync:jest.fn(),SaveFormat:{JPEG:'jpeg'}}));
jest.mock('@react-native-async-storage/async-storage',()=>({__esModule:true,default:{getItem:jest.fn().mockResolvedValue(null),setItem:jest.fn().mockResolvedValue(undefined)}}));
jest.mock('expo-crypto',()=>({CryptoDigestAlgorithm:{SHA256:'SHA256'},digestStringAsync:jest.fn(async(_algorithm:string,input:string)=>input.length+'-'+input.slice(-160))}));
import { manipulateAsync } from 'expo-image-manipulator';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { generateCoinImageReference } from '@/services/coinImageEnhancementService';
import { prepareObjectImage,prepareCapturedImages } from '@/services/sharedImagePreparationService';
import { SMART_STUDIO_VERSION, shouldAutoRemoveBackground } from '@/shared/smartStudio';
import { PRODUCTION_NICHE_IDS } from '@/constants/niches';
import { backgroundEraseQuality } from './fixtures/backgroundEraseFixture';
const mockInvoke=jest.fn();const mockClient={auth:{getSession:jest.fn().mockResolvedValue({data:{session:{user:{id:'fixture-user'}}},error:null})},functions:{invoke:mockInvoke}};
const good={version:SMART_STUDIO_VERSION,status:'ready',enhancedUri:'https://storage.test/studio/presentation.png',maskUri:'https://storage.test/studio/mask.png',confidence:0.96,warnings:[],quality:backgroundEraseQuality};
beforeEach(()=>{jest.clearAllMocks();(manipulateAsync as jest.Mock).mockResolvedValue({uri:'file://copy.jpg',base64:'YWJj',width:1000,height:1000});mockInvoke.mockResolvedValue({data:good,error:null});});
describe('Shared studio and legacy coin alias',()=>{
 test.each(['file://coin.jpg','blob:https://preview.example/photo','https://example.com/photo.jpg'])('uses one protected engine for %s',async uri=>{const result=await generateCoinImageReference(uri,{tenantId:'tenant',nicheId:'coins',angle:'Obverse'});expect(result.enhancedUri).toBe(good.enhancedUri);expect(result.studio?.originalUri).toBe(uri);expect(mockInvoke).toHaveBeenCalledWith('swish-coin-image-enhance',expect.objectContaining({body:expect.objectContaining({tenantId:'tenant',nicheId:'coins'}),signal:expect.anything()}));});
 test('empty input does not contact the server',async()=>{await expect(generateCoinImageReference('')).rejects.toThrow('Capture a coin photo');expect(mockInvoke).not.toHaveBeenCalled();});
 test('preparation failure retains the source and produces explicit fallback',async()=>{(manipulateAsync as jest.Mock).mockRejectedValue(new Error('Codec unavailable'));const result=await prepareObjectImage({original:{uri:'file://original'}});expect(result.status).toBe('fallback');expect(result.originalUri).toBe('file://original');expect(mockInvoke).not.toHaveBeenCalled();});
 test('oversized analysis copies fail before a provider call',async()=>{(manipulateAsync as jest.Mock).mockResolvedValue({base64:'A'.repeat(4_000_000)});await expect(generateCoinImageReference('file://large')).rejects.toThrow('too large');expect(mockInvoke).not.toHaveBeenCalled();});
 test('actual HTTP failure is surfaced without substituting the original as enhanced',async()=>{mockInvoke.mockResolvedValue({data:null,error:new FunctionsHttpError(new Response(JSON.stringify({error:'Authentication required'}),{status:401}))});await expect(generateCoinImageReference('file://denied')).rejects.toThrow('[Code: 401] Authentication required');});
 test('old generative output without source provenance is rejected',async()=>{mockInvoke.mockResolvedValue({data:{enhancedImage:'https://unsafe.test/generated.png'},error:null});const result=await prepareObjectImage({original:{uri:'file://unsafe'}});expect(result.status).toBe('fallback');expect(result.enhancedUri).toBeUndefined();});
 test('batch preserves side order and never mutates source objects',async()=>{const images=[{uri:'file://front',slotId:'front',slotLabel:'Front'},{uri:'file://rear',slotId:'rear',slotLabel:'Rear'}];const before=JSON.stringify(images);const output=await prepareCapturedImages(images,{nicheId:'tunes_flip',tenantId:'tenant',manual:true});expect(output.map(x=>x.slotId)).toEqual(['front','rear']);expect(JSON.stringify(images)).toBe(before);expect(mockInvoke).toHaveBeenCalledTimes(2);});
 test.each(PRODUCTION_NICHE_IDS.filter(id=>id!=='coins'))('%s skips automatic removal before auth, codecs or network',async nicheId=>{
  const image={uri:'file://unprocessed.jpg',slotId:'front',slotLabel:'Front'};
  expect(shouldAutoRemoveBackground(nicheId)).toBe(false);
  expect(await prepareCapturedImages([image],{nicheId,tenantId:'tenant'})).toEqual([image]);
  expect(manipulateAsync).not.toHaveBeenCalled();expect(mockClient.auth.getSession).not.toHaveBeenCalled();expect(mockInvoke).not.toHaveBeenCalled();
 });
 test('coins still automatically prepare their captured photos',async()=>{
  const image={uri:'file://coin-new.jpg',slotId:'front',slotLabel:'Front'};
  expect(shouldAutoRemoveBackground('coins')).toBe(true);
  const prepared=await prepareCapturedImages([image],{nicheId:'coins',tenantId:'tenant'});
  expect(prepared[0].enhancedUri).toBe(good.enhancedUri);expect(image).not.toHaveProperty('studio');expect(mockInvoke).toHaveBeenCalledTimes(1);
 });
 test('missing scope never starts automatic spending',async()=>{expect(shouldAutoRemoveBackground()).toBe(false);await prepareCapturedImages([{uri:'file://unknown',slotId:'front',slotLabel:'Front'}]);expect(mockInvoke).not.toHaveBeenCalled();});
 test('existing provider provenance does not invoke a second paid operation',async()=>{const original={uri:'file://cached',slotId:'front',slotLabel:'Front',studio:{...good,originalUri:'file://cached'}} as any;expect(await prepareCapturedImages([original])).toEqual([original]);expect(mockInvoke).not.toHaveBeenCalled();});
 test('cancelled request leaves the original untouched',async()=>{const controller=new AbortController();controller.abort();const result=await prepareObjectImage({original:{uri:'file://cancel'},signal:controller.signal});expect(result.status).toBe('fallback');expect(mockInvoke).not.toHaveBeenCalled();});
});
