import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';
import type { CapturedImage, AIIdentificationResult } from './aiIdentificationService';
export interface CaptureDraft { images: CapturedImage[]; result: AIIdentificationResult | null; savedId: string | null; mode: string; specialistId: string; answers: Record<string,string> }
const queue = new Map<string,Promise<void>>();
const keyFor = (scope: string) => `@swish_capture_v1:${scope}`;
export async function readCaptureDraft(scope: string): Promise<CaptureDraft | null> {
  try { const text = await AsyncStorage.getItem(keyFor(scope)); return text ? JSON.parse(text) : null; } catch { return null; }
}
export function persistCaptureDraft(scope: string, draft: CaptureDraft): Promise<void> {
  // Serialise writes for one draft so an older autosave cannot replace a newer save.
  const previous = queue.get(scope) ?? Promise.resolve();
  const pending = previous.catch(()=>{}).then(()=>AsyncStorage.setItem(keyFor(scope),JSON.stringify(draft)));
  queue.set(scope,pending);
  void pending.finally(()=>{ if (queue.get(scope)===pending) queue.delete(scope); }).catch(()=>{});
  return pending;
}
export async function retainCaptureImage(image: CapturedImage): Promise<CapturedImage> {
  if (Platform.OS==='web' || !FileSystem.documentDirectory || !image.uri.startsWith('file://')) return image;
  const folder = FileSystem.documentDirectory+'swish-capture/';
  await FileSystem.makeDirectoryAsync(folder,{ intermediates:true });
  const uri = folder+Date.now()+'-'+Math.random().toString(36).slice(2)+'.jpg';
  await FileSystem.copyAsync({ from:image.uri,to:uri });
  return { ...image,uri };
}
