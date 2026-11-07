import { compositeSegmentationMask, NATIVE_BACKGROUND_REMOVAL_ENABLED } from '../nativeBackgroundCompositor';
describe('native background removal experiment',()=>{
 test('disabled by default',()=>expect(NATIVE_BACKGROUND_REMOVAL_ENABLED).toBe(false));
 test('preserves original pixels and produces transparent cutout',()=>{
  const original=new Uint8Array([20,30,40,255,90,100,110,255]);
  const before=original.slice();
  const result=compositeSegmentationMask(original,new Uint8Array([255,0]),2,1);
  expect(Array.from(original)).toEqual(Array.from(before));
  expect(Array.from(result.rgba)).toEqual([20,30,40,255,90,100,110,0]);
 });
 test('white background composites without changing opaque foreground',()=>{
  const result=compositeSegmentationMask(new Uint8Array([20,30,40,255,90,100,110,255]),new Uint8Array([255,0]),2,1,'white');
  expect(Array.from(result.rgba)).toEqual([20,30,40,255,255,255,255,255]);
 });
 test('rejects invalid masks',()=>expect(()=>compositeSegmentationMask(new Uint8Array(8),new Uint8Array([0,0]),2,1)).toThrow());
});
