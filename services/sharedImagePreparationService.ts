// One BackgroundErase gateway for all niches. Provider calls and credentials stay server-side.
// Local codecs only create transport copies; they do not crop, beautify, reconstruct or replace originals.
import * as ImageManipulator from 'expo-image-manipulator';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { getSupabaseClient } from '@/template';
import { SMART_STUDIO_VERSION, studioImageIsUsable, type StudioResult } from '@/shared/smartStudio';
import type { CapturedImage } from './aiIdentificationService';
export interface StudioRequest {
 original:{uri:string;width?:number;height?:number};nicheId?:string;tenantId?:string;
 angle?:string;hint?:string;additionalPhotos?:Array<{uri:string;angle:string}>;
 quality?:'standard'|'high';signal?:AbortSignal;timeoutMs?:number;
}
export interface PreparedObjectImageReference {enhancedUri:string;warning:string;generatedBy?:string;studio?:StudioResult}
const flights=new Map<string,Promise<StudioResult>>();
const warning='BackgroundErase cutout. Original evidence retained; review fine edges, defects and lettering before listing.';
function fallback(uri:string,message:string):StudioResult{return {version:SMART_STUDIO_VERSION,status:'fallback',originalUri:uri,confidence:0,warnings:[message],quality:{sourcePixelsOnly:true,completeness:'not_assessed',boundary:'not_assessed',detailCheck:'Original unchanged',background:'original'}};}
function checkSignal(signal:AbortSignal){if(signal.aborted)throw new Error('Studio processing cancelled or timed out; original retained.');}
async function copy(uri:string,maxEdge:number,signal:AbortSignal,width?:number,height?:number):Promise<string>{
 checkSignal(signal);const scale=width&&height?Math.min(1,maxEdge/Math.max(width,height)):null;
 const actions=scale!==null?scale<1?[{resize:{width:Math.max(1,Math.round(width!*scale)),height:Math.max(1,Math.round(height!*scale))}}]:[]:[{resize:{width:maxEdge}}];
 let prepared=await ImageManipulator.manipulateAsync(uri,actions,{compress:0.9,format:ImageManipulator.SaveFormat.JPEG,base64:true});checkSignal(signal);
 if(Math.max(prepared.width??0,prepared.height??0)>maxEdge){const ratio=maxEdge/Math.max(prepared.width,prepared.height);prepared=await ImageManipulator.manipulateAsync(prepared.uri,[{resize:{width:Math.max(1,Math.round(prepared.width*ratio)),height:Math.max(1,Math.round(prepared.height*ratio))}}],{compress:0.9,format:ImageManipulator.SaveFormat.JPEG,base64:true});}
 checkSignal(signal);if(!prepared.base64)throw new Error('Could not prepare the object image. The original photo is unchanged.');
 const data=`data:image/jpeg;base64,${prepared.base64.replace(/^data:image\/[^;]+;base64,/i,'')}`;if(data.length>3_000_000)throw new Error('Image processing copy is too large.');return data;
}
async function process(request:StudioRequest,signal:AbortSignal):Promise<StudioResult>{
 const uri=request.original.uri,client=getSupabaseClient();checkSignal(signal);
 const session=await client.auth.getSession();const userId=session.data.session?.user.id;
 if(session.error||!userId)throw new Error('A verified session is required. Original photograph retained.');checkSignal(signal);
 const {default:AsyncStorage}=await import('@react-native-async-storage/async-storage');
 const {digestStringAsync,CryptoDigestAlgorithm}=await import('expo-crypto');
 const imageDataUrl=await copy(uri,request.quality==='high'?1600:1280,signal,request.original.width,request.original.height);
 const hash=await digestStringAsync(CryptoDigestAlgorithm.SHA256,JSON.stringify({version:SMART_STUDIO_VERSION,imageDataUrl,userId,tenantId:request.tenantId,nicheId:request.nicheId}));
 const key=`@swish_studio:${userId}:${hash}`;checkSignal(signal);
 const cached=await AsyncStorage.getItem(key).catch(()=>null);checkSignal(signal);
 if(cached){try{const saved=JSON.parse(cached);if(studioImageIsUsable(saved)&&saved.cachedAt>Date.now()-6*60*60*1000)return {...saved,originalUri:uri};}catch{/* Corrupt cache is not evidence. */}}
 if(flights.has(key))return {...await flights.get(key)!,originalUri:uri};
 const work=(async()=>{
  checkSignal(signal);
  const {data,error}=await client.functions.invoke('swish-coin-image-enhance',{body:{imageDataUrl,tenantId:request.tenantId,nicheId:request.nicheId},signal});
  if(error){let message=error.message||'Studio unavailable.';if(error instanceof FunctionsHttpError){try{const text=await error.context.text(),body=JSON.parse(text);message=`[Code: ${error.context.status}] ${typeof body.error==='string'?body.error:'Studio request failed.'}`;}catch{message=`[Code: ${error.context?.status??500}] Studio unavailable.`;}}throw new Error(message);}
  checkSignal(signal);
  if(data?.version!==SMART_STUDIO_VERSION||!['ready','review','fallback'].includes(data?.status))throw new Error('Smart Studio returned no usable image reference or provenance.');
  if(data.status!=='fallback'&&!studioImageIsUsable(data))throw new Error('BackgroundErase returned no validated cutout; original retained.');
  const result:StudioResult={...data,originalUri:uri,warnings:[...(Array.isArray(data.warnings)?data.warnings:[]),warning]};
  if(result.enhancedUri)await AsyncStorage.setItem(key,JSON.stringify({...result,cachedAt:Date.now()})).catch(()=>{});
  return result;
 })();flights.set(key,work);try{return await work;}finally{flights.delete(key);}
}
/** Whole-operation timeout includes auth, codecs, cache and network, not only AI. */
export function prepareObjectImage(request:StudioRequest):Promise<StudioResult>{
 const uri=request.original.uri;if(!uri?.trim())return Promise.resolve(fallback(uri??'','Capture a coin photo or object photo before creating a studio image.'));
 const controller=new AbortController();const timeout=Math.max(1,Math.min(70_000,request.timeoutMs??70_000));
 return new Promise(resolve=>{
  let settled=false;let timer:ReturnType<typeof setTimeout>|null=null;
  const finish=(result:StudioResult)=>{if(settled)return;settled=true;if(timer)clearTimeout(timer);request.signal?.removeEventListener('abort',cancel);resolve(result);};
  const cancel=()=>{controller.abort();finish(fallback(uri,'Studio processing cancelled or timed out; original retained.'));};
  timer=setTimeout(cancel,timeout);request.signal?.addEventListener('abort',cancel,{once:true});
  if(request.signal?.aborted){cancel();return;}
  void process(request,controller.signal).then(finish,cause=>finish(fallback(uri,cause instanceof Error?cause.message:'Smart Studio unavailable; original retained.')));
 });
}
// Backward-compatible Coin Flipper alias; same direct cleanup engine.
export async function generateSharedObjectImageReference(uri:string,options:Omit<StudioRequest,'original'>={}):Promise<PreparedObjectImageReference>{
 const studio=await prepareObjectImage({...options,original:{uri}});if(!studio.enhancedUri)throw new Error(studio.warnings.join(' '));
 return {enhancedUri:studio.enhancedUri,warning:studio.warnings.join(' '),generatedBy:'BackgroundErase',studio};
}
/** Serial, hard-budgeted batch. Neither this service nor the server calls identification. */
export async function prepareCapturedImages(images:readonly CapturedImage[],options:{tenantId?:string;nicheId?:string;deadlineMs?:number}={}):Promise<CapturedImage[]>{
 const output:CapturedImage[]=[];const deadline=Date.now()+(options.deadlineMs??150_000);
 for(const image of images){
  // Rechecks and inventory saves reuse this attempt, including a failed attempt: no automatic paid replay.
  if(image.studio?.version===SMART_STUDIO_VERSION&&image.studio.originalUri===image.uri){output.push(image);continue;}
  const remaining=deadline-Date.now();
  const studio=remaining>0?await prepareObjectImage({original:image,nicheId:options.nicheId,tenantId:options.tenantId,angle:image.slotLabel||image.slotId,timeoutMs:remaining}):fallback(image.uri,'Studio batch time budget reached; original retained. Retry studio separately.');
  output.push({...image,studio,enhancedUri:studio.enhancedUri,enhancementStatus:studio.enhancedUri?'ready':'failed',enhancementWarning:studio.warnings.join(' ')});
 }
 return output;
}
