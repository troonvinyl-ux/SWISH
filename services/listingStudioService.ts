import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImageManipulator from 'expo-image-manipulator';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { getSupabaseClient } from '@/template';
import { PRODUCTION_NICHE_IDS } from '@/constants/niches';
import { normalizeStudioEvidence, type StudioEvidence } from '@/shared/listingStudio';
import { identificationResize } from '@/shared/identificationPolicy';
import type { CapturedImage } from './aiIdentificationService';
const analysisCopies=new Map<string,Promise<string>>();
async function analysisCopy(photo:CapturedImage):Promise<string>{
 const maximum=photo.slotId==='packet'?1280:640;
 const key=`${maximum}:${photo.uri}`,existing=analysisCopies.get(key);if(existing)return existing;
 const work=(async()=>{const resize=identificationResize(photo.width,photo.height,maximum);let copy=await ImageManipulator.manipulateAsync(photo.uri,resize?[{resize}]:[],{compress:0.5,format:ImageManipulator.SaveFormat.JPEG,base64:true});if(Math.max(copy.width,copy.height)>maximum){const bounded=identificationResize(copy.width,copy.height,maximum);copy=await ImageManipulator.manipulateAsync(copy.uri,bounded?[{resize:bounded}]:[],{compress:0.5,format:ImageManipulator.SaveFormat.JPEG,base64:true});}if(!copy.base64||copy.base64.length>900000)throw new Error('This analysis copy is too large. Retake a closer photo; original retained.');return `data:image/jpeg;base64,${copy.base64}`;})();
 analysisCopies.set(key,work);if(analysisCopies.size>12)analysisCopies.delete(analysisCopies.keys().next().value!);void work.catch(()=>{if(analysisCopies.get(key)===work)analysisCopies.delete(key);});return work;
}
export async function observeStudioPhotos(input:{tenantId:string;niche:string;images:CapturedImage[];signature:string;notes:string;question:string;previous:StudioEvidence|null;signal:AbortSignal}):Promise<StudioEvidence>{
 const images:Array<{slotId:string;label:string;image:string}>=[];
 // Bound memory: one decode at a time; never send the retained original bytes to PostgreSQL.
 for(const photo of input.images){
  if(input.signal.aborted)throw new Error('Guidance cancelled.');
  const image=await analysisCopy(photo);if(input.signal.aborted)throw new Error('Guidance cancelled.');
  images.push({slotId:photo.slotId,label:photo.slotLabel,image});
 }
 const {data,error}=await getSupabaseClient().functions.invoke('swish-identify',{body:{route:'studio_observe',tenantId:input.tenantId,studioNiche:input.niche,studioImages:images,notes:input.notes,question:input.question,previous:input.previous?{...input.previous,signature:''}:null,objectType:input.previous?.objectType??''},signal:input.signal});
 if(error){let message=error.message;
  if(error instanceof FunctionsHttpError){try{const text=await error.context.text();const response=JSON.parse(text);message=typeof response.error==='string'?response.error:message;}catch{/* Retain safe SDK message. */}}
  throw new Error(message||'AI guidance unavailable. Done remains available.');
 }
 if(data?.success!==true||data.proposalOnly!==true)throw new Error('AI guidance was not confirmed. Continue photography or finish.');
 return normalizeStudioEvidence(data.evidence,input.signature,input.images,input.niche,PRODUCTION_NICHE_IDS);
}
export async function rememberStudioNiche(userId:string,tenantId:string,niche:string){await AsyncStorage.setItem(`@swish_studio_last:${userId}:${tenantId}`,niche);}
export async function readStudioNiche(userId:string,tenantId:string,allowed:readonly string[]){
 // Optional default only. Remember the actual server-authorised workspace even
 // if the seller never opens the selector. This read never blocks the camera.
 try{const current=await getSupabaseClient().rpc('swish_current_module');const id=current.data?.niche_id;if(!current.error&&current.data?.tenant_id===tenantId&&typeof id==='string'&&allowed.includes(id)){await rememberStudioNiche(userId,tenantId,id);return id;}}catch{/* A cached preference never grants permission. */}
 const id=await AsyncStorage.getItem(`@swish_studio_last:${userId}:${tenantId}`);return id&&allowed.includes(id)?id:null;
}
