// Legacy framing tool now retains the original. Background removal uses the shared Edge gateway.
export type CoinImageTool = 'detect' | 'enhance';
export interface CoinImageProcessResult {uri:string;note:string}
export async function processCoinImage(uri:string,_mode:CoinImageTool):Promise<CoinImageProcessResult>{
 if(!uri?.trim())throw new Error('No usable photo was supplied. Retake or select a photo.');
 return {uri,note:'Original retained without local enhancement or cropping. Use shared BackgroundErase background removal for a separate cutout.'};
}
