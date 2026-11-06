// Explicit opt-in authenticated live runner. Never changes inventory or eBay.
// Requires approved active-module JWT fixtures through CI/runner environment only.
import { createClient, FunctionsHttpError } from 'npm:@supabase/supabase-js@2';
import { decode,encode } from 'npm:jpeg-js@0.4.4';
import { studioHash,readStudioMetadata } from '../functions/_shared/smartStudioEngine.ts';
if(!Deno.args.includes('--live')){console.log('NOT RUN: pass --live and configure approved scoped JWT fixtures to exercise paid Smart Studio.');Deno.exit(0);}
const url=Deno.env.get('STUDIO_BACKEND_URL'),key=Deno.env.get('STUDIO_ANON_KEY'),jwt=Deno.env.get('STUDIO_APPROVED_JWT'),tenantId=Deno.env.get('STUDIO_TENANT_ID'),nicheId=Deno.env.get('STUDIO_NICHE_ID');
if(!url||!key||!jwt||!tenantId||!nicheId)throw new Error('Approved server-scoped fixture variables are missing; no requests were made.');
const client=createClient(url,key,{global:{headers:{Authorization:`Bearer ${jwt}`}},auth:{persistSession:false,autoRefreshToken:false}});
const fixtureNames=['march-mods-front','march-mods-rear','march-mods-disc1','march-mods-disc2'];
const angles=['Front sleeve','Rear cover','Disc 1 label','Disc 2 label'];
const results:Array<Record<string,unknown>>=[];
await Deno.mkdir('verification-output/studio-live',{recursive:true});
for(const [index,name]of fixtureNames.entries()){
 const original=await Deno.readFile(`test-lab/studio/${name}.jpeg`),originalHash=await studioHash(original);
 const source=decode(original,{useTArray:true,maxResolutionInMP:24,maxMemoryUsageInMB:512});
 const scale=Math.min(1,1280/Math.max(source.width,source.height)),width=Math.max(1,Math.round(source.width*scale)),height=Math.max(1,Math.round(source.height*scale)),data=new Uint8Array(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const sx=Math.min(source.width-1,Math.floor(x/scale)),sy=Math.min(source.height-1,Math.floor(y/scale)),offset=(sy*source.width+sx)*4;data.set(source.data.subarray(offset,offset+4),(y*width+x)*4);}
 const jpeg=encode({width,height,data},90).data;let binary='';for(const value of jpeg)binary+=String.fromCharCode(value);
 const imageDataUrl=`data:image/jpeg;base64,${btoa(binary)}`;
 const request={body:{imageDataUrl,tenantId,nicheId,angle:angles[index]},headers:{Authorization:`Bearer ${jwt}`}};
 const response=await client.functions.invoke('swish-coin-image-enhance',request);
 if(response.error){let status:number|null=null;if(response.error instanceof FunctionsHttpError)status=response.error.context.status;results.push({fixture:name,result:'FAIL',status,reason:'Studio request failed; private payload not retained.'});continue;}
 const output=response.data;
 if(output.status==='fallback'){results.push({fixture:name,result:'FALLBACK_REVIEW',reason:output.warnings,originalBytesUnchanged:await studioHash(original)===originalHash});continue;}
 const image=await fetch(output.enhancedUri);
 if(!image.ok){results.push({fixture:name,result:'FAIL',reason:'Missing stored output'});continue;}
 const bytes=new Uint8Array(await image.arrayBuffer());
 const metadata=readStudioMetadata(bytes);const replay=await client.functions.invoke('swish-coin-image-enhance',request);
 const valid=metadata?.quality?.method==='ai_cutout'&&metadata.quality.fidelityPassed===true&&metadata.cacheKey===output.cacheKey&&replay.data?.cached===true&&replay.data.cacheKey===output.cacheKey&&await studioHash(original)===originalHash;
 await Deno.writeFile(`verification-output/studio-live/${name}-presentation.png`,bytes);
 results.push({fixture:name,result:valid?'TECHNICAL_PASS_VISUAL_REVIEW_REQUIRED':'FAIL',status:output.status,confidence:output.confidence,quality:output.quality,warnings:output.warnings,originalBytesUnchanged:await studioHash(original)===originalHash,sourceHash:output.sourceHash,cacheKey:output.cacheKey});
}
// Deliberate mismatched niche denial: read-only scope test, no provider request should occur.
const denied=await client.functions.invoke('swish-coin-image-enhance',{body:{tenantId,nicheId:nicheId==='coins'?'tunes_flip':'coins',imageDataUrl:'data:image/jpeg;base64,YQ=='},headers:{Authorization:`Bearer ${jwt}`}});
results.push({fixture:'cross-niche-denial',result:denied.error instanceof FunctionsHttpError&&denied.error.context.status===403?'PASS':'FAIL'});
await Deno.writeTextFile('verification-output/studio-live/results.json',JSON.stringify({recordedAt:new Date().toISOString(),scope:nicheId,tests:results,visualAcceptance:'NOT_CERTIFIED; inspect every output against its original'},null,2));
console.log(JSON.stringify({tests:results.length,failures:results.filter(r=>r.result==='FAIL').length,visualAcceptance:'NOT_CERTIFIED'}));
if(results.some(r=>r.result==='FAIL'))Deno.exit(1);
