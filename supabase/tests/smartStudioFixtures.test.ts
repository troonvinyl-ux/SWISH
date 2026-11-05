// Offline REAL-photo codec/geometry acceptance. Manual geometry is NOT automatic AI acceptance.
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { decode } from 'npm:jpeg-js@0.4.4';
import { encode as encodePng } from 'npm:fast-png@6.2.0';
import { SMART_STUDIO_VERSION, normalizeStudioDetection, buildStudioTransform, renderStudio, studioRisk, type StudioRaster } from '../functions/_shared/smartStudio.ts';
import { encodeStudioPng, readStudioMetadata, studioHash } from '../functions/_shared/smartStudioEngine.ts';
const fixtures=['march-mods-front','march-mods-rear','march-mods-disc1','march-mods-disc2'];
for(const fixture of fixtures)Deno.test(`real JPEG ${fixture}: original hash unchanged; actual source-pixel PNG and mask`,async()=>{
 const bytes=await Deno.readFile(`test-lab/studio/${fixture}.jpeg`);const before=await studioHash(bytes);
 // Full-resolution decode is allowed only in this offline runner, not the Edge input path.
 const decoded=decode(bytes,{useTArray:true,maxResolutionInMP:24,maxMemoryUsageInMB:512});
 const width=640,height=Math.max(1,Math.round(decoded.height/decoded.width*640)),data=new Uint8Array(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const sx=Math.min(decoded.width-1,Math.floor(x/width*decoded.width)),sy=Math.min(decoded.height-1,Math.floor(y/height*decoded.height));data.set(decoded.data.subarray((sy*decoded.width+sx)*4,(sy*decoded.width+sx)*4+4),(y*width+x)*4);}
 const source:StudioRaster={width,height,data};
 // A declared central test patch exercises homography on real artwork pixels;
 // it does NOT claim the crop is the full detected physical product boundary.
 const detection=normalizeStudioDetection({kind:'rectangle',outline:[[0.15,0.25],[0.85,0.28],[0.85,0.85],[0.15,0.82]],corners:[[0.15,0.25],[0.85,0.28],[0.85,0.85],[0.15,0.82]],confidence:0.95,complete:true,occluded:false,objectCount:1,aspectRatio:1,ratioEvidence:'known_product_plane'});
 const rendered=renderStudio(source,detection,buildStudioTransform(detection,width,height,512));
 const image=encodePng({...rendered.image,depth:8,channels:4}),mask=encodePng({...rendered.mask,depth:8,channels:4});assert(image.length>100);assert(mask.length>100);assertEquals(await studioHash(bytes),before);assertEquals(rendered.quality.invalidMappings,0);
 await Deno.mkdir('verification-output/studio',{recursive:true});await Deno.writeFile(`verification-output/studio/${fixture}-manual-geometry.png`,image);await Deno.writeFile(`verification-output/studio/${fixture}-manual-mask.png`,mask);
});
Deno.test('PNG provenance roundtrip and incomplete-product refusal',()=>{
 const data=new Uint8Array([230,231,232,255]);const png=encodeStudioPng({width:1,height:1,data},{version:SMART_STUDIO_VERSION,status:'ready',quality:{sourcePixelsOnly:true},warnings:['Neutral background']});assertEquals(readStudioMetadata(png)?.version,SMART_STUDIO_VERSION);
 const detection=normalizeStudioDetection({kind:'contour',outline:[[0,0.1],[0.9,0.1],[0.9,0.9],[0,0.9]],confidence:0.95,complete:false,occluded:true,objectCount:1});assert(studioRisk(detection).length>=2);
});
