// Server-only provider gateway. No keys, request headers or raw provider bodies leave this file.
export class BackgroundEraseError extends Error {
 constructor(public readonly code:string,public readonly status:number,message:string){super(message);this.name='BackgroundEraseError';}
}
const endpoint='https://api.backgrounderase.com/v2';
export function backgroundEraseFailure(status:number):BackgroundEraseError {
 if(status===401||status===403)return new BackgroundEraseError('BACKGROUND_ERASE_KEY_REJECTED',503,'BackgroundErase: the server key was rejected. Check Cloud Secrets and API access; original retained.');
 if(status===402)return new BackgroundEraseError('BACKGROUND_ERASE_CREDITS_REQUIRED',503,'BackgroundErase: credits or billing access are unavailable. Check your provider account; original retained.');
 if(status===429)return new BackgroundEraseError('BACKGROUND_ERASE_RATE_LIMIT',429,'BackgroundErase: the provider rate limit was reached. No automatic retry was made; original retained.');
 if(status===400||status===413||status===415||status===422)return new BackgroundEraseError('BACKGROUND_ERASE_IMAGE_REJECTED',422,'BackgroundErase: this processing copy was rejected. Use a supported, clearly framed photo; original retained.');
 return new BackgroundEraseError('BACKGROUND_ERASE_UNAVAILABLE',503,'BackgroundErase: processing is unavailable. No automatic retry was made; original retained.');
}
async function boundedBytes(response:Response,maximum:number):Promise<Uint8Array>{
 const length=Number(response.headers.get('content-length')??0);
 if(length>maximum)throw new BackgroundEraseError('BACKGROUND_ERASE_OUTPUT_TOO_LARGE',422,'BackgroundErase: output exceeds the storage limit; original retained.');
 const reader=response.body?.getReader();
 if(!reader){const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>maximum)throw backgroundEraseFailure(413);return bytes;}
 const chunks:Uint8Array[]=[];let total=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>maximum){await reader.cancel();throw backgroundEraseFailure(413);}chunks.push(value);}}
 finally{reader.releaseLock();}
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
/** Exactly one provider POST. No fallback provider, retries, URL fetching, AI or image reconstruction. */
export async function removeBackgroundBytes(bytes:Uint8Array,mime:'image/jpeg'|'image/png'):Promise<Uint8Array>{
 const apiKey=Deno.env.get('BACKGROUND_ERASE_API_KEY');
 if(!apiKey)throw new BackgroundEraseError('BACKGROUND_ERASE_NOT_CONFIGURED',503,'BackgroundErase: configure the server key in Cloud Secrets; original retained.');
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),30_000);
 try{
  const buffer=new ArrayBuffer(bytes.length);new Uint8Array(buffer).set(bytes);
  const form=new FormData();form.append('image_file',new Blob([buffer],{type:mime}),mime==='image/png'?'source.png':'source.jpg');
  form.append('format','png');form.append('channels','rgba');form.append('size','full');form.append('crop','false');form.append('despill','false');
  const response=await fetch(endpoint,{method:'POST',headers:{'x-api-key':apiKey},body:form,signal:controller.signal,redirect:'error'});
  if(!response.ok){console.error('[BackgroundErase] provider HTTP status',response.status);await response.body?.cancel();throw backgroundEraseFailure(response.status);}
  if(response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='image/png'){await response.body?.cancel();throw new BackgroundEraseError('BACKGROUND_ERASE_INVALID_OUTPUT',502,'BackgroundErase: no PNG cutout was returned; original retained.');}
  return await boundedBytes(response,5_200_000);
 }catch(cause){
  if(cause instanceof BackgroundEraseError)throw cause;
  throw new BackgroundEraseError(controller.signal.aborted?'BACKGROUND_ERASE_TIMEOUT':'BACKGROUND_ERASE_NETWORK',503,'BackgroundErase: request did not complete. No automatic retry was made; original retained.');
 }finally{clearTimeout(timer);}
}
