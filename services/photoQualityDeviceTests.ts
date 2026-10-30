// Opt-in device diagnostics. Exercises encode -> Expo native thumbnail -> JPEG decode -> measurements, without AI/network.
import { encode as encodeJpeg } from 'jpeg-js';
import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';
import { inspectPhotoQuality,type PhotoQuality } from './photoQualityService';
export interface DevicePhotoTest { name:string;passed:boolean;quality:PhotoQuality;expected:string }
export function qualityFixture(kind:'sharp'|'blurred'|'dark'|'bright') {
  const width=256,height=256,data=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const i=(y*width+x)*4;
    // Blurred fixture is the limiting case of averaging a fine repeating checker pattern into a smooth midtone.
    const value=kind==='dark' ? 5 : kind==='bright' ? 250 : kind==='blurred' ? 128 : ((Math.floor(x/8)+Math.floor(y/8))%2 ? 200 : 60);
    data[i]=value;data[i+1]=value;data[i+2]=value;data[i+3]=255;
  }
  return { width,height,data };
}
export async function runPhotoQualityDeviceTests():Promise<DevicePhotoTest[]> {
  const results:DevicePhotoTest[]=[];
  for(const kind of ['sharp','blurred','dark','bright'] as const) {
    const encoded=encodeJpeg(qualityFixture(kind),95).data;
    let binary='';for(let i=0;i<encoded.length;i++) binary+=String.fromCharCode(encoded[i]);
    const base64=btoa(binary);
    let uri=`data:image/jpeg;base64,${base64}`;
    if(Platform.OS!=='web') {
      if(!FileSystem.cacheDirectory) throw new Error('Device cache directory unavailable.');
      uri=`${FileSystem.cacheDirectory}swish_quality_test_${Date.now()}_${kind}.jpg`;
      await FileSystem.writeAsStringAsync(uri,base64,{ encoding:FileSystem.EncodingType.Base64 });
    }
    try {
      const quality=await inspectPhotoQuality(uri);
      const passed=quality.status==='measured' && (kind==='sharp' ? quality.warnings.length===0 : kind==='blurred' ? (quality.laplacianVariance ?? Infinity)<70 : kind==='dark' ? (quality.meanLuminance ?? Infinity)<45 : (quality.meanLuminance ?? 0)>225);
      results.push({ name:kind,passed,quality,expected:kind==='sharp' ? 'Readable high-contrast detail, no advisory warnings' : kind==='blurred' ? 'Low-detail advisory warning' : kind==='dark' ? 'Low-light advisory warning' : 'Clipped / bright advisory warning' });
    } finally {
      // Only the generated diagnostic cache file is removed. Never a captured/user image.
      if(Platform.OS!=='web') await FileSystem.deleteAsync(uri,{ idempotent:true }).catch(()=>{});
    }
  }
  return results;
}
