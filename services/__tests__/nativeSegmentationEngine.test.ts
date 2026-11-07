import {rgbaToChw,probabilityMaskToAlpha,runNativeSegmentation} from '../nativeSegmentationEngine';
test('preprocess uses CHW float RGB',()=>{
 const rgb=new Uint8Array(32*32*4).fill(255);
 const chw=rgbaToChw(rgb,32,32,32);
 expect(chw.length).toBe(3072);
 expect(chw[0]).toBe(1);
});
test('probability mask rejects invalid values',()=>{
 expect(()=>probabilityMaskToAlpha(new Float32Array([NaN]),1,1,1)).toThrow();
});
test('mock runtime produces cutout without modifying original',async()=>{
 const rgba=new Uint8Array(32*32*4).fill(255);
 const original=rgba.slice();
 const result=await runNativeSegmentation({rgba,width:32,height:32,inputSize:32},{infer:async(_input,size)=>{
  const p=new Float32Array(size*size);for(let y=8;y<24;y++)for(let x=8;x<24;x++)p[y*size+x]=1;return p;
 }});
 expect(rgba).toEqual(original);
 expect(result.rgba[3]).toBe(0);
 expect(result.rgba[(16*32+16)*4+3]).toBe(255);
});
