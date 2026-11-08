// Offline codec/density regression. No provider requests, accounts, storage or paid calls.
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { encodeStudioPng, decodeStudioRaster, pngAt72Dpi, attachStudioMetadata, readStudioMetadata } from '../functions/_shared/smartStudioEngine.ts';
import { SMART_STUDIO_VERSION } from '../functions/_shared/smartStudio.ts';
function physicalChunks(png:Uint8Array){
 const found:Uint8Array[]=[];let offset=8;
 while(offset+12<=png.length){const size=new DataView(png.buffer,png.byteOffset+offset,4).getUint32(0);if(String.fromCharCode(...png.subarray(offset+4,offset+8))==='pHYs')found.push(png.subarray(offset+8,offset+8+size));offset+=size+12;}
 return found;
}
Deno.test('processed PNG exports use 72-DPI metadata without changing transparency or product pixels',()=>{
 const source={width:2,height:2,data:new Uint8Array([140,120,80,0,100,90,60,128,60,70,80,255,40,30,20,255])};
 const png=encodeStudioPng(source),encoded=pngAt72Dpi(png),density=physicalChunks(encoded);
 assertEquals(density.length,1);assertEquals(new DataView(density[0].buffer,density[0].byteOffset,9).getUint32(0),2835);
 assertEquals(new DataView(density[0].buffer,density[0].byteOffset,9).getUint32(4),2835);assertEquals(density[0][8],1);
 assertEquals(decodeStudioRaster(encoded),source);assertEquals(pngAt72Dpi(encoded),encoded);
 const metadata=attachStudioMetadata(encoded,{version:SMART_STUDIO_VERSION,status:'ready',sourceHash:'source'});
 assertEquals(physicalChunks(metadata).length,1);assertEquals(decodeStudioRaster(metadata),source);assertEquals(readStudioMetadata(metadata)?.version,SMART_STUDIO_VERSION);
});
