import fs from 'node:fs';
import path from 'node:path';
import registry from '../../niche-modules.json';
import { normalizeMusicRelease,normalizeMusicCandidate,confirmedMusicAttributes,musicGrade,isFreshMusicRelease } from '../../shared/musicRelease';
import { resolveProductionNiche,isRouteAllowedForModule,getProductionNicheSpecialistIds } from '../nicheRouting';
import { evaluateSpecialistSafety,mappedSpecialistSpecifics,getSpecialistProfile } from '../../shared/specialistIntelligence';
const source=(name:string)=>fs.readFileSync(path.resolve(__dirname,'../..',name),'utf8');
const fixture={id:123,title:'Example Album',artists:[{name:'Example Artist'}],year:1985,country:'UK',labels:[{name:'Example Label',catno:'ABC-123'}],formats:[{name:'Vinyl',descriptions:['LP','Album']}],genres:['Rock'],styles:['Alternative'],tracklist:[{position:'A1',title:'First track',duration:'3:00'}],identifiers:[{type:'Matrix / Runout',value:'ABC-123 A1'}],master_id:456,images:[{uri:'restricted-image'}],lowest_price:999,community:{have:800},user_data:{token:'must-not-leak'}};
describe('Tunes Flip source and pure contracts — not live acceptance',()=>{
 test('new niche owns only the existing music specialist and shared workflow',()=>{
  expect(Object.keys(registry.products)).toHaveLength(13);expect(registry.products.tunes_flip.specialists).toEqual(['vinyl_records']);expect(resolveProductionNiche('vinyl_records')).toBe('tunes_flip');
  expect(isRouteAllowedForModule('/music-search','tunes_flip')).toBe(true);expect(isRouteAllowedForModule('/music-search','coins')).toBe(false);
  for(const id of Object.keys(registry.products).filter(id=>id!=='tunes_flip'))expect(getProductionNicheSpecialistIds(id)).not.toContain('vinyl_records');
 });
 test('only allowlisted catalogue data is returned; no restricted fields or secrets',()=>{
  const release=normalizeMusicRelease(fixture);expect(release.artist).toBe('Example Artist');expect(release.masterId).toBe(456);expect(release.catalogueNumbers).toEqual(['ABC-123']);expect(release.tracks[0].title).toBe('First track');
  const json=JSON.stringify(release);for(const denied of ['restricted-image','lowest_price','community','must-not-leak','user_data'])expect(json).not.toContain(denied);
 });
 test('masters are not individual pressing candidates',()=>{expect(normalizeMusicCandidate({id:1,title:'Master',type:'master'})).toBeNull();});
 test('pressing confirmation and six-hour freshness are mandatory',()=>{
  const release=normalizeMusicRelease(fixture);expect(()=>confirmedMusicAttributes(release,false)).toThrow();expect(confirmedMusicAttributes(release,true).discogs_release_id).toBe('123');
  expect(isFreshMusicRelease(release,Date.now()+7*3600000)).toBe(false);expect(()=>confirmedMusicAttributes({...release,expiresAt:new Date(0).toISOString()},true)).toThrow();
 });
 test.each(['M','NM','VG+','VG','G+','G','F','P'])('independent grade %s is supported',grade=>expect(musicGrade(grade)).toBe(grade));
 test('unsupported audio-grade claims are not normalized into Mint',()=>{expect(musicGrade('excellent sound')).toBeNull();expect(musicGrade('M-')).toBe('NM');});
 test('shared listing gate requires pressing and separate grades',()=>{
  expect(evaluateSpecialistSafety('tunes_flip',{}).blocked).toBe(true);
  expect(evaluateSpecialistSafety('tunes_flip',{pressing_reviewed:'yes',media_grade:'VG+',sleeve_grade:'VG'}).blocked).toBe(false);
  const profile=getSpecialistProfile('tunes_flip')!;expect(mappedSpecialistSpecifics(profile,{artist:'Example Artist',format:'Vinyl',media_grade:'VG+'}).Artist).toBe('Example Artist');
 });
 test('client uses only the Edge gateway and checks its error context',()=>{
  const client=source('services/discogsService.ts');expect(client).toContain("functions.invoke('swish-discogs'");expect(client).toContain('FunctionsHttpError');expect(client).toContain('error.context.text()');expect(client).not.toContain('api.discogs.com');expect(client).not.toContain('process.env');
 });
 test('credential values can only be read server-side; status is owner-authorized',()=>{
  const server=source('supabase/functions/swish-discogs/index.ts');for(const name of ['DISCOGS_CONSUMER_KEY','DISCOGS_CONSUMER_SECRET','DISCOGS_USER_AGENT'])expect(server).toContain(`Deno.env.get('${name}')`);
  expect(server).toContain("rpc('swish_is_platform_owner')");expect(server).toContain('if(role.data!==true)');expect(server).toContain('withModuleScope(');expect(server).toContain('DISCOGS_COMMERCIAL_USE_APPROVED');expect(server).not.toContain('/marketplace/price_suggestions');expect(server).toContain("'Cache-Control':'no-store'");
 });
 test('backend expertise, classifier and music contract are mirrored exactly',()=>{for(const file of ['musicRelease.ts','specialistIntelligence.ts','ebayImportScope.ts'])expect(source('supabase/functions/_shared/'+file)).toBe(source('shared/'+file));});
 test('scanner confirmation goes through existing inventory and media services',()=>{
  const hook=source('hooks/useGenericCapture.ts');expect(hook).toContain('musicCaptureResult');expect(source('services/musicCaptureService.ts')).toContain('confirmedMusicAttributes');expect(hook).toContain('separate media/sleeve grades before saving');expect(hook).toContain('saveIdentifiedItem');expect(hook).toContain('persistCapturedItemPhotos');
  expect(source('services/tunesService.ts')).toContain(".eq('specialist_id','vinyl_records')");expect(source('app/_layout.tsx')).toContain('<TunesProvider>');
 });
});
