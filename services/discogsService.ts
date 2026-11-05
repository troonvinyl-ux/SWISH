// Client gateway only: no Discogs credentials or direct provider calls.
import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';
import type { MusicCandidate, MusicRelease } from '@/shared/musicRelease';
export type DiscogsMode='text'|'barcode'|'catalogue'|'artist_title';
export interface DiscogsSearch {masterId?:number;results:MusicCandidate[];page:number;pages:number;total:number;fetchedAt:string;expiresAt:string}
export interface DiscogsSetup {configured:boolean;missing:string[];commercialUseApproved:boolean;oauthAvailable:false;callbackUrl:null;checkedAt:string}
async function invoke<T>(body:Record<string,unknown>):Promise<T>{
 const {data,error}=await getSupabaseClient().functions.invoke('swish-discogs',{body});
 if(error){let message='Discogs catalogue request failed. Retry.';
  if(error instanceof FunctionsHttpError){try{const raw=await error.context.text();const parsed=JSON.parse(raw);message=`[${error.context.status}] ${typeof parsed.message==='string'?parsed.message:typeof parsed.error==='string'?parsed.error:message}`;}catch{message=`[${error.context?.status??500}] Discogs catalogue is unavailable.`;}}
  throw new Error(message);
 }
 if(!data||data.error)throw new Error(data?.message??'Discogs returned no catalogue response.');return data as T;
}
export function searchDiscogs(tenantId:string,query:string,mode:DiscogsMode,page=1,artist=''){return invoke<DiscogsSearch>({action:'search',tenantId,nicheId:'tunes_flip',query,mode,page,artist});}
export async function getDiscogsRelease(tenantId:string,releaseId:number){const data=await invoke<{release:MusicRelease}>({action:'release',tenantId,nicheId:'tunes_flip',releaseId});return data.release;}
export function getDiscogsVersions(tenantId:string,masterId:number,page=1){return invoke<DiscogsSearch>({action:'versions',tenantId,nicheId:'tunes_flip',masterId,page});}
export function getDiscogsSetup(){return invoke<DiscogsSetup>({action:'status'});}
export function checkDiscogsConnection(){return invoke<{connectivity:'PASS';configured:true;releaseId:number;checkedAt:string;readOnly:true}>({action:'health'});}
