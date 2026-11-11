// Executable integration regression with mocked storage/native I/O. NOT device/live acceptance.
jest.mock('@/template',()=>({getSupabaseClient:jest.fn()}));
jest.mock('react-native',()=>({Platform:{OS:'android'}}));
jest.mock('expo-file-system',()=>({readAsStringAsync:jest.fn(),EncodingType:{Base64:'base64'}}));
jest.mock('expo-image-picker',()=>({}));
jest.mock('expo-image-manipulator',()=>({manipulateAsync:jest.fn(),SaveFormat:{JPEG:'jpeg'}}));
jest.mock('expo-crypto',()=>({CryptoDigestAlgorithm:{SHA256:'SHA256'},digestStringAsync:jest.fn(async(_algorithm:string,value:string)=>require('node:crypto').createHash('sha256').update(value).digest('hex'))}));
jest.mock('@/services/sharedImagePreparationService',()=>({prepareCapturedImages:jest.fn(async images=>images)}));
import {getSupabaseClient} from '@/template';
import {readAsStringAsync} from 'expo-file-system';
import {encode} from 'base64-arraybuffer';
import {manipulateAsync} from 'expo-image-manipulator';
import {ORIGINAL_UPLOAD_LIMIT_BYTES} from '../originalImageService';
import {persistCapturedItemPhotos,linkPersistedItemPhotos} from '../photoPersistenceService';
import {NICHE_MODULES,PRODUCTION_NICHE_IDS} from '@/constants/niches';
import {preferredListingPhotos,availableListingPhotos,SMART_STUDIO_VERSION} from '@/shared/smartStudio';
import {photoPersistenceIssue} from '@/shared/photoPersistence';
import {prepareCapturedImages} from '../sharedImagePreparationService';
import type {CapturedImage} from '../aiIdentificationService';
const bytes=new Uint8Array([255,216,255,225,0,4,35,44,55,66]);
function setup(niche:typeof PRODUCTION_NICHE_IDS[number]='collectibles'){
 let row:any={id:'item',tenant_id:'tenant',specialist_id:NICHE_MODULES[niche].defaultSpecialist,media:[],attributes:{seller_note:'keep'},updated_at:'v0'};let revision=0;
 const objects=new Map<string,ArrayBuffer>();const storage={
  upload:jest.fn(async(path:string,data:ArrayBuffer)=>{if(objects.has(path))return {error:{message:'Duplicate'}};objects.set(path,data);return {error:null};}),
  download:jest.fn(async(path:string)=>objects.has(path)?{data:{arrayBuffer:async()=>objects.get(path)},error:null}:{data:null,error:{message:'Not found'}}),
  getPublicUrl:jest.fn((path:string)=>({data:{publicUrl:`https://storage.test/storage/v1/object/public/item-images/${path}`}}))
 };
 const from=jest.fn(()=>{
  let patch:any=null;const filters:Record<string,unknown>={};const q:any={};
  q.select=jest.fn(()=>q);q.eq=jest.fn((key:string,value:unknown)=>{filters[key]=value;return q;});q.update=jest.fn((value:any)=>{patch=value;return q;});
  q.maybeSingle=jest.fn(async()=>{
   if(Object.entries(filters).some(([key,value])=>row[key]!==value))return {data:null,error:null};
   if(patch)row={...row,...patch,updated_at:`v${++revision}`};
   return {data:JSON.parse(JSON.stringify(row)),error:null};
  });return q;
 });
 (getSupabaseClient as jest.Mock).mockReturnValue({from,storage:{from:jest.fn(()=>storage)}});
 (readAsStringAsync as jest.Mock).mockResolvedValue(encode(bytes.buffer));
 return {storage,from,row:()=>row,change:(patch:any)=>{row={...row,...patch};}};
}
const photos=():CapturedImage[]=>['front','back','detail_1','label','barcode'].map(slotId=>({uri:`file://retained/${slotId}.jpg`,slotId,slotLabel:slotId}));
beforeEach(()=>{jest.clearAllMocks();(prepareCapturedImages as jest.Mock).mockImplementation(async images=>images);});
test.each(PRODUCTION_NICHE_IDS)('%s keeps all roles on the same canonical item and listing assets after reopening',async niche=>{
 const db=setup(niche);const images=photos();const saved=await persistCapturedItemPhotos('tenant','item',images);
 expect(saved.complete).toBe(true);expect(saved.errors).toEqual([]);expect(db.row().media).toEqual(saved.urls);
 const reopened=JSON.parse(JSON.stringify(db.row()));
 expect(reopened.attributes._photo_assets.map((asset:any)=>asset.slotId)).toEqual(images.map(image=>image.slotId));
 expect(reopened.attributes.seller_note).toBe('keep');expect(photoPersistenceIssue(reopened.media,reopened.attributes)).toBeNull();
 expect(preferredListingPhotos(reopened.media,reopened.attributes)).toEqual(saved.urls);
 await linkPersistedItemPhotos('tenant','item',saved.urls);expect(db.row().attributes._photo_assets).toHaveLength(5);
 // New JS objects simulate restart recovery; cached references are verified, not reuploaded.
 const resumed=JSON.parse(JSON.stringify(images));expect((await persistCapturedItemPhotos('tenant','item',resumed)).complete).toBe(true);
 expect(db.storage.upload).toHaveBeenCalledTimes(5);expect(db.row().media).toEqual(saved.urls);
});
test('fresh photo persistence uses three database requests and retains exact byte verification',async()=>{
 const db=setup();const saved=await persistCapturedItemPhotos('tenant','item',photos().slice(0,2),{processImages:false});
 expect(saved.complete).toBe(true);expect(db.from).toHaveBeenCalledTimes(3);
 expect(db.storage.upload).toHaveBeenCalledTimes(2);expect(db.storage.download).toHaveBeenCalledTimes(2);
 const before=db.from.mock.calls.length;await linkPersistedItemPhotos('tenant','item',saved.urls);
 expect(db.from.mock.calls.length-before).toBe(1);
});
test('failed back upload keeps front linked, roles correct, identity retained and publication blocked',async()=>{
 const db=setup();let fail=true;const actual=db.storage.upload.getMockImplementation()!;
 db.storage.upload.mockImplementation(async(path,data)=>path.includes('/back_')&&fail?{error:{message:'Network failure'}}:actual(path,data));
 const images=photos().slice(0,2);const first=await persistCapturedItemPhotos('tenant','item',images);
 expect(first.complete).toBe(false);expect(db.row().media).toHaveLength(1);expect(db.row().attributes._photo_assets[0].slotId).toBe('front');
 expect(db.row().attributes._photo_pipeline.expected[1].url).toBeUndefined();expect(photoPersistenceIssue(db.row().media,db.row().attributes)).toMatch(/incomplete/);
 fail=false;expect((await persistCapturedItemPhotos('tenant','item',images)).complete).toBe(true);
 expect(db.storage.upload).toHaveBeenCalledTimes(3);expect(db.row().media).toHaveLength(2);expect(db.row().id).toBe('item');
});
test('one concurrent operation and no old media/attributes lost',async()=>{
 const db=setup();db.change({media:['https://storage.test/old.jpg']});const images=photos().slice(0,2);
 const one=persistCapturedItemPhotos('tenant','item',images),two=persistCapturedItemPhotos('tenant','item',images);expect(one).toBe(two);await one;
 expect(db.storage.upload).toHaveBeenCalledTimes(2);expect(db.row().media[0]).toBe('https://storage.test/old.jpg');expect(db.row().attributes.seller_note).toBe('keep');
});
test('optional processed images are linked by original role and become available in the editor',async()=>{
 const db=setup();const images=photos().slice(0,2);
 (prepareCapturedImages as jest.Mock).mockImplementation(async captures=>captures.map((image:any)=>({...image,studio:{version:SMART_STUDIO_VERSION,status:'ready',originalUri:image.uri,enhancedUri:`https://storage.test/processed/${image.slotId}.png`,confidence:1,warnings:[],quality:{method:'backgrounderase',provider:'BackgroundErase',sourcePixelsOnly:true,completeness:'reviewed',boundary:'reviewed',detailCheck:'unchanged',background:'transparent',checks:{validPng:true,dimensionsUnchanged:true,foregroundPresent:true,transparencyPresent:true}}}})));
 const saved=await persistCapturedItemPhotos('tenant','item',images);expect(saved.complete).toBe(true);
 expect(db.row().attributes._smart_studio_images.front.originalUri).toBe(saved.urls[0]);
 expect(availableListingPhotos(db.row().media,db.row().attributes)).toEqual([saved.urls[0],'https://storage.test/processed/front.png',saved.urls[1],'https://storage.test/processed/back.png']);expect(db.row().media).toEqual(saved.urls);expect(db.row().attributes._photo_assets).toHaveLength(2);
});
test('an oversized condition photo and successful cutout both carry into the same draft-ready item',async()=>{
 const db=setup('tech'),images=photos().slice(0,2),large=new Uint8Array(ORIGINAL_UPLOAD_LIMIT_BYTES+1);large.set([255,216]);
 (readAsStringAsync as jest.Mock).mockResolvedValue(encode(large.buffer));
 (manipulateAsync as jest.Mock).mockResolvedValue({uri:'file://copy',width:2048,height:1536,base64:encode(bytes.buffer)});
 (prepareCapturedImages as jest.Mock).mockImplementation(async captures=>captures.map((image:any)=>({...image,studio:{version:SMART_STUDIO_VERSION,status:'ready',originalUri:image.uri,enhancedUri:`https://storage.test/processed/${image.slotId}.png`,confidence:0,warnings:[],quality:{method:'backgrounderase',provider:'BackgroundErase',sourcePixelsOnly:false,completeness:'not_assessed',boundary:'provider',detailCheck:'PNG checked',background:'transparent',checks:{validPng:true,dimensionsUnchanged:true,foregroundPresent:true,transparencyPresent:true}}}})));
 const saved=await persistCapturedItemPhotos('tenant','item',images);
 expect(saved.complete).toBe(true);expect(saved.errors).toEqual([]);
 expect(images[0].uri).toBe('file://retained/front.jpg');expect(images[0].uploadCopy?.dpi).toBe(72);
 expect(db.row().attributes._photo_assets[0].uploadCopy.kind).toBe('compressed_capture_copy');
 expect(db.row().attributes._photo_assets[0].uploadCopy.uri).toBeUndefined();
 expect(db.row().attributes._photo_pipeline.status).toBe('complete');
 expect(availableListingPhotos(db.row().media,db.row().attributes)).toEqual([saved.urls[0],'https://storage.test/processed/front.png',saved.urls[1],'https://storage.test/processed/back.png']);
 expect(photoPersistenceIssue(db.row().media,db.row().attributes)).toBeNull();
});
test.each(PRODUCTION_NICHE_IDS)('%s permits lifetime gallery additions without changing sales or seller selections',async niche=>{
 const db=setup(niche);
 for(const status of ['new','review_required','listed','active','sold','fulfilled','completed','held','archived','disposed']){
  const old='https://storage.test/old.jpg';
  const pipeline={version:'canonical-photos-v1',status:'complete',expected:[{slotId:'original',url:old}]};
  db.change({status,media:[old],sold_at:'2026-11-01T12:00:00Z',sold_price:95,attributes:{seller_note:'keep',ebay_listing_media:[old],_photo_pipeline:pipeline}});
  const capture={uri:'file://new.jpg',slotId:`gallery_${status}`,slotLabel:'Extra photo'};
  const saved=await persistCapturedItemPhotos('tenant','item',[capture],{processImages:false,appendOnly:true});
  expect(saved.complete).toBe(true);expect(db.row().status).toBe(status);expect(db.row().sold_price).toBe(95);
  expect(db.row().sold_at).toBe('2026-11-01T12:00:00Z');expect(db.row().media).toEqual([old,...saved.urls]);
  expect(db.row().attributes.ebay_listing_media).toEqual([old]);expect(db.row().attributes._photo_pipeline).toEqual(pipeline);
 }
 expect(prepareCapturedImages).not.toHaveBeenCalled();
});
test('optional gallery failures never turn complete listing evidence into a publish blocker',async()=>{
 const db=setup();const old='https://storage.test/old.jpg',pipeline={version:'canonical-photos-v1',status:'complete',expected:[{slotId:'original',url:old}]};
 db.change({media:[old],attributes:{_photo_pipeline:pipeline,ebay_listing_media:[old]}});
 let fail=true;const actual=db.storage.upload.getMockImplementation()!;
 db.storage.upload.mockImplementation(async(path,data)=>path.includes('/back_')&&fail?{error:{message:'Network failure'}}:actual(path,data));
 const images=photos().slice(0,2),options={processImages:false,appendOnly:true};
 const first=await persistCapturedItemPhotos('tenant','item',images,options);
 expect(first.complete).toBe(false);expect(db.row().media).toHaveLength(2);expect(db.row().attributes._photo_pipeline).toEqual(pipeline);
 expect(photoPersistenceIssue(db.row().media,db.row().attributes)).toBeNull();
 fail=false;expect((await persistCapturedItemPhotos('tenant','item',images,options)).complete).toBe(true);
 expect(db.storage.upload).toHaveBeenCalledTimes(3);expect(db.row().media).toHaveLength(3);expect(db.row().media[0]).toBe(old);
});
test('lifetime append merges concurrent metadata without dropping older photos',async()=>{
 const db=setup();const actual=db.storage.upload.getMockImplementation()!;
 db.storage.upload.mockImplementation(async(path,data)=>{db.change({media:['https://storage.test/main.jpg','https://storage.test/concurrent.jpg'],attributes:{seller_note:'edited elsewhere'},updated_at:'concurrent'});return actual(path,data);});
 const saved=await persistCapturedItemPhotos('tenant','item',photos().slice(0,1),{processImages:false,appendOnly:true});
 expect(saved.complete).toBe(true);expect(db.row().media).toEqual(['https://storage.test/main.jpg','https://storage.test/concurrent.jpg',...saved.urls]);expect(db.row().attributes.seller_note).toBe('edited elsewhere');
});
test('a changed workspace prevents uploads and optional association',async()=>{
 const db=setup();const saved=await persistCapturedItemPhotos('tenant','item',photos().slice(0,1),{processImages:false,appendOnly:true,isCurrent:()=>false});
 expect(saved.complete).toBe(false);expect(saved.errors.join(' ')).toMatch(/Workspace changed/);expect(db.storage.upload).not.toHaveBeenCalled();expect(db.row().media).toEqual([]);
});
test('wrong tenant stops before upload and local URLs cannot be linked as persisted media',async()=>{
 const db=setup();expect((await persistCapturedItemPhotos('other','item',photos())).complete).toBe(false);expect(db.storage.upload).not.toHaveBeenCalled();
 await expect(linkPersistedItemPhotos('tenant','item',['file://local.jpg'])).rejects.toThrow('Upload original');
});
