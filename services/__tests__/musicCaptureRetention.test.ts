// Mocked device storage only; no live persistence, provider calls or inventory changes.
jest.mock('@react-native-async-storage/async-storage',()=>({__esModule:true,default:{getItem:jest.fn(),setItem:jest.fn()}}));
jest.mock('expo-file-system',()=>({}));
jest.mock('react-native',()=>({Platform:{OS:'web'}}));
import AsyncStorage from '@react-native-async-storage/async-storage';
import { persistCaptureDraft, readCaptureDraft, type CaptureDraft } from '@/services/captureDraftService';
import { normalizeMusicRelease } from '@/shared/musicRelease';
import { musicCaptureResult } from '@/services/musicCaptureService';
const storage=new Map<string,string>();
beforeEach(()=>{
 storage.clear();jest.clearAllMocks();
 (AsyncStorage.setItem as jest.Mock).mockImplementation(async(key:string,value:string)=>{storage.set(key,value);});
 (AsyncStorage.getItem as jest.Mock).mockImplementation(async(key:string)=>storage.get(key)??null);
});
const retained=():CaptureDraft=>({
 mode:'cd_box_set',specialistId:'vinyl_records',result:null,savedId:null,
 answers:{media_grade:'VG+',sleeve_grade:'VG',observed_disc_count:'3',play_test:'Not tested'},
 images:[{uri:'file://retained-cover.jpg',slotId:'front_sleeve',slotLabel:'Front cover / box'}],
 musicRelease:normalizeMusicRelease({id:42,title:'Fixture compilation',artists:[{name:'Various'}],year:2012,country:'UK',formats:[{name:'CD',qty:'3',descriptions:['Compilation']}],labels:[{name:'Fixture Label',catno:'TEST-CD3'}],identifiers:[],tracklist:[]}),
});
describe('Music capture retention (mocked local storage)',()=>{
 test('navigation/reload restores confirmed catalogue fields, mode, originals and manual reviews',async()=>{
  const initial=retained();await persistCaptureDraft('user:tenant:tunes_flip',initial);
  const restored=await readCaptureDraft('user:tenant:tunes_flip');expect(restored).toEqual(initial);
  const result=musicCaptureResult(restored!.result,restored!.musicRelease,restored!.answers)!;
  expect(result.canonicalTitle).toBe('Various — Fixture compilation');expect(result.attributes.year).toBe('2012');expect(result.attributes.country).toBe('UK');
  expect(result.specialistAnalysis?.fields.release_title.value).toBe('Fixture compilation');expect(result.attributes.observed_disc_count).toBe('3');expect(result.attributes.media_grade).toBe('VG+');
 });
 test('a different user, tenant or niche does not load another capture snapshot',async()=>{
  await persistCaptureDraft('user-a:tenant-a:tunes_flip',retained());
  for(const scope of ['user-b:tenant-a:tunes_flip','user-a:tenant-b:tunes_flip','user-a:tenant-a:coins'])expect(await readCaptureDraft(scope)).toBeNull();
 });
 test('ordered autosaves retain the existing saved item ID and latest manual count for retry',async()=>{
  const initial=retained();const saved={...initial,savedId:'fixture-existing-item',answers:{...initial.answers,observed_disc_count:'2'}};
  await Promise.all([persistCaptureDraft('user:tenant:tunes_flip',initial),persistCaptureDraft('user:tenant:tunes_flip',saved)]);
  const restored=await readCaptureDraft('user:tenant:tunes_flip');expect(restored?.savedId).toBe('fixture-existing-item');expect(restored?.answers.observed_disc_count).toBe('2');
 });
});
