import {isRemovedPolicyListing,safeReconciliationIssue,SYNC_BATCH_SIZE} from '../functions/_shared/ebaySyncPolicy.ts';
import {photoMediaReadbackComplete} from '../functions/_shared/syncConcurrency.ts';
Deno.test('documented policy removal is isolated, auth and generic errors are not',()=>{if(!isRemovedPolicyListing('eBay Trading HTTP 200; error codes 21920397'))throw new Error('policy removal not recognized');for(const message of ['eBay Trading HTTP 200; error codes 21920397, 931','eBay Trading HTTP 503; error codes 21920397','REQUIRES_REAUTH: token','timeout'])if(isRemovedPolicyListing(message))throw new Error('unsafe error skipped');if(SYNC_BATCH_SIZE!==6)throw new Error('batch bound changed');});

Deno.test('structured originals survive JSON readback regardless of object identity and key ordering',()=>{
 const originals=[{url:'https://seller.example/original.jpg',original:true,metadata:{kind:'raw',index:1}},'https://seller.example/reverse.jpg'];
 const persisted=JSON.parse(JSON.stringify(originals)) as unknown[];
 if(persisted[0]===originals[0])throw new Error('test must use separate objects');
 if(!photoMediaReadbackComplete(originals,[persisted[1],{metadata:{index:1,kind:'raw'},original:true,url:'https://seller.example/original.jpg'}]))throw new Error('serialized original photo should count as retained');
 if(photoMediaReadbackComplete(originals,[persisted[0]]))throw new Error('missing reverse must not be falsely verified');
 if(photoMediaReadbackComplete(originals,null))throw new Error('unconfirmed empty media must not be accepted');
});
Deno.test('known sync stages identify exactly one existing seller item without revealing internals',()=>{
 const item='123456789012';
 const media=safeReconciliationIssue(item,new Error('SWISH photo readback mismatch'));
 if(media.externalListingId!==item||media.code!=='SWISH_PHOTO_READBACK')throw new Error('media issue not classified');
 const conflict=safeReconciliationIssue(item,new Error('SWISH canonical item status conflicts with verified eBay observation'));
 if(conflict.code!=='SWISH_STATUS_CONFLICT')throw new Error('sold-state conflict not classified');
 const unknown=safeReconciliationIssue(item,new Error('DB_TOKEN=do-not-expose'));
 if(unknown.message.includes('DB_TOKEN')||unknown.code!=='SWISH_RECONCILIATION_UNCONFIRMED')throw new Error('raw error must not be disclosed');
});
