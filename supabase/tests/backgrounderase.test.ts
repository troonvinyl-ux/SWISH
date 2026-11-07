// Fully mocked provider tests. Fake keys only; no external calls, credits or user-data writes.
import { assert, assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { stub } from 'https://deno.land/std@0.224.0/testing/mock.ts';
import { removeBackgroundBytes, BackgroundEraseError } from '../functions/_shared/backgroundEraseService.ts';
import { processStudioCopy, studioServerConfig, encodeStudioPng, attachStudioMetadata, decodeStudioRaster, readStudioMetadata } from '../functions/_shared/smartStudioEngine.ts';
import { SMART_STUDIO_VERSION } from '../functions/_shared/smartStudio.ts';
const fakeKey='fixture-server-key-not-a-credential';
function raster(width=320,height=320){const data=new Uint8Array(width*height*4);for(let i=0;i<data.length;i+=4){data[i]=140;data[i+1]=160;data[i+2]=180;data[i+3]=255;}return {width,height,data};}
Deno.test('one server POST uses only multipart contract; output pixels survive metadata attachment',async()=>{
 const input=raster(),output=raster();output.data[3]=0;
 const source=encodeStudioPng(input),cutout=encodeStudioPng(output);
 let calls=0;
 const env=stub(Deno.env,'get',(name:string)=>name==='BACKGROUND_ERASE_API_KEY'?fakeKey:undefined);
 const network=stub(globalThis,'fetch',async(url,options)=>{
  calls++;assertEquals(String(url),'https://api.backgrounderase.com/v2');assertEquals(options?.method,'POST');assertEquals((options?.headers as Record<string,string>)['x-api-key'],fakeKey);assertEquals(options?.redirect,'error');
  const form=options?.body as FormData;assert(form instanceof FormData);assert(form.get('image_file') instanceof Blob);
  assertEquals(form.get('format'),'png');assertEquals(form.get('channels'),'rgba');assertEquals(form.get('size'),'full');assertEquals(form.get('crop'),'false');assertEquals(form.get('despill'),'false');assertEquals(form.get('bg_color'),null);assertEquals(form.get('image_url'),null);
  return new Response(cutout,{headers:{'Content-Type':'image/png'}});
 });
 try{
  const data=`data:image/png;base64,${btoa(String.fromCharCode(...source))}`;
  const result=await processStudioCopy(data,'collectibles','main','',[],studioServerConfig());assertEquals(calls,1);assertEquals(result.result.quality.method,'backgrounderase');assertEquals(result.result.confidence,0);assertEquals(result.image,cutout);
  const metadata={...result.result,cacheKey:'a'.repeat(64),sourceHash:'b'.repeat(64)};
  const encoded=attachStudioMetadata(result.image!,metadata);assertEquals(decodeStudioRaster(encoded).data,output.data);assertEquals(readStudioMetadata(encoded)?.version,SMART_STUDIO_VERSION);assert(!JSON.stringify(metadata).includes(fakeKey));
 }finally{env.restore();network.restore();}
});
Deno.test('missing key makes zero network requests',async()=>{
 const env=stub(Deno.env,'get',()=>undefined);let calls=0;const network=stub(globalThis,'fetch',async()=>{calls++;return new Response();});
 try{await assertRejects(()=>removeBackgroundBytes(new Uint8Array([1]),'image/png'),BackgroundEraseError,'configure the server key');assertEquals(calls,0);}finally{env.restore();network.restore();}
});
for(const status of [401,403,402,429,500])Deno.test(`provider HTTP ${status}: sanitized error, exactly one call, no paid replay`,async()=>{
 const env=stub(Deno.env,'get',()=>fakeKey);let calls=0;const network=stub(globalThis,'fetch',async()=>{calls++;return new Response(JSON.stringify({secret:fakeKey,detail:'private account detail'}),{status});});
 try{const error=await assertRejects(()=>removeBackgroundBytes(new Uint8Array([1]),'image/png'),BackgroundEraseError);assertEquals(calls,1);assert(!error.message.includes(fakeKey));assert(!error.message.includes('private account detail'));}finally{env.restore();network.restore();}
});
Deno.test('provider network rejection does not replay a paid call',async()=>{
 const env=stub(Deno.env,'get',()=>fakeKey);let calls=0;const network=stub(globalThis,'fetch',async()=>{calls++;throw new Error(fakeKey);});
 try{const error=await assertRejects(()=>removeBackgroundBytes(new Uint8Array([1]),'image/png'),BackgroundEraseError);assertEquals(calls,1);assert(!error.message.includes(fakeKey));}finally{env.restore();network.restore();}
});
for(const failure of ['opaque','empty','dimensions','jpeg'])Deno.test(`reject ${failure} output instead of claiming a valid cutout`,async()=>{
 const source=encodeStudioPng(raster());const output=raster(failure==='dimensions'?321:320);if(failure==='empty')for(let i=3;i<output.data.length;i+=4)output.data[i]=0;else if(failure!=='opaque')output.data[3]=0;
 const png=failure==='jpeg'?new Uint8Array([255,216,255,217]):encodeStudioPng(output);
 const env=stub(Deno.env,'get',()=>fakeKey);const network=stub(globalThis,'fetch',async()=>new Response(png,{headers:{'Content-Type':'image/png'}}));
 try{const data=`data:image/png;base64,${btoa(String.fromCharCode(...source))}`;await assertRejects(()=>processStudioCopy(data,'coins','','',[],studioServerConfig()),BackgroundEraseError);}finally{env.restore();network.restore();}
});
