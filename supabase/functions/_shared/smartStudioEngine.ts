// Shared server codec/provenance adapter. BackgroundErase is the ONLY image processor.
// No AI generation, visual comparison or relighting. Coins use deterministic alpha-on-white centering.
import { decode as decodeJpeg } from 'npm:jpeg-js@0.4.4';
import { decode as decodePng, encode as encodePng } from 'npm:fast-png@6.2.0';
import { SMART_STUDIO_VERSION, COIN_PRESENTATION_VERSION, type StudioRaster, type StudioResult } from './smartStudio.ts';
import { BackgroundEraseError, removeBackgroundBytes } from './backgroundEraseService.ts';
export function imageBytes(data:string):Uint8Array {
 const match=data.match(/^data:image\/(jpeg|jpg|png);base64,([A-Za-z0-9+/=]+)$/i);
 if(!match||data.length>7_000_000)throw new Error('Unsupported processing copy.');
 return Uint8Array.from(atob(match[2]),c=>c.charCodeAt(0));
}
export async function studioHash(bytes:Uint8Array):Promise<string> {
 const buffer=new ArrayBuffer(bytes.length);new Uint8Array(buffer).set(bytes);
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),v=>v.toString(16).padStart(2,'0')).join('');
}
export function decodeStudioRaster(bytes:Uint8Array):StudioRaster {
 if(bytes[0]===255&&bytes[1]===216){const image=decodeJpeg(bytes,{useTArray:true,formatAsRGBA:true,maxResolutionInMP:3,maxMemoryUsageInMB:64});return {width:image.width,height:image.height,data:new Uint8Array(image.data)};}
 if(bytes.length<24||bytes[0]!==137||bytes[1]!==80||bytes[2]!==78||bytes[3]!==71)throw new Error('Unsupported image codec.');
 const header=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);if(header.getUint32(16)*header.getUint32(20)>3_000_000)throw new Error('PNG dimensions exceed processing limit.');
 const image=decodePng(bytes);if(image.width*image.height>3_000_000||image.depth!==8||![3,4].includes(image.channels))throw new Error('Unsupported image raster.');
 const data=new Uint8Array(image.width*image.height*4);for(let i=0;i<image.width*image.height;i++){data[i*4]=image.data[i*image.channels];data[i*4+1]=image.data[i*image.channels+1];data[i*4+2]=image.data[i*image.channels+2];data[i*4+3]=image.channels===4?image.data[i*4+3]:255;}return {width:image.width,height:image.height,data};
}
function crc32(bytes:Uint8Array):number {let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
/** 72 DPI is density metadata only; preserve the validated transparent PNG pixels. */
export function pngAt72Dpi(png:Uint8Array):Uint8Array {
 if(png.length<33||png[0]!==137||png[1]!==80||png[2]!==78||png[3]!==71)throw new Error('PNG export required.');
 const density=new Uint8Array(21),view=new DataView(density.buffer);
 view.setUint32(0,9);density.set(new TextEncoder().encode('pHYs'),4);
 view.setUint32(8,2835);view.setUint32(12,2835);density[16]=1;
 view.setUint32(17,crc32(density.subarray(4,17)));
 const chunks:Uint8Array[]=[png.subarray(0,8)];let offset=8,inserted=false;
 while(offset+12<=png.length){
  const length=new DataView(png.buffer,png.byteOffset+offset,4).getUint32(0),end=offset+12+length;
  if(end>png.length)throw new Error('Invalid PNG chunk.');
  const name=String.fromCharCode(...png.subarray(offset+4,offset+8));
  if(name!=='pHYs')chunks.push(png.subarray(offset,end));
  if(name==='IHDR'){chunks.push(density);inserted=true;}
  offset=end;
 }
 if(!inserted||offset!==png.length)throw new Error('Invalid PNG export.');
 const output=new Uint8Array(chunks.reduce((sum,chunk)=>sum+chunk.length,0));let position=0;
 for(const chunk of chunks){output.set(chunk,position);position+=chunk.length;}
 return output;
}
/** Append density and server provenance only. Compressed pixel/alpha chunks are unchanged. */
export function attachStudioMetadata(png:Uint8Array,metadata:Record<string,unknown>):Uint8Array {
 png=pngAt72Dpi(png);
 const text=new TextEncoder().encode('swish_studio\0'+JSON.stringify(metadata).replace(/[^\x00-\x7f]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')));if(text.length>32_000)throw new Error('Processing metadata exceeds limit.');
 const chunk=new Uint8Array(text.length+12),view=new DataView(chunk.buffer);view.setUint32(0,text.length);chunk.set(new TextEncoder().encode('tEXt'),4);chunk.set(text,8);view.setUint32(text.length+8,crc32(chunk.subarray(4,text.length+8)));
 const out=new Uint8Array(png.length+chunk.length);out.set(png.subarray(0,png.length-12));out.set(chunk,png.length-12);out.set(png.subarray(png.length-12),png.length-12+chunk.length);return out;
}
// Kept for offline codec fixtures only, not the provider processing path.
export function encodeStudioPng(image:StudioRaster,metadata?:Record<string,unknown>):Uint8Array {
 const png=encodePng({...image,channels:4,depth:8});return metadata?attachStudioMetadata(png,metadata):png;
}
export function readStudioMetadata(bytes:Uint8Array):Omit<StudioResult,'originalUri'>|null {
 try{const png=decodePng(bytes);const data=JSON.parse(png.text.swish_studio??'null');return data?.version===SMART_STUDIO_VERSION?data:null;}catch{return null;}
}
export interface StudioServerConfig {provider:'BackgroundErase';format:'png';channels:'rgba';size:'full';crop:false;despill:false;coinPresentationVersion:string}
export function studioServerConfig():StudioServerConfig {return {provider:'BackgroundErase',format:'png',channels:'rgba',size:'full',crop:false,despill:false,coinPresentationVersion:COIN_PRESENTATION_VERSION};}
/** Translate every nonzero-alpha provider pixel onto a square white canvas; no resizing or rim reconstruction. */
export function centeredWhiteCoinRaster(cutout:StudioRaster):StudioRaster {
 if(!Number.isInteger(cutout.width)||!Number.isInteger(cutout.height)||cutout.width<1||cutout.height<1||cutout.data.length!==cutout.width*cutout.height*4)throw new Error('Invalid coin cutout.');
 const side=Math.max(cutout.width,cutout.height);
 if(side*side>3_000_000)throw new Error('Coin presentation exceeds the raster budget. Original retained.');
 let left=cutout.width,top=cutout.height,right=-1,bottom=-1;
 for(let y=0;y<cutout.height;y++)for(let x=0;x<cutout.width;x++)if(cutout.data[(y*cutout.width+x)*4+3]>0){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
 if(right<left||bottom<top)throw new Error('Coin cutout is empty. Original retained.');
 const dx=Math.floor((side-(right-left+1))/2),dy=Math.floor((side-(bottom-top+1))/2);
 const data=new Uint8Array(side*side*4);data.fill(255);
 for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++){
  const src=(y*cutout.width+x)*4,dst=((dy+y-top)*side+dx+x-left)*4,alpha=cutout.data[src+3]/255;
  for(let channel=0;channel<3;channel++)data[dst+channel]=Math.round(cutout.data[src+channel]*alpha+255*(1-alpha));
 }
 return {width:side,height:side,data};
}
export function validateBackgroundEraseRaster(source:StudioRaster,output:StudioRaster):Record<string,boolean> {
 const dimensionsUnchanged=source.width===output.width&&source.height===output.height;
 let foreground=0,transparent=0;
 for(let i=3;i<output.data.length;i+=4){if(output.data[i]>0)foreground++;if(output.data[i]<255)transparent++;}
 return {validPng:true,dimensionsUnchanged,foregroundPresent:foreground>0,transparencyPresent:transparent>0};
}
export async function processStudioCopy(imageDataUrl:string,nicheId:string,_angle:string,_hint:string,_references:Array<{imageDataUrl:string;angle:string}>,_config:StudioServerConfig):Promise<{result:Omit<StudioResult,'originalUri'>;image?:Uint8Array;mask?:Uint8Array}> {
 const input=imageBytes(imageDataUrl),source=decodeStudioRaster(input);
 if(source.width<320||source.height<320||source.width>1800||source.height>1800)throw new BackgroundEraseError('BACKGROUND_ERASE_INPUT_DIMENSIONS',422,'BackgroundErase: processing copy dimensions are unsupported; original retained.');
 const png=await removeBackgroundBytes(input,/^data:image\/png;/i.test(imageDataUrl)?'image/png':'image/jpeg');
 if(png.length<24||png[0]!==137||png[1]!==80||png[2]!==78||png[3]!==71)throw new BackgroundEraseError('BACKGROUND_ERASE_INVALID_OUTPUT',502,'BackgroundErase: output is not a PNG cutout; original retained.');
 let output:StudioRaster;try{output=decodeStudioRaster(png);}catch{throw new BackgroundEraseError('BACKGROUND_ERASE_INVALID_OUTPUT',502,'BackgroundErase: returned image could not be validated; original retained.');}
 const checks=validateBackgroundEraseRaster(source,output);
 if(!Object.values(checks).every(Boolean))throw new BackgroundEraseError('BACKGROUND_ERASE_OUTPUT_REVIEW',422,'BackgroundErase: output is empty, opaque or has changed dimensions; original retained.');
 const result:Omit<StudioResult,'originalUri'>={version:SMART_STUDIO_VERSION,status:'ready',confidence:0,warnings:['BackgroundErase cutout. Check product edges, defects and lettering against the original before listing.'],quality:{sourcePixelsOnly:false,method:'backgrounderase',provider:'BackgroundErase',checks,completeness:'not_assessed',boundary:'Provider alpha segmentation; manually review fine edges',detailCheck:'PNG and dimensions checked; no AI reconstruction or pixel-fidelity certification',background:'transparent'}};
 if(nicheId==='coins'){
  const presentation=centeredWhiteCoinRaster(output);
  result.quality={...result.quality,background:'white_centered',detailCheck:'Provider cutout translated onto white without resizing, relighting or reconstruction; review against original'};
  return {result,image:pngAt72Dpi(encodeStudioPng(presentation))};
 }
 return {result,image:png};
}
