import fs from 'node:fs';
import {PHOTO_PIPELINE_VERSION,photoPersistenceIssue,mergePhotoAssets} from '@/shared/photoPersistence';
const read=(path:string)=>fs.readFileSync(path,'utf8');
test('shared publication contract is mirrored exactly into Edge Functions',()=>{expect(read('shared/photoPersistence.ts')).toBe(read('supabase/functions/_shared/photoPersistence.ts'));});
test('capture-screen previews and partial stored media are not sufficient for publication',()=>{
 expect(photoPersistenceIssue(['blob:preview'],{})).not.toBeNull();
 expect(photoPersistenceIssue(['https://stored/front'],{_photo_pipeline:{version:PHOTO_PIPELINE_VERSION,status:'retry_required',expected:[{slotId:'front',url:'https://stored/front'},{slotId:'back'}]}})).not.toBeNull();
 expect(photoPersistenceIssue(['https://stored/front'],{_photo_pipeline:{version:PHOTO_PIPELINE_VERSION,status:'complete',expected:[{slotId:'back',url:'https://stored/back'}]}})).not.toBeNull();
 expect(photoPersistenceIssue(['https://stored/front'],{})).toBeNull();
});
test('roles are not compressed or changed by retry ordering',()=>{
 const front={slotId:'front',slotLabel:'Front',url:'https://stored/front'},back={slotId:'back',slotLabel:'Back',url:'https://stored/back'};
 expect(mergePhotoAssets([front],[back,front])).toEqual([front,back]);
});
test('legacy upload callers no longer require an in-memory studio association map',()=>{expect(read('services/aiIdentificationService.ts')).not.toContain('pendingStudioLinks');});
test('preflight, publish and SQL claim guard all block unfinished photo persistence',()=>{
 expect(read('services/listingEditorService.ts')).toContain('photoPersistenceIssue(item.media');
 expect(read('supabase/functions/swish-ebay-list/index.ts')).toContain("code:'PHOTO_PERSISTENCE_REQUIRED'");
 const claim=read('supabase/migrations/20261112_photo_persistence_publish_guard.sql');expect(claim).toContain('for update of i');expect(claim).toContain("is distinct from 'complete'");expect(claim).not.toContain('disable row level security');
});
