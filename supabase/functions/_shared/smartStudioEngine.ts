// Server-only direct photo editing. No guessed contours, geometry or generated backdrops.
import { decode as decodeJpeg } from 'npm:jpeg-js@0.4.4';
import { decode as decodePng, encode as encodePng } from 'npm:fast-png@6.2.0';
import { SMART_STUDIO_VERSION,studioProfile,type StudioRaster,type StudioResult } from './smartStudio.ts';
import { parseIdentificationJson } from './identificationPolicy.ts';
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
 if(bytes.length<24||bytes[0]!==137||bytes[1]!==80)throw new Error('Unsupported image codec.');
 const header=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);if(header.getUint32(16)*header.getUint32(20)>3_000_000)throw new Error('PNG dimensions exceed processing limit.');
 const image=decodePng(bytes);if(image.width*image.height>3_000_000||image.depth!==8||![3,4].includes(image.channels))throw new Error('Unsupported image raster.');
 const data=new Uint8Array(image.width*image.height*4);for(let i=0;i<image.width*image.height;i++){data[i*4]=image.data[i*image.channels];data[i*4+1]=image.data[i*image.channels+1];data[i*4+2]=image.data[i*image.channels+2];data[i*4+3]=image.channels===4?image.data[i*4+3]:255;}return {width:image.width,height:image.height,data};
}
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
export interface StudioServerConfig {detectionModel:string;backgroundModel:string;backgroundMode:'generated'|'neutral';size:number}
export function studioServerConfig():StudioServerConfig {
 // Preserve configured models; backgroundModel is now used to edit the supplied photograph.
 return {detectionModel:Deno.env.get('SMART_STUDIO_DETECTION_MODEL')??'google/gemini-3-flash-preview',backgroundModel:Deno.env.get('SMART_STUDIO_BACKGROUND_MODEL')??'google/gemini-2.5-flash-image',backgroundMode:'neutral',size:1024};
}
async function aiRequest(body:Record<string,unknown>,timeout:number) {
 const apiKey=Deno.env.get('ONSPACE_AI_API_KEY'),baseUrl=Deno.env.get('ONSPACE_AI_BASE_URL');if(!apiKey||!baseUrl)throw new Error('OnSpace AI unavailable.');
 const response=await fetch(`${baseUrl}/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${apiKey}`},body:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});
 if(!response.ok){console.error('[Smart Studio] AI request failed',response.status);throw new Error('OnSpace AI cleanup unavailable.');}return response.json();
}
export function studioEditPrompt(nicheId:string,angle:string):string {
 return `Edit ONLY the supplied photograph. Extract the photographed product, remove the surrounding background and centre the complete product neatly on a plain pure-white square canvas with approximately 8% empty margin. Keep the same photographed side and perspective. ${studioProfile(nicheId)} View label: ${angle.slice(0,80)} (context only, not proof). This is a faithful cutout, NOT a new imagined product photo. Preserve all actual scratches, chips, cracks, stains, dents, tears, corrosion, patina, folds, missing parts and defects exactly as photographed. No beautifying, healing, symmetry, smoothing, sharpening, restoration, relighting, added reflections, accessories, props, invented edges or unseen areas. Never infer identity from memory. Do not recreate, retype, translate, complete or correct ANY printed text, logo, artwork, numbers, symbols or inscriptions. Copy those regions visually as a pixel-for-pixel trace from the source, including blur and unreadable marks. If you cannot read a letter leave its original mark unreadable; NEVER guess it. Do not use OCR to redraw text. Keep occlusions and missing content; if removing a hand would require inventing covered product pixels, return no image. Do not merge products or views. Return only the edited photograph; no captions or watermarks.`;
}
const checkKeys=['sameProduct','defectsPreserved','textUnchanged','nothingInvented','complete','centred','backgroundRemoved'];
export async function processStudioCopy(imageDataUrl:string,nicheId:string,angle:string,_hint:string,_references:Array<{imageDataUrl:string;angle:string}>,config:StudioServerConfig):Promise<{result:Omit<StudioResult,'originalUri'>;image?:Uint8Array;mask?:Uint8Array}> {
 const source=decodeStudioRaster(imageBytes(imageDataUrl));if(source.width<320||source.height<320||source.width>1800||source.height>1800)throw new Error('Processing copy dimensions are unsafe.');
 const base:Omit<StudioResult,'originalUri'>={version:SMART_STUDIO_VERSION,status:'fallback',confidence:0,warnings:[],quality:{sourcePixelsOnly:false,method:'ai_cutout',fidelityPassed:false,completeness:'not_checked',boundary:'Direct AI photo edit',detailCheck:'No pixel-exact guarantee; original retained',background:'original'}};
 const edited=await aiRequest({model:config.backgroundModel,modalities:['image','text'],image_config:{aspect_ratio:'1:1',image_size:'1K'},messages:[{role:'user',content:[{type:'text',text:studioEditPrompt(nicheId,angle)},{type:'image_url',image_url:{url:imageDataUrl}}]}]},42_000);
 const uri=edited?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
 if(typeof uri!=='string'||!uri.startsWith('data:image/'))return {result:{...base,warnings:['AI returned no safe cutout. Original retained.']}};
 const raster=decodeStudioRaster(imageBytes(uri));
 const assessment=await aiRequest({model:config.detectionModel,temperature:0,max_tokens:1200,response_format:{type:'json_object'},messages:[{role:'user',content:[
  {type:'text',text:`Compare SOURCE (first) and EDIT (second), visually, not by inferred identity. Reject any invented/changed lettering (including unreadable marks), logos, artwork, shape, colour, textures, missing components or condition defects. Confirm all visible defects remain and no covered area was invented. Check the product is complete, neatly centred with margin and its surrounding background removed to white or transparency. Any doubt, insufficient resolution or obscured detail means false, not a guessed pass. Never transcribe any text. JSON only: {sameProduct:boolean,defectsPreserved:boolean,textUnchanged:boolean,nothingInvented:boolean,complete:boolean,centred:boolean,backgroundRemoved:boolean,confidence:number,warnings:[string]}. This is model-based visual comparison, NOT pixel-exact certification.`},
  {type:'image_url',image_url:{url:imageDataUrl}},{type:'image_url',image_url:{url:uri}},
 ]}]},18_000);
 const review=parseIdentificationJson(assessment?.choices?.[0]?.message?.content??'') as Record<string,any>;
 const checks=Object.fromEntries(checkKeys.map(key=>[key,review[key]===true]));
 const confidence=typeof review.confidence==='number'&&Number.isFinite(review.confidence)?Math.max(0,Math.min(1,review.confidence)):0;
 const passed=checkKeys.every(key=>checks[key])&&confidence>=0.95;
 const warnings=(Array.isArray(review.warnings)?review.warnings:[]).filter((value:unknown)=>typeof value==='string').slice(0,4).map((value:string)=>value.slice(0,180));
 if(!passed)return {result:{...base,confidence,warnings:[...warnings,'Cleanup did not pass detail-preservation checks. Original carried forward.'],quality:{...base.quality,checks}}};
 const result:Omit<StudioResult,'originalUri'>={...base,status:'ready',confidence,warnings,quality:{...base.quality,fidelityPassed:true,checks,completeness:'model_checked',detailCheck:'Model compared source and edit; pixel-exact fidelity is not certified',background:'background_removed_white_canvas'}};
 return {result,image:encodeStudioPng(raster,result)};
}
