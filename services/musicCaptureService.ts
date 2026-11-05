// Pure shared-scanner logic. Catalogue identity is user-confirmed, never fabricated AI evidence.
import type { AIIdentificationResult, CapturedImage } from './aiIdentificationService';
import type { CaptureDraft } from './captureDraftService';
import { SPECIALISTS, type CaptureRequirement } from '@/constants/specialists';
import { confirmedMusicAttributes, isFreshMusicRelease, musicGrade, type MusicRelease } from '@/shared/musicRelease';
import { getSpecialistProfile, normalizeSpecialistAnalysis, usefulText } from '@/shared/specialistIntelligence';

export function musicDiscCount(value: unknown): number | null {
  const text=String(value??'').trim();
  if(!/^\d{1,3}$/.test(text))return null;
  const count=Number(text);return count>0&&count<=999?count:null;
}
export function musicCaptureSlots(mode:string,count:unknown):CaptureRequirement[] {
  if(mode!=='cd_box_set')return SPECIALISTS.vinyl_records.captureRequirements;
  const labels=Math.min(5,musicDiscCount(count)??1);
  return [
    {id:'front_sleeve',label:'Front cover / box',description:'Show the full title, artist and edition branding',required:true},
    {id:'back_sleeve',label:'Rear cover / barcode',description:'Show track list, label, catalogue number and barcode clearly',required:true},
    {id:'disc_count',label:'All discs / contents',description:'Lay out the discs together with case, booklet and inserts; photograph missing contents honestly',required:true},
    ...Array.from({length:labels},(_,index)=>({id:`disc_${index+1}`,label:`Disc ${index+1} label`,description:'Show printed disc number, title, label and catalogue reference without glare',required:true})),
  ];
}
/** Keep every original when changing mode; never reinterpret a runout photo as Disc 3. */
export function switchMusicCaptureMode(draft:CaptureDraft,mode:string):CaptureDraft {
  const aliases:Record<string,string>=mode==='cd_box_set'?{label_a:'disc_1',label_b:'disc_2'}:{disc_1:'label_a',disc_2:'label_b'};
  const images=draft.images.map(image=>({...image,slotId:aliases[image.slotId]??image.slotId}));
  const nextSlots=musicCaptureSlots(mode,draft.answers.observed_disc_count??draft.musicRelease?.discCount);
  return {...draft,mode,images:images.map(image=>({...image,slotLabel:nextSlots.find(slot=>slot.id===image.slotId)?.label??image.slotLabel}))};
}
export function retainedMusicSlots(slots:CaptureRequirement[],images:CapturedImage[]):CaptureRequirement[] {
  return [...slots,...images.filter(image=>!slots.some(slot=>slot.id===image.slotId)).map(image=>({id:image.slotId,label:image.slotLabel,description:'Retained original from another capture view; remove only if no longer needed',required:false}))];
}

export function musicCaptureResult(base:AIIdentificationResult|null,release:MusicRelease|null|undefined,answers:Record<string,string>):AIIdentificationResult|null {
  const confirmed=isFreshMusicRelease(release);
  if(!base&&!confirmed)return null;
  const profile=getSpecialistProfile('tunes_flip')!;
  const initial:AIIdentificationResult=base??{
    canonicalTitle:release!.title,specialistId:'vinyl_records',confidence:0,confidenceTier:'unknown',identificationState:'candidate',identificationSource:'user_confirmed',
    condition:'Media and packaging not assessed; playback not tested',conditionNotes:'',valuationLow:0,valuationMid:0,valuationHigh:0,valuationConfidence:'unknown',saleProb30d:null,
    attributes:{},attributesConfirmed:{},attributesInferred:{},evidenceSupporting:[],evidenceContradictory:[],missingInformation:[],warnings:[],suggestedDisposition:'Review physical condition before listing',dispositionDecision:'human_review',
  };
  const result:AIIdentificationResult={...initial,attributes:{...initial.attributes},attributesConfirmed:{...initial.attributesConfirmed},attributesInferred:{...initial.attributesInferred},
    warnings:[...initial.warnings],evidenceSupporting:[...initial.evidenceSupporting],
    specialistAnalysis:normalizeSpecialistAnalysis(initial.specialistAnalysis,profile,initial.confidence)};
  const analysis=result.specialistAnalysis!;
  if(!confirmed){result.attributes.discogs_pressing_confirmed=false;}
  if(confirmed){
    const catalogue=confirmedMusicAttributes(release,true);
    result.attributes={...result.attributes,...catalogue};
    result.canonicalTitle=release.title;result.identificationSource='user_confirmed';
    result.objectType=release.format.some(value=>/^CD$/i.test(value))?'CD':result.objectType;
    for(const field of profile.fields){
      const value=usefulText((catalogue as Record<string,unknown>)[field.key]);
      if(!value)continue;
      analysis.fields[field.key]={value,basis:'user_supplied',reason:`Data provided by Discogs. Release #${release.id}, confirmed by you; not physical authentication.`};
      delete result.attributes[`_inferred_${field.key}`];delete result.attributesInferred[field.key];
      delete result.attributesConfirmed[field.key]; // Catalogue data is not an observed image fact.
    }
    const evidence=`User-confirmed Discogs release #${release.id}: ${release.title}`;
    if(!result.evidenceSupporting.includes(evidence))result.evidenceSupporting.push(evidence);
  }
  for(const field of profile.fields){
    const value=answers[field.key]?.trim();if(!value||(confirmed&&field.key==='discogs_release_id'))continue;
    result.attributes[field.key]=value;
    delete result.attributes[`_inferred_${field.key}`];delete result.attributesInferred[field.key];
    analysis.fields[field.key]={value,basis:'user_supplied',reason:'Your manual review / correction; not independently verified.'};
  }
  if(answers._title?.trim())result.canonicalTitle=answers._title.trim();
  // An inferred AI grade cannot replace an explicit physical review.
  const media=musicGrade(answers.media_grade??'');const sleeve=musicGrade(answers.sleeve_grade??'');
  result.attributes.media_grade=media??'';result.attributes.sleeve_grade=sleeve??'';
  result.attributes.pressing_reviewed=answers.pressing_reviewed?.trim()||(confirmed?'yes':'no');
  if(answers.pressing_reviewed?.trim()&& !/^(yes|true)$/i.test(answers.pressing_reviewed.trim()))result.attributes.discogs_pressing_confirmed=false;
  const present=musicDiscCount(answers.observed_disc_count);const expected=musicDiscCount(result.attributes.expected_disc_count);
  if(present&&expected&&present!==expected)result.warnings.push(`Disc count mismatch: catalogue ${expected}, physically present ${present}. Review missing or extra discs before listing.`);
  result.condition=answers._condition?.trim()||`Media ${media??'unassessed'} / Packaging ${sleeve??'unassessed'}; playback ${answers.play_test?.trim()||'not tested'}`;
  if(answers._condition_notes?.trim())result.conditionNotes=answers._condition_notes.trim();
  analysis.followUps=analysis.followUps.filter(question=>!analysis.fields[question.key]||analysis.fields[question.key].basis==='inferred');
  // Catalogue quantity must never be published as physical completeness.
  if(expected)result.attributes._inferred_expected_disc_count='Catalogue specification; use the physically confirmed disc count when preparing listing specifics.';
  result.attributes._specialist_analysis=analysis;
  return result;
}
