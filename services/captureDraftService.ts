import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';
import type { CapturedImage, AIIdentificationResult } from './aiIdentificationService';
import type { MusicRelease } from '@/shared/musicRelease';
import { readOriginalBytes } from './originalImageService';
import { encode } from 'base64-arraybuffer';
// Confirmed CC0 release snapshot uses the existing per-user/tenant/niche local draft.
export interface CaptureDraft { musicRelease?: MusicRelease | null; images: CapturedImage[]; result: AIIdentificationResult | null; savedId: string | null; mode: string; specialistId: string; answers: Record<string,string> }
const queue = new Map<string,Promise<void>>();
const keyFor = (scope: string) => `@swish_capture_v1:${scope}`;
export async function readCaptureDraft(scope: string): Promise<CaptureDraft | null> {
  await queue.get(scope)?.catch(()=>{});
  const text = await AsyncStorage.getItem(keyFor(scope)); if(!text)return null;
  const draft=JSON.parse(text);
  if(!Array.isArray(draft.images)||draft.images.length>8||typeof draft.specialistId!=='string'||draft.images.some((image:any)=>typeof image?.uri!=='string'||typeof image.slotId!=='string'))throw new Error('Retained scan is invalid. Reopen the saved inventory item.');
  return draft;
}
export function persistCaptureDraft(scope: string, draft: CaptureDraft): Promise<void> {
  // Serialise writes for one draft so an older autosave cannot replace a newer save.
  const previous = queue.get(scope) ?? Promise.resolve();
  // Numista visual shortlist is transient licensed catalogue data, not an offline cache.
  const retained = { ...draft, result: draft.result ? { ...draft.result, numistaImageSearch: undefined, numistaVerification: undefined } : null };
  const pending = previous.catch(()=>{}).then(()=>AsyncStorage.setItem(keyFor(scope),JSON.stringify(retained)));
  queue.set(scope,pending);
  void pending.finally(()=>{ if (queue.get(scope)===pending) queue.delete(scope); }).catch(()=>{});
  return pending;
}
export async function retainCaptureImage(image: CapturedImage): Promise<CapturedImage> {
  if (Platform.OS==='web') {
    // Blob URLs die on reload. Keep exact bytes in the existing local draft, not a temporary URL.
    if(image.uri.startsWith('blob:')){const original=await readOriginalBytes(image.uri);return {...image,uri:`data:${original.contentType};base64,${encode(original.bytes)}`};}
    return image;
  }
  if (!FileSystem.documentDirectory || !/^(file:|content:)/.test(image.uri)) return image;
  if(image.uri.startsWith(FileSystem.documentDirectory+'swish-capture/'))return image;
  const folder = FileSystem.documentDirectory+'swish-capture/';
  await FileSystem.makeDirectoryAsync(folder,{ intermediates:true });
  const uri = folder+Date.now()+'-'+Math.random().toString(36).slice(2)+'.jpg';
  await FileSystem.copyAsync({ from:image.uri,to:uri });
  return { ...image,uri };
}
