// Server-only AI boundary analysis + original-pixel studio compositing.
import { decode as decodeJpeg } from 'npm:jpeg-js@0.4.4';
import { decode as decodePng, encode as encodePng } from 'npm:fast-png@6.2.0';
import { SMART_STUDIO_VERSION, normalizeStudioDetection, studioProfile, studioRisk, buildStudioTransform, renderStudio, type StudioRaster, type StudioResult } from './smartStudio.ts';
import { parseIdentificationJson } from './identificationPolicy.ts';
import { assessBoundaryEdges, refineRectangleEdges } from './studioBoundaryQuality.ts';
export function imageBytes(data:string):Uint8Array {
 const match=data.match(/^data:image\/(jpeg|jpg|png);base64,([A-Za-z0-9+/=]+)$/i);
 if(!match||data.length>4_000_000)throw new Error('Unsupported processing copy.');
 const binary=atob(match[2]);return Uint8Array.from(binary,c=>c.charCodeAt(0));
}
export async function studioHash(bytes:Uint8Array):Promise<string> {
 const buffer=new ArrayBuffer(bytes.length);new Uint8Array(buffer).set(bytes);
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),v=>v.toString(16).padStart(2,'0')).join('');
}
export function decodeStudioRaster(bytes:Uint8Array):StudioRaster {
 if(bytes[0]===255&&bytes[1]===216){const image=decodeJpeg(bytes,{useTArray:true,formatAsRGBA:true,maxResolutionInMP:3,maxMemoryUsageInMB:64});return {width:image.width,height:image.height,data:new Uint8Array(image.data)};}
 if(bytes.length<24||bytes[0]!==137||bytes[1]!==80)throw new Error('Unsupported image codec.');
 const header=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);if(header.getUint32(16)*header.getUint32(20)>3_000_000)throw new Error('PNG dimensions exceed processing limit.');
 const image=decodePng(bytes);if(image.width*image.height>3_000_000||image.depth!==8||![3,4].includes(image.channels))throw new Error('Unsupported background raster.');
 const data=new Uint8Array(image.width*image.height*4);for(let i=0;i<image.width*image.height;i++){data[i*4]=image.data[i*image.channels];data[i*4+1]=image.data[i*image.channels+1];data[i*4+2]=image.data[i*image.channels+2];data[i*4+3]=image.channels===4?image.data[i*4+3]:255;}return {width:image.width,height:image.height,data};
}
// Persist only small geometry/provenance metadata in a standard PNG tEXt chunk.
// The existing image bucket allows image/png, not standalone JSON manifests.
function crc32(bytes:Uint8Array):number {let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
export function encodeStudioPng(image:StudioRaster,metadata?:Record<string,unknown>):Uint8Array {
 const png=encodePng({...image,channels:4,depth:8});if(!metadata)return png;
 const text=new TextEncoder().encode('swish_studio\0'+JSON.stringify(metadata).replace(/[^\x00-\x7f]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')));if(text.length>32_000)throw new Error('Processing metadata exceeds limit.');
 const chunk=new Uint8Array(text.length+12),view=new DataView(chunk.buffer);view.setUint32(0,text.length);chunk.set(new TextEncoder().encode('tEXt'),4);chunk.set(text,8);view.setUint32(text.length+8,crc32(chunk.subarray(4,text.length+8)));
 const out=new Uint8Array(png.length+chunk.length);out.set(png.subarray(0,png.length-12));out.set(chunk,png.length-12);out.set(png.subarray(png.length-12),png.length-12+chunk.length);return out;
}
export function readStudioMetadata(bytes:Uint8Array):Omit<StudioResult,'originalUri'>|null {
 try{const png=decodePng(bytes);const data=JSON.parse(png.text.swish_studio??'null');return data?.version===SMART_STUDIO_VERSION?data:null;}catch{return null;}
}
export interface StudioServerConfig { detectionModel:string; backgroundModel:string; backgroundMode:'generated'|'neutral'; size:number; }
export function studioServerConfig():StudioServerConfig {
 return {detectionModel:Deno.env.get('SMART_STUDIO_DETECTION_MODEL')??'google/gemini-3-flash-preview',backgroundModel:Deno.env.get('SMART_STUDIO_BACKGROUND_MODEL')??'google/gemini-2.5-flash-image',backgroundMode:Deno.env.get('SMART_STUDIO_BACKGROUND_MODE')==='neutral'?'neutral':'generated',size:Math.max(512,Math.min(1280,Number(Deno.env.get('SMART_STUDIO_OUTPUT_SIZE'))||1024))};
}
async function aiRequest(body:Record<string,unknown>,timeout:number) {
 const apiKey=Deno.env.get('ONSPACE_AI_API_KEY'),baseUrl=Deno.env.get('ONSPACE_AI_BASE_URL');if(!apiKey||!baseUrl)throw new Error('OnSpace AI unavailable.');
 const response=await fetch(`${baseUrl}/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${apiKey}`},body:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});
 if(!response.ok){console.error('[swish-coin-image-enhance] model request failed', response.status);throw new Error('OnSpace AI request unavailable.');}return response.json();
}
let backgroundCache:{model:string;image:StudioRaster;until:number}|null=null;
let backgroundFlight:Promise<StudioRaster>|null=null;
async function studioBackground(config:StudioServerConfig):Promise<StudioRaster|undefined> {
 if(config.backgroundMode==='neutral')return undefined;
 if(backgroundCache?.model===config.backgroundModel&&backgroundCache.until>Date.now())return backgroundCache.image;
 if(backgroundFlight)return backgroundFlight;
 backgroundFlight=(async()=>{
  // Never send a product photograph to the image-generating model. Generated
  // pixels are an empty environmental layer and can never redraw the object.
  const data=await aiRequest({model:config.backgroundModel,modalities:['image','text'],image_config:{aspect_ratio:'1:1'},messages:[{role:'user',content:'An EMPTY seamless white product photography studio backdrop, smooth matte very light grey floor merging into white background, uniform neutral illumination. Absolutely no product, object, text, pedestal, decoration, people, props or texture. Square 1:1 empty background plate only.'}]},12_000);
  const uri=data?.choices?.[0]?.message?.images?.[0]?.image_url?.url;if(typeof uri!=='string'||!uri.startsWith('data:image/'))throw new Error('No background plate.');
  const image=decodeStudioRaster(imageBytes(uri));
  // Conservative rejection of colourful, dark or textured generated plates.
  let count=0,mean=0,squares=0;
  for(let i=0;i<image.data.length;i+=64){const r=image.data[i],g=image.data[i+1],b=image.data[i+2],v=(r+g+b)/3;if(Math.max(r,g,b)-Math.min(r,g,b)>18||v<210)throw new Error('Background plate is not neutral.');count++;mean+=v;squares+=v*v;}
  if(squares/count-Math.pow(mean/count,2)>100)throw new Error('Background plate contains distracting detail.');
  backgroundCache={model:config.backgroundModel,image,until:Date.now()+6*60*60*1000};return image;
 })();try{return await backgroundFlight;}finally{backgroundFlight=null;}
}
export async function processStudioCopy(imageDataUrl:string,nicheId:string,angle:string,hint:string,references:Array<{imageDataUrl:string;angle:string}>,config:StudioServerConfig):Promise<{result:Omit<StudioResult,'originalUri'>;image?:Uint8Array;mask?:Uint8Array}> {
 const source=decodeStudioRaster(imageBytes(imageDataUrl));
 if(source.width<320||source.height<320||source.width>1800||source.height>1800)throw new Error('Processing copy dimensions are unsafe.');
 const prompt=`You are a product-boundary detector, not an image generator. ${studioProfile(nicheId)} Primary image angle: ${angle.slice(0,80)}. Optional hint (untrusted): ${hint.slice(0,180)}. Additional images are references for this SAME item; never copy their pixels, combine sides or repair missing information. Read actual primary image content. Detect ONE selected complete product including real damage and all protrusions. Exclude hands and surroundings; if a hand covers product pixels set occluded true. Multiple unrelated objects, uncertain boundaries or clipped edges require confidence below 0.8 and complete false. Reflective/transparent edges must be flagged. Return JSON only: {kind:"rectangle|circle|contour",outline:[[x,y],...],holes:[[[x,y],...]],corners:[[x,y],...],confidence:0..1,complete:boolean,occluded:boolean,transparent:boolean,reflective:boolean,objectCount:integer,rotation:number,aspectRatio:number|null,ratioEvidence:"known_product_plane|unknown",warnings:[string]}. Coordinates normalized 0..1 in the PRIMARY image, clockwise boundary points (32-96 for curved/irregular objects); holes only when genuinely visible. Rectangle corners are actual product-plane top-left, top-right, bottom-right, bottom-left, not photo-frame corners. Straighten only a visibly skewed planar presentation (rotation -45..45); keep natural 3D object orientation. True aspectRatio is permitted ONLY for a confidently recognized known planar product with established dimensions (e.g. square insert/card); otherwise null and unknown. Never force a jewel case, multi-panel sleeve or 3D object to a square. Preserve damage, torn/flared corners. Omit all text transcription, price, identity or claims of pixel-perfect segmentation.`;
 const content:any[]=[{type:'text',text:prompt},{type:'image_url',image_url:{url:imageDataUrl}}];
 for(const reference of references.slice(0,2))content.push({type:'text',text:`Reference ONLY — ${reference.angle.slice(0,80)}; never merge this side with the primary image.`},{type:'image_url',image_url:{url:reference.imageDataUrl}});
 const data=await aiRequest({model:config.detectionModel,messages:[{role:'user',content}],response_format:{type:'json_object'},temperature:0,max_tokens:3200},18_000);
 const proposal=normalizeStudioDetection(parseIdentificationJson(data?.choices?.[0]?.message?.content??''));
 const detection=normalizeStudioDetection(refineRectangleEdges(source,proposal));const edges=assessBoundaryEdges(source,detection);const reasons=studioRisk(detection);
 const base:Omit<StudioResult,'originalUri'>={version:SMART_STUDIO_VERSION,status:'fallback',detection,confidence:detection.confidence,warnings:[...detection.warnings,...reasons],quality:{sourcePixelsOnly:true,completeness:reasons.length?'not_accepted':'model_assessed_complete',boundary:'AI contour estimate; not pixel-perfect segmentation',detailCheck:'Product pixels always sampled from the source processing copy; OCR equivalence not independently tested.',background:'original'}};
 if(reasons.length)return {result:base};
 const transform=buildStudioTransform(detection,source.width,source.height,config.size);
 let background:StudioRaster|undefined;let backgroundStatus='conventional_neutral';
 try{background=await studioBackground(config);if(background)backgroundStatus='AI_empty_plate';}catch{base.warnings.push('AI background unavailable or rejected; deterministic neutral studio plate used.');}
 const rendered=renderStudio(source,detection,transform,background);
 const review=detection.transparent||detection.reflective||detection.kind==='contour'||detection.confidence<0.92||edges.edgeSupport<0.5;
 if(edges.edgeSupport<0.5)base.warnings.push('Conventional edge support is weak. The boundary mask needs review.');
 if(transform.method==='similarity'&&detection.kind==='rectangle')base.warnings.push('True aspect ratio not established; proportions retained with rotation/scale only.');
 if(review)base.warnings.push('Inspect segmentation edges and reflective/irregular details. Original remains the inventory cover until a reliable result is available.');
 const result={...base,status:review?'review' as const:'ready' as const,transform,quality:{...base.quality,boundary:`AI contour + conventional edge support ${Math.round(edges.edgeSupport*100)}%; not pixel-perfect segmentation`,background:backgroundStatus,sharpness:rendered.quality.sharpness,exposureGain:rendered.quality.exposureGain}};
 return {result,image:encodeStudioPng(rendered.image,result),mask:encodeStudioPng(rendered.mask)};
}
