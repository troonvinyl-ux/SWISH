// Mocked codecs/storage: not device photography or live provider acceptance.
jest.mock('react-native',()=>({Platform:{OS:'ios'}}));
jest.mock('expo-file-system',()=>({documentDirectory:'file://documents/',readAsStringAsync:jest.fn(),writeAsStringAsync:jest.fn(),makeDirectoryAsync:jest.fn(),EncodingType:{Base64:'base64'}}));
jest.mock('expo-image-manipulator',()=>({manipulateAsync:jest.fn(),SaveFormat:{JPEG:'jpeg'}}));
jest.mock('expo-crypto',()=>({CryptoDigestAlgorithm:{SHA256:'SHA256'},digestStringAsync:jest.fn(async(_algorithm:string,value:string)=>require('node:crypto').createHash('sha256').update(value).digest('hex'))}));
jest.mock('@/template',()=>({getSupabaseClient:jest.fn()}));
import fs from 'node:fs';
import {encode} from 'base64-arraybuffer';
import * as FileSystem from 'expo-file-system';
import {manipulateAsync} from 'expo-image-manipulator';
import {getSupabaseClient} from '@/template';
import {uploadCapturedPhoto} from '../captureUploadService';
import {captureCopySize,jpegAt72Dpi} from '@/shared/captureUpload';
import {ORIGINAL_UPLOAD_LIMIT_BYTES} from '../originalImageService';
import type {CapturedImage} from '../aiIdentificationService';
const small=new Uint8Array([255,216,255,225,0,4,35,44,255,217]);
function setup(source=small){
 const files=new Map<string,string>(),objects=new Map<string,ArrayBuffer>();
 (FileSystem.readAsStringAsync as jest.Mock).mockImplementation(async(uri:string)=>files.get(uri)??encode(source.buffer));
 (FileSystem.writeAsStringAsync as jest.Mock).mockImplementation(async(uri:string,value:string)=>{files.set(uri,value);});
 (manipulateAsync as jest.Mock).mockImplementation(async(_uri:string,actions:any[])=>({uri:'file://encoded.jpg',base64:encode(small.buffer),width:actions?.[0]?.resize?.width??4032,height:actions?.[0]?.resize?.height??3024}));
 const storage={upload:jest.fn(async(path:string,bytes:ArrayBuffer)=>{if(objects.has(path))return {error:{message:'Already exists'}};objects.set(path,bytes);return {error:null};}),download:jest.fn(async(path:string)=>({data:{arrayBuffer:async()=>objects.get(path)},error:null})),getPublicUrl:(path:string)=>({data:{publicUrl:`https://storage.test/item-images/${path}`}})};
 (getSupabaseClient as jest.Mock).mockReturnValue({storage:{from:()=>storage}});
 return {storage,objects,files};
}
beforeEach(()=>jest.clearAllMocks());
test('resize bounds both edges, never upscales, preserves portrait aspect ratio',()=>{
 expect(captureCopySize(3024,4032)).toEqual({width:1536,height:2048});
 expect(captureCopySize(640,480)).toEqual({width:640,height:480});
 expect(()=>captureCopySize(0,480)).toThrow();
});
test('JFIF density is 72 DPI without touching scan bytes, and is idempotent',()=>{
 const result=jpegAt72Dpi(small);
 expect([...result.slice(2,20)]).toEqual([255,224,0,16,74,70,73,70,0,1,1,1,0,72,0,72,0,0]);
 expect(result.slice(20)).toEqual(small.slice(2));
 expect(jpegAt72Dpi(result)).toEqual(result);expect(small.length).toBe(10);
});
test('small originals still upload exact bytes without codec conversion',async()=>{
 const db=setup();const photo:CapturedImage={uri:'file://original.jpg',slotId:'front',slotLabel:'Front'};
 await uploadCapturedPhoto('item',photo);
 expect(db.storage.upload).toHaveBeenCalledWith(expect.any(String),small.buffer,expect.objectContaining({upsert:false}));
 expect(manipulateAsync).not.toHaveBeenCalled();expect(photo.uploadCopy).toBeUndefined();
});
test('over-5-MB captures save a byte-verified 72-DPI copy and keep the full-resolution source',async()=>{
 const large=new Uint8Array(ORIGINAL_UPLOAD_LIMIT_BYTES+1);large.set([255,216]);const db=setup(large);
 const photo:CapturedImage={uri:'file://full-resolution.jpg',width:4032,height:3024,slotId:'condition',slotLabel:'Condition'};
 const saved=await uploadCapturedPhoto('item',photo);
 expect(photo.uri).toBe('file://full-resolution.jpg');expect(photo.width).toBe(4032);
 expect(photo.uploadCopy).toEqual(expect.objectContaining({kind:'compressed_capture_copy',width:2048,height:1536,dpi:72}));
 expect(saved.url).toContain('/item/originals/condition_');
 const uploaded=db.storage.upload.mock.calls[0][1];expect(uploaded.byteLength).toBeLessThan(ORIGINAL_UPLOAD_LIMIT_BYTES);
 expect(new Uint8Array(uploaded)[15]).toBe(72);expect(new Uint8Array(uploaded)[17]).toBe(72);
 expect(db.storage.download).toHaveBeenCalledTimes(1);expect(FileSystem.writeAsStringAsync).toHaveBeenCalledTimes(1);
 // Retry shares the retained local export, but still verifies immutable storage bytes.
 await uploadCapturedPhoto('item',photo);expect(manipulateAsync).toHaveBeenCalledTimes(1);expect(db.objects.size).toBe(1);expect(db.storage.download).toHaveBeenCalledTimes(2);
});
test('actual encoded bytes determine acceptance, not a nominal DPI value',async()=>{
 const large=new Uint8Array(ORIGINAL_UPLOAD_LIMIT_BYTES+1);large.set([255,216]);const db=setup(large);
 (manipulateAsync as jest.Mock).mockResolvedValue({uri:'file://huge.jpg',base64:encode(large.buffer),width:2048,height:1536});
 const photo:CapturedImage={uri:'file://full.jpg',width:4032,height:3024,slotId:'front',slotLabel:'Front'};
 await expect(uploadCapturedPhoto('item',photo)).rejects.toThrow('size limit');
 expect(db.storage.upload).not.toHaveBeenCalled();expect(photo.uri).toBe('file://full.jpg');expect(manipulateAsync).toHaveBeenCalledTimes(3);
});
test('cleanup begins at capture, is reused by Next and finishes before archive uploads',()=>{
 const hook=fs.readFileSync('hooks/useQuickList.ts','utf8');
 const capture=hook.slice(hook.indexOf('const addPhoto='),hook.indexOf('const removePhoto='));
 expect(capture).toContain('preparePhotoStudio(image)');expect(capture).not.toContain('createQuickInventory(');
 expect(hook).toContain('photoStudioFlights.current.get(key)');expect(hook).toContain('Promise.all(before.images.map(preparePhotoStudio))');
 const photos=hook.slice(hook.indexOf("step='draft';const photos="),hook.indexOf('const next={...current.current,result,itemId:item.id'));
 expect(photos.indexOf('await optionalStudio')).toBeLessThan(photos.indexOf('uploadQuickPhotos('));
 expect(photos).not.toContain('linkQuickCutouts(');
});
