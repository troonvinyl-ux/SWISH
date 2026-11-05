// Public CC0 catalogue contract only. Never includes provider credentials, pricing, images or user data.
export const MUSIC_NICHE_ID = 'tunes_flip' as const;
export const MUSIC_SPECIALIST_ID = 'vinyl_records' as const;
export const MUSIC_GRADES = ['M','NM','VG+','VG','G+','G','F','P'] as const;
export type MusicGrade = typeof MUSIC_GRADES[number];
export interface MusicCandidate { id:number; title:string; year:string; country:string; format:string[]; labels:string[]; catalogueNumbers:string[]; url:string }
export interface MusicRelease extends MusicCandidate { artist:string; releaseTitle:string; released:string; masterId:number|null; genres:string[]; styles:string[]; identifiers:Array<{type:string;value:string;description:string}>; tracks:Array<{position:string;title:string;duration:string}>; fetchedAt:string; expiresAt:string }
const record = (v:unknown):Record<string,any> => v && typeof v==='object' && !Array.isArray(v) ? v as Record<string,any> : {};
const text = (v:unknown,max=180):string => typeof v==='string'||typeof v==='number' ? String(v).trim().slice(0,max) : '';
const list = (v:unknown):string[] => Array.isArray(v) ? v.map(x=>text(x)).filter(Boolean).slice(0,30) : [];
export function musicGrade(value:string):MusicGrade|null { const v=value.trim().toUpperCase();return (MUSIC_GRADES as readonly string[]).includes(v)?v as MusicGrade:v==='M-'?'NM':null; }
export function musicReleaseUrl(id:number):string { if(!Number.isSafeInteger(id)||id<1)throw new Error('Valid individual release ID required.');return `https://www.discogs.com/release/${id}`; }
export function normalizeMusicCandidate(input:unknown):MusicCandidate|null {
 const row=record(input);const id=Number(row.id);if(!Number.isSafeInteger(id)||id<1||row.type==='master')return null;
 return {id,title:text(row.title),year:text(row.year,10),country:text(row.country),format:list(row.format),labels:list(row.label),catalogueNumbers:list(row.catno),url:musicReleaseUrl(id)};
}
export function normalizeMusicRelease(input:unknown,now=Date.now()):MusicRelease {
 const row=record(input);const id=Number(row.id);const url=musicReleaseUrl(id);
 const artists=(Array.isArray(row.artists)?row.artists:[]).map((x:unknown)=>record(x)).map((x:Record<string,any>)=>text(x.anv||x.name)).filter(Boolean).join(' / ');
 const labels=(Array.isArray(row.labels)?row.labels:[]).map((x:unknown)=>record(x));
 const formats=(Array.isArray(row.formats)?row.formats:[]).map((x:unknown)=>record(x)).flatMap((x:Record<string,any>)=>[text(x.name),...list(x.descriptions),text(x.text)]).filter(Boolean);
 const releaseTitle=text(row.title);if(!releaseTitle||!artists)throw new Error('Discogs returned incomplete release metadata.');
 return {id,url,title:`${artists} — ${releaseTitle}`,artist:artists,releaseTitle,year:text(row.year,10),country:text(row.country),released:text(row.released,40),masterId:Number.isSafeInteger(row.master_id)&&row.master_id>0?row.master_id:null,format:formats,labels:labels.map(x=>text(x.name)).filter(Boolean),catalogueNumbers:labels.map(x=>text(x.catno)).filter(Boolean),genres:list(row.genres),styles:list(row.styles),identifiers:(Array.isArray(row.identifiers)?row.identifiers:[]).slice(0,60).map((x:unknown)=>{const r=record(x);return {type:text(r.type),value:text(r.value),description:text(r.description)};}),tracks:(Array.isArray(row.tracklist)?row.tracklist:[]).slice(0,150).map((x:unknown)=>{const r=record(x);return {position:text(r.position,20),title:text(r.title),duration:text(r.duration,20)};}),fetchedAt:new Date(now).toISOString(),expiresAt:new Date(now+6*60*60*1000).toISOString()};
}
export function isFreshMusicRelease(value:unknown,now=Date.now()):value is MusicRelease {
 const r=record(value);return Number.isSafeInteger(r.id)&&r.id>0&&typeof r.artist==='string'&&typeof r.releaseTitle==='string'&&r.url===musicReleaseUrl(r.id)&&Array.isArray(r.format)&&Array.isArray(r.labels)&&Array.isArray(r.catalogueNumbers)&&Array.isArray(r.tracks)&&Number.isFinite(Date.parse(r.fetchedAt))&&Date.parse(r.fetchedAt)<=now&&Date.parse(r.expiresAt)>now&&Date.parse(r.expiresAt)<=Date.parse(r.fetchedAt)+6*60*60*1000;
}
export function confirmedMusicAttributes(release:MusicRelease,confirmed:boolean) {
 if(!confirmed||!isFreshMusicRelease(release))throw new Error('Retrieve a fresh individual release and confirm the pressing first.');
 return {niche_id:MUSIC_NICHE_ID,artist:release.artist,release_title:release.releaseTitle,year:release.year,country:release.country,format:release.format.join(', '),label:release.labels.join(', '),catalogue_number:release.catalogueNumbers.join(', '),genre:release.genres.join(', '),style:release.styles.join(', '),discogs_release_id:String(release.id),discogs_release_url:release.url,discogs_master_id:release.masterId,discogs_catalogue_checked_at:release.fetchedAt,discogs_pressing_confirmed:true,discogs_pressing_confirmed_at:new Date().toISOString(),discogs_tracklist:release.tracks,discogs_identifiers:release.identifiers,discogs_attribution:'Data provided by Discogs.'};
}
