// Exact byte preservation: no resizing, re-encoding, masking or enhancement.
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { decode, encode } from 'base64-arraybuffer';
import { getSupabaseClient } from '@/template';
import { readBinaryBlob } from './binaryBlobService';
export interface OriginalBytes {bytes:ArrayBuffer;contentType:string;extension:string;hash:string}
export function originalMime(bytes:Uint8Array):{contentType:string;extension:string} {
 if(bytes[0]===255&&bytes[1]===216)return {contentType:'image/jpeg',extension:'jpg'};
 if(bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71)return {contentType:'image/png',extension:'png'};
 const text=String.fromCharCode(...bytes.slice(0,12));
 if(text.startsWith('RIFF')&&text.endsWith('WEBP'))return {contentType:'image/webp',extension:'webp'};
 if(text.startsWith('GIF8'))return {contentType:'image/gif',extension:'gif'};
 throw new Error('This original format is not allowed by the existing storage bucket. The original is retained on-device; export a JPEG/PNG copy explicitly rather than silently converting evidence.');
}
export async function readOriginalBytes(uri:string):Promise<OriginalBytes> {
 let bytes:ArrayBuffer;
 if(uri.startsWith('data:')){const match=uri.match(/^data:image\/[^;]+;base64,([A-Za-z0-9+/=]+)$/i);if(!match)throw new Error('Unsupported original data.');bytes=decode(match[1]);}
 else if(Platform.OS==='web'||/^https:\/\//.test(uri)){const response=await fetch(uri);if(!response.ok)throw new Error('Original photograph could not be read.');bytes=typeof response.arrayBuffer==='function'?await response.arrayBuffer():await readBinaryBlob(await response.blob());}
 else{bytes=decode(await FileSystem.readAsStringAsync(uri,{encoding:FileSystem.EncodingType.Base64}));}
 if(!bytes.byteLength||bytes.byteLength>5*1024*1024)throw new Error('Original exceeds the existing 5 MB bucket limit. It is retained unchanged; no automatic downsampling was performed.');
 const mime=originalMime(new Uint8Array(bytes));
 // Content-addressed SHA-256 of canonical base64 bytes (labelled, not a raw-file SHA).
 const {digestStringAsync,CryptoDigestAlgorithm}=await import('expo-crypto');
 const hash=await digestStringAsync(CryptoDigestAlgorithm.SHA256,encode(bytes));return {bytes,...mime,hash};
}
/** Verify orphaned originals against their content-addressed filename before recovery. */
export async function verifyStoredOriginal(path:string,expectedHash:string):Promise<void> {
 if(!/^[a-f0-9]{64}$/.test(expectedHash))throw new Error('Stored original has no valid byte fingerprint.');
 const read=await getSupabaseClient().storage.from('item-images').download(path);
 if(read.error||!read.data)throw new Error('Stored original could not be downloaded for verification. Retry the saved item.');
 const bytes=await readBinaryBlob(read.data);
 if(!bytes.byteLength||bytes.byteLength>5*1024*1024)throw new Error('Stored original is empty or exceeds the 5 MB limit.');
 originalMime(new Uint8Array(bytes));
 const {digestStringAsync,CryptoDigestAlgorithm}=await import('expo-crypto');
 const hash=await digestStringAsync(CryptoDigestAlgorithm.SHA256,encode(bytes));
 if(hash!==expectedHash)throw new Error('Stored original fingerprint differs; no evidence link accepted.');
}
export async function uploadUntouchedOriginal(itemId:string,slotId:string,uri:string):Promise<{url:string;hash?:string}> {
 if(/^https:\/\//.test(uri)){if(/\/studio\/|\/references\//.test(uri))throw new Error('A presentation image cannot be used as original evidence.');return {url:uri};}
 const original=await readOriginalBytes(uri);const safeSlot=slotId.replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,40)||'photo';
 const path=`${itemId}/originals/${safeSlot}_${original.hash}.${original.extension}`;
 const storage=getSupabaseClient().storage.from('item-images');
 const existing=await storage.download(path);
 if(existing.error){const upload=await storage.upload(path,Platform.OS==='web'?new Blob([original.bytes],{type:original.contentType}):original.bytes,{contentType:original.contentType,upsert:false,cacheControl:'31536000'});if(upload.error&&!/already exists|duplicate/i.test(upload.error.message))throw new Error('Original photograph upload failed.');}
 // A successful upload alone does not prove byte preservation; verify stored bytes.
 const readback=existing.error?await storage.download(path):existing;
 if(readback.error||!readback.data)throw new Error('Stored original could not be verified.');
 const received=new Uint8Array(await readBinaryBlob(readback.data)),sent=new Uint8Array(original.bytes);
 if(received.length!==sent.length||received.some((byte,index)=>byte!==sent[index]))throw new Error('Stored original bytes differ; no evidence link accepted.');
 const url=storage.getPublicUrl(path).data?.publicUrl;if(!url)throw new Error('Original photograph has no permanent URL.');return {url,hash:original.hash};
}
