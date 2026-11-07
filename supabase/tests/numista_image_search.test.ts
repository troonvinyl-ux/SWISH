// Mock provider only; no paid searches, credentials from the project, or production writes.
import { searchNumistaImages } from '../functions/_shared/numistaImageSearchService.ts';
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const fixture = {mime_type:'image/jpeg',image_data:btoa(String.fromCharCode(...[255,216,255,192,0,17,8,1,0,1,0,3,1,17,0,2,17,0,3,17,0,255,217])),width:256,height:256,label:'Obverse'};
Deno.test('paid request shape, identifiers, bounded detail budget and no confidence invention', async()=>{
  const previous=Deno.env.get('NUMISTA_API_KEY');Deno.env.set('NUMISTA_API_KEY','test-key-not-a-secret');
  try {
    const calls:Array<{url:string;init?:RequestInit}>=[];
    const mocked=(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);calls.push({url,init});
      return new Response(JSON.stringify(url.includes('search_by_image')?{types:[{id:12,title:'Catalogue lead'},{id:12,title:'Duplicate'},{id:13,title:'Alternative'}]}:{id:Number(url.match(/types\/(\d+)/)?.[1]),title:'Retrieved lead',weight:10,size:25}),{status:200});
    }) as typeof fetch;
    const output=await searchNumistaImages([fixture,fixture],mocked);
    assert(output.result.status==='results','Search failed');assert(calls.length===3,'Duplicate or excessive detail requests');
    const request=JSON.parse(String(calls[0].init?.body));
    assert(request.category==='coin'&&request.images.length===2,'Invalid provider shape');
    assert(request.images[0].image_data===fixture.image_data&&!request.images[0].width,'Data URI or client metadata sent to Numista');
    assert(output.result.candidates[0].numistaN==='N#12','Attribution identifier missing');
    assert(!('confidence' in output.result.candidates[0]),'Relevance was promoted into confidence');
  } finally {if(previous===undefined)Deno.env.delete('NUMISTA_API_KEY');else Deno.env.set('NUMISTA_API_KEY',previous);}
});
Deno.test('403 and rate limit do not replay billed requests or throw away the calling identification', async()=>{
  const previous=Deno.env.get('NUMISTA_API_KEY');Deno.env.set('NUMISTA_API_KEY','test-key-not-a-secret');
  try {
    for(const status of [403,429,500]){
      let calls=0;const mocked=(async()=>{calls++;return new Response('{}',{status});}) as typeof fetch;
      const output=await searchNumistaImages([fixture],mocked);
      assert(calls===1&&output.result.status==='unavailable','Failed request replayed');assert(!output.catalogue.length,'Invented fallback candidates');
    }
    let calls=0;const mocked=(async()=>{calls++;return new Response('{}');}) as typeof fetch;
    await searchNumistaImages([{...fixture,width:2048}],mocked);
    assert(calls===0,'Invalid dimensions reached the paid provider');
  }finally{if(previous===undefined)Deno.env.delete('NUMISTA_API_KEY');else Deno.env.set('NUMISTA_API_KEY',previous);}
});
