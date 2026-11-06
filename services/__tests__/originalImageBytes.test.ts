jest.mock('react-native',()=>({Platform:{OS:'ios'}}));
jest.mock('expo-file-system',()=>({readAsStringAsync:jest.fn(),EncodingType:{Base64:'base64'}}));
jest.mock('expo-crypto',()=>({CryptoDigestAlgorithm:{SHA256:'SHA256'},digestStringAsync:jest.fn().mockResolvedValue('fixture-sha')}));
jest.mock('@/template',()=>({getSupabaseClient:()=>({storage:{from:()=>mockStorage}})}));
import { readAsStringAsync } from 'expo-file-system';
import { encode } from 'base64-arraybuffer';
import { originalMime,readOriginalBytes,uploadUntouchedOriginal,verifyStoredOriginal } from '@/services/originalImageService';
import { digestStringAsync } from 'expo-crypto';
const original=new Uint8Array([255,216,255,225,0,4,35,44,55,66]);
const mockStorage={download:jest.fn(),upload:jest.fn(),getPublicUrl:jest.fn(()=>({data:{publicUrl:'https://storage.test/original.jpg'}}))};
beforeEach(()=>{jest.clearAllMocks();(readAsStringAsync as jest.Mock).mockResolvedValue(encode(original.buffer));mockStorage.upload.mockResolvedValue({error:null});mockStorage.download.mockResolvedValueOnce({data:null,error:{message:'Not found'}}).mockResolvedValue({data:{arrayBuffer:async()=>original.buffer},error:null});});
test('native source is read as bytes without fetch(file://) or manipulation',async()=>{const result=await readOriginalBytes('file://camera');expect(new Uint8Array(result.bytes)).toEqual(original);expect(result.contentType).toBe('image/jpeg');expect(readAsStringAsync).toHaveBeenCalledWith('file://camera',{encoding:'base64'});});
test('source bytes are uploaded without upsert and independently read back',async()=>{const result=await uploadUntouchedOriginal('item','front','file://camera');expect(result.hash).toBe('fixture-sha');expect(mockStorage.upload).toHaveBeenCalledWith('item/originals/front_fixture-sha.jpg',original.buffer,expect.objectContaining({upsert:false,contentType:'image/jpeg'}));expect(mockStorage.download).toHaveBeenCalledTimes(2);});
test('byte mismatch never returns an accepted original link',async()=>{mockStorage.download.mockReset().mockResolvedValueOnce({data:null,error:{message:'Not found'}}).mockResolvedValue({data:{arrayBuffer:async()=>new Uint8Array([255,216,99]).buffer},error:null});await expect(uploadUntouchedOriginal('item','front','file://camera')).rejects.toThrow('bytes differ');});
test('retry reuses verified content-addressed original without uploading again',async()=>{mockStorage.download.mockReset().mockResolvedValue({data:{arrayBuffer:async()=>original.buffer},error:null});await uploadUntouchedOriginal('item','front','file://camera');expect(mockStorage.upload).not.toHaveBeenCalled();});
test('20 MB originals are accepted by client byte validation without conversion',async()=>{const large=new Uint8Array(6*1024*1024);large[0]=255;large[1]=216;(readAsStringAsync as jest.Mock).mockResolvedValue(encode(large.buffer));const result=await readOriginalBytes('file://large-camera');expect(result.bytes.byteLength).toBe(6*1024*1024);});
test('unsupported HEIC originals are not silently converted',()=>{expect(()=>originalMime(new Uint8Array([0,0,0,24,102,116,121,112]))).toThrow('not allowed');});
test('PNG and GIF bytes retain the correct declared format',()=>{expect(originalMime(new Uint8Array([137,80,78,71,13,10]))).toEqual({contentType:'image/png',extension:'png'});expect(originalMime(new TextEncoder().encode('GIF89a'))).toEqual({contentType:'image/gif',extension:'gif'});});
test('native download Blob without arrayBuffer can still pass exact byte verification',async()=>{
 const previous=globalThis.FileReader;
 class NativeReader {
  result:string|null=null;onload:(()=>void)|null=null;onerror:(()=>void)|null=null;onabort:(()=>void)|null=null;
  abort(){} readAsDataURL(){this.result=`data:image/jpeg;base64,${encode(original.buffer)}`;this.onload?.();}
 }
 globalThis.FileReader=NativeReader as unknown as typeof FileReader;
 mockStorage.download.mockReset().mockResolvedValueOnce({data:null,error:{message:'Not found'}}).mockResolvedValue({data:{size:original.length,type:'image/jpeg'},error:null});
 try{expect((await uploadUntouchedOriginal('item','front','file://camera')).url).toContain('https://');expect(mockStorage.upload).toHaveBeenCalledTimes(1);}
 finally{globalThis.FileReader=previous;}
});
test('orphan recovery verifies the saved base64 SHA fingerprint',async()=>{
 const hash='a'.repeat(64);(digestStringAsync as jest.Mock).mockResolvedValueOnce(hash);
 mockStorage.download.mockReset().mockResolvedValue({data:{arrayBuffer:async()=>original.buffer},error:null});
 await verifyStoredOriginal(`item/originals/front_${hash}.jpg`,hash);
 expect(digestStringAsync).toHaveBeenLastCalledWith('SHA256',encode(original.buffer));
});
test('orphan recovery rejects mismatched stored fingerprints',async()=>{
 mockStorage.download.mockReset().mockResolvedValue({data:{arrayBuffer:async()=>original.buffer},error:null});
 await expect(verifyStoredOriginal('item/originals/front.jpg','b'.repeat(64))).rejects.toThrow('fingerprint differs');
});
test('generated storage paths cannot be substituted for originals',async()=>{await expect(uploadUntouchedOriginal('item','front','https://storage.test/studio/output.png')).rejects.toThrow('cannot be used as original');expect(mockStorage.upload).not.toHaveBeenCalled();});
