jest.mock('expo-image-manipulator',()=>({ manipulateAsync:jest.fn(),SaveFormat:{ JPEG:'jpeg' } }));
jest.mock('jpeg-js',()=>({ decode:jest.fn() }));
import { manipulateAsync } from 'expo-image-manipulator';
import { decode } from 'jpeg-js';
import { measurePhotoPixels } from '@/services/imageQualityMetrics';
import { inspectPhotoQuality,preflightPhotos } from '@/services/photoQualityService';
function pixels(value:number,checker=false){ const data=new Uint8Array(32*32*4);for(let y=0;y<32;y++)for(let x=0;x<32;x++){ const i=(y*32+x)*4;const v=checker ? ((Math.floor(x/4)+Math.floor(y/4))%2 ? 200 : 60) : value;data[i]=v;data[i+1]=v;data[i+2]=v;data[i+3]=255; }return data; }
describe('Measured local photo quality',()=>{
  beforeEach(()=>jest.clearAllMocks());
  test('sharp midtone detail has measured edges and no lighting warning',()=>{ const result=measurePhotoPixels(pixels(128,true),32,32);expect(result.laplacianVariance).toBeGreaterThan(70);expect(result.warnings).toEqual([]); });
  test('darkness and clipped highlights are measured, not AI assertions',()=>{ const dark=measurePhotoPixels(pixels(5),32,32),bright=measurePhotoPixels(pixels(250),32,32);expect(dark.meanLuminance).toBeCloseTo(5);expect(dark.darkFraction).toBe(1);expect(bright.meanLuminance).toBeCloseTo(250);expect(bright.brightFraction).toBe(1); });
  test('smooth surfaces flag possible blur without claiming that blur is certain',()=>{ const result=measurePhotoPixels(pixels(128),32,32);expect(result.laplacianVariance).toBe(0);expect(result.warnings[0]).toContain('possible blur or a plain surface'); });
  test('invalid buffers/dimensions fail instead of returning NaN',()=>{ expect(()=>measurePhotoPixels(new Uint8Array(3),32,32)).toThrow();expect(()=>measurePhotoPixels(pixels(128),0,32)).toThrow(); });
  test('uses bounded local thumbnail + typed JPEG decoding and reuses immutable capture checks',async()=>{
    (manipulateAsync as jest.Mock).mockResolvedValue({ base64:'YQ==',width:32,height:32 });(decode as jest.Mock).mockReturnValue({ data:pixels(128,true),width:32,height:32 });
    const [first,second]=await Promise.all([inspectPhotoQuality('file://unique-fixture.jpg'),inspectPhotoQuality('file://unique-fixture.jpg')]);
    expect(first).toEqual(second);expect(first.status).toBe('measured');expect(manipulateAsync).toHaveBeenCalledTimes(1);expect(decode).toHaveBeenCalledTimes(1);
  });
  test('per-photo warnings stop preflight until explicitly overridden',async()=>{ const photo={ uri:'file://reviewed.jpg',slotLabel:'Card reverse',photoQuality:measurePhotoPixels(pixels(5),32,32) };const blocked=await preflightPhotos([photo]);expect(blocked.error).toContain('Card reverse');const allowed=await preflightPhotos([photo],true);expect(allowed.error).toBeNull();expect(allowed.checks[0].warnings.length).toBeGreaterThan(0);expect(manipulateAsync).not.toHaveBeenCalled(); });
  test('decoder failure is reported as unavailable, never measured good quality',async()=>{ (manipulateAsync as jest.Mock).mockRejectedValue(new Error('Unsupported image'));const result=await inspectPhotoQuality('data:bad-image');expect(result.status).toBe('unavailable');expect(result.meanLuminance).toBeNull();expect(result.warnings.length).toBe(1); });
});
