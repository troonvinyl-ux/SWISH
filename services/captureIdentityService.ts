import * as Crypto from 'expo-crypto';
import {resolveProductionNiche} from './nicheRouting';
/** Retry identity is a scan visit, not its barcode/title/photos. A new copy gets a new visit. */
export async function captureCanonicalId(tenantId:string,nicheId:string,sessionId:string):Promise<string>{
 if(!tenantId||!nicheId||!sessionId)throw new Error('Capture account, niche and session are required.');
 const niche=resolveProductionNiche(nicheId);
 if(!niche)throw new Error('Registered capture module required.');
 const hash=await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,`swish-capture-v1:${tenantId}:${niche}:${sessionId}`);
 return `${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-${((parseInt(hash[16],16)&3)|8).toString(16)}${hash.slice(17,20)}-${hash.slice(20,32)}`;
}
