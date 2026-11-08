// Pure/injected eBay end regressions; zero marketplace or inventory writes.
import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { confirmSellerListingEnd } from '../functions/_shared/ebayEndPolicy.ts';
import type { EbayStatusObservation } from '../functions/_shared/listingStatus.ts';
const active:EbayStatusObservation={externalId:'123456789',status:'active',quantity:1,quantitySold:0,endedAt:null};
const ended:EbayStatusObservation={...active,status:'ended',endedAt:'2026-11-07T12:00:00Z'};
Deno.test('a live end requires a second seller read; Ack alone is not proof',async()=>{
 let reads=0,writes=0;const result=await confirmSellerListingEnd(active.externalId,{read:async()=>++reads===1?active:ended,end:async()=>{writes++;}});assertEquals(result,ended);assertEquals(reads,2);assertEquals(writes,1);
});
Deno.test('already-ended retry performs only one read and no duplicate End',async()=>{
 let writes=0;await confirmSellerListingEnd(active.externalId,{read:async()=>ended,end:async()=>{writes++;}});assertEquals(writes,0);
});
Deno.test('still-active readback after End cannot enable deletion',async()=>{
 await assertRejects(()=>confirmSellerListingEnd(active.externalId,{read:async()=>active,end:async()=>{}}),Error,'not confirmed');
});
Deno.test('sold, mismatched identity and malformed quantities block before a seller write',async()=>{
 for(const value of [{...active,status:'sold' as const,quantitySold:1},{...active,externalId:'999'},{...active,quantitySold:2},{...active,quantity:0}]){
  let writes=0;await assertRejects(()=>confirmSellerListingEnd(active.externalId,{read:async()=>value,end:async()=>{writes++;}}));assertEquals(writes,0);
 }
});
Deno.test('post-End read timeout preserves uncertainty; no automatic second End',async()=>{
 let reads=0,writes=0;await assertRejects(()=>confirmSellerListingEnd(active.externalId,{read:async()=>{if(++reads===1)return active;throw new Error('timeout');},end:async()=>{writes++;}}));assertEquals(writes,1);
});
Deno.test('partial sales can end remaining stock but sold evidence is retained',async()=>{
 let reads=0;const result=await confirmSellerListingEnd(active.externalId,{read:async()=>({...active,quantity:3,quantitySold:1,status:++reads===1?'active':'ended'}),end:async()=>{}});assertEquals(result.quantitySold,1);assertEquals(result.status,'ended');
});
