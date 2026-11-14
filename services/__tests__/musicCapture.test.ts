// Pure fixtures and source contracts only. No Discogs, AI, inventory or seller requests.
import fs from 'node:fs';
import path from 'node:path';
import { normalizeMusicRelease, confirmedMusicAttributes } from '@/shared/musicRelease';
import { getSpecialistProfile, mappedSpecialistSpecifics } from '@/shared/specialistIntelligence';
import { musicCaptureResult, musicCaptureSlots, musicDiscCount, switchMusicCaptureMode, retainedMusicSlots } from '@/services/musicCaptureService';
import type { CaptureDraft } from '@/services/captureDraftService';
const fixture={id:123,title:'Fixture Compilation',artists:[{name:'Various'}],year:2012,country:'UK',labels:[{name:'Fixture Label',catno:'FIX-3CD'}],formats:[{name:'CD',qty:'3',descriptions:['Compilation']}],genres:['Soul'],styles:['Rhythm & Blues'],identifiers:[{type:'Barcode',value:'5 012345 678900'},{type:'Matrix / Runout',value:'FIX CD1'}],tracklist:[{position:'1-1',title:'Fixture Track',duration:'3:00'}],images:[{uri:'restricted'}],lowest_price:1234};
const release=()=>normalizeMusicRelease(fixture);
const source=(name:string)=>fs.readFileSync(path.resolve(process.cwd(),name),'utf8');
const draft=():CaptureDraft=>({mode:'item',specialistId:'vinyl_records',result:null,savedId:null,answers:{media_grade:'VG+',sleeve_grade:'VG'},musicRelease:release(),images:[{uri:'file://front.jpg',slotId:'front_sleeve',slotLabel:'Front Sleeve'},{uri:'file://disc1.jpg',slotId:'label_a',slotLabel:'Label A'},{uri:'file://disc2.jpg',slotId:'label_b',slotLabel:'Label B'},{uri:'file://hub.jpg',slotId:'matrix',slotLabel:'Matrix / Runout'}]});
describe('Confirmed music metadata and CD capture (fixture tests, not live verification)',()=>{
 test('preserves catalogue compilation, CD, UK, 2012, label, reference and count',()=>{
  const data=release();const attrs=confirmedMusicAttributes(data,true);
  expect(data.discCount).toBe(3);expect(attrs.release_type).toBe('Compilation');expect(attrs.expected_disc_count).toBe('3');expect(attrs.barcode).toBe('5012345678900');
  expect(attrs.year).toBe('2012');expect(attrs.country).toBe('UK');expect(attrs.catalogue_number).toBe('FIX-3CD');
  expect(attrs).not.toHaveProperty('observed_disc_count');expect(JSON.stringify(attrs)).not.toContain('restricted');expect(attrs).not.toHaveProperty('lowest_price');
 });
 test('does not invent a catalogue count when Discogs qty is absent or invalid',()=>{
  expect(normalizeMusicRelease({...fixture,formats:[{name:'CD'}]}).discCount).toBeNull();
  expect(normalizeMusicRelease({...fixture,formats:[{name:'CD',qty:'unknown'}]}).discCount).toBeNull();
 });
 test('confirmation populates the displayed analysis without needing a successful AI call',()=>{
  const result=musicCaptureResult(null,release(),{})!;
  expect(result.canonicalTitle).toBe('Various — Fixture Compilation');expect(result.identificationSource).toBe('user_confirmed');expect(result.confidence).toBe(0);
  for(const key of ['artist','release_title','format','release_type','label','catalogue_number','year','country','genre','style','barcode','expected_disc_count']){
   expect(result.specialistAnalysis?.fields[key]?.value).toBeTruthy();expect(result.specialistAnalysis?.fields[key]?.reason).toContain('Data provided by Discogs.');
  }
  expect(result.attributes.media_grade).toBe('');expect(result.attributes.sleeve_grade).toBe('');expect(result.valuationMid).toBe(0);expect(result.numistaVerification).toBeUndefined();
 });
 test('does not synthesize catalogue identity from an unconfirmed/null selection',()=>{expect(musicCaptureResult(null,null,{})).toBeNull();});
 test('expired retained snapshots cannot restore confirmation',()=>{
  const data={...release(),fetchedAt:new Date(0).toISOString(),expiresAt:new Date(6*3600000).toISOString()};
  expect(musicCaptureResult(null,data,{})).toBeNull();
  const base=musicCaptureResult(null,release(),{})!;expect(musicCaptureResult(base,data,{})!.attributes.discogs_pressing_confirmed).toBe(false);
 });
 test('catalogue metadata replaces incomplete AI fields and removes inferred flags',()=>{
  const base=musicCaptureResult(null,release(),{})!;
  base.attributes={artist:'Guess',year:'1900',_inferred_year:'1900'};
  const result=musicCaptureResult(base,release(),{})!;
  expect(result.attributes.artist).toBe('Various');expect(result.specialistAnalysis?.fields.year.value).toBe('2012');expect(result.attributes._inferred_year).toBeUndefined();
  expect(mappedSpecialistSpecifics(getSpecialistProfile('tunes_flip')!,result.attributes)['Release Year']).toBe('2012');
 });
 test('manual corrections, condition and title survive re-identification',()=>{
  const answers={label:'Corrected Label',_title:'My reviewed title',media_grade:'VG+',sleeve_grade:'VG',play_test:'Disc 2 skips',observed_disc_count:'2'};
  const result=musicCaptureResult(musicCaptureResult(null,release(),{})!,release(),answers)!;
  expect(result.attributes.label).toBe('Corrected Label');expect(result.specialistAnalysis?.fields.label.reason).toContain('manual review');expect(result.canonicalTitle).toBe('My reviewed title');
  expect(result.condition).toContain('Disc 2 skips');expect(result.attributes.expected_disc_count).toBe('3');expect(result.attributes.observed_disc_count).toBe('2');expect(result.warnings.join(' ')).toContain('Disc count mismatch');
  expect(mappedSpecialistSpecifics(getSpecialistProfile('tunes_flip')!,result.attributes)['Number of Discs']).toBeUndefined();
 });
 test('a manual negative pressing review revokes confirmed identity for save gating',()=>{expect(musicCaptureResult(null,release(),{pressing_reviewed:'no'})!.attributes.discogs_pressing_confirmed).toBe(false);});
 test('the catalogue reference cannot be substituted by a manual release-ID field',()=>{expect(musicCaptureResult(null,release(),{discogs_release_id:'999'})!.attributes.discogs_release_id).toBe('123');});
 test('a 3-CD capture contains covers, contents and all three numbered disc labels',()=>{
  const slots=musicCaptureSlots('cd_box_set',3);expect(slots.map(slot=>slot.id)).toEqual(['front_sleeve','back_sleeve','disc_count','disc_1','disc_2','disc_3']);
  expect(slots.every(slot=>slot.required)).toBe(true);expect(slots.some(slot=>/Side B|Vinyl Surface/.test(slot.label))).toBe(false);
 });
 test('large sets remain within the eight-photo request budget',()=>{expect(musicCaptureSlots('cd_box_set',99)).toHaveLength(8);});
 test.each(['0','-1','3.5','unknown','1000'])('rejects invalid physical count %s',value=>expect(musicDiscCount(value)).toBeNull());
 test('mode switching retains original images, condition and catalogue, without treating matrix as Disc 3',()=>{
  const initial=draft();const cd=switchMusicCaptureMode(initial,'cd_box_set');
  expect(cd.images.map(image=>image.uri)).toEqual(initial.images.map(image=>image.uri));expect(cd.images.map(image=>image.slotId)).toEqual(['front_sleeve','disc_1','disc_2','matrix']);
  expect(cd.answers).toEqual(initial.answers);expect(cd.musicRelease?.id).toBe(initial.musicRelease?.id);expect(cd.images.some(image=>image.slotId==='disc_3')).toBe(false);
  const vinyl=switchMusicCaptureMode(cd,'item');expect(vinyl.images.map(image=>image.slotId)).toEqual(initial.images.map(image=>image.slotId));
 });
 test('retained extra views remain visible and removable',()=>{
  const cd=switchMusicCaptureMode(draft(),'cd_box_set');const slots=retainedMusicSlots(musicCaptureSlots('cd_box_set',3),cd.images);
  expect(slots.find(slot=>slot.id==='matrix')?.required).toBe(false);
 });
 test('client and server both recognize the new mode while retaining vinyl requirements',()=>{
  expect(getSpecialistProfile('tunes_flip')!.modes.map(mode=>mode.id)).toEqual(['item','cd_box_set']);
  expect(musicCaptureSlots('item',1).map(slot=>slot.id)).toContain('matrix');
  expect(source('shared/specialistIntelligence.ts')).toBe(source('supabase/functions/_shared/specialistIntelligence.ts'));
  expect(source('shared/musicRelease.ts')).toBe(source('supabase/functions/_shared/musicRelease.ts'));
  expect(source('supabase/functions/swish-identify/index.ts')).toContain("captureMode === 'cd_box_set'");
 });
 test('review and canonical save share the same enriched result and scoped retention',()=>{
  const hook=source('hooks/useGenericCapture.ts');expect(hook).toContain('musicCaptureResult(visible.result,musicRelease,visible.answers)');expect(hook).toContain('persistCaptureDraft(storageScope,draft)');expect(hook).toContain('readCaptureDraft(storageScope)');expect(hook).toContain('if(current.current===scope)setRecovery');
  expect(hook).toContain('saveIdentifiedItem(tenant.id,result');expect(source('services/captureDraftService.ts')).toContain('musicRelease?: MusicRelease | null');
  expect(source('components/feature/PremiumScanner.tsx')).toContain('catalogueConfirmed={capture.catalogueConfirmed}');
  expect(source('components/feature/MusicCaptureControls.tsx')).toContain('Discs physically present');
 });
});
