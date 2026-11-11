// Pure/source regressions. Does not claim live provider, device or seller acceptance.
import fs from 'node:fs';
import path from 'node:path';
import registry from '../../niche-modules.json';
import { NICHES, getNicheSpecialistIds, nicheIdForSpecialist } from '@/constants/niches';
import { getSpecialistProfile, mappedSpecialistSpecifics } from '@/shared/specialistIntelligence';
import { guardStampIdentification } from '@/shared/stampIdentification';
import { stampComparableIssue } from '@/shared/stampMarket';
import { inferImportNiche } from '@/shared/ebayImportScope';
import { classifyListing } from '@/services/nicheCategoryService';
import { estimateStampPerforation, stampSellingEstimate } from '@/services/stampGuideService';
import { isRouteAllowedForModule } from '@/services/nicheRouting';
import { preferredListingPhotos, selectedListingPhotos, SMART_STUDIO_VERSION } from '@/shared/smartStudio';
const read=(file:string)=>fs.readFileSync(path.join(process.cwd(),file),'utf8');
describe('Stamp Flipper shared niche',()=>{
 test('reuses the existing specialist and isolated shared entry',()=>{
  expect(registry.products.stamps.specialists).toEqual(['stamps']);expect(nicheIdForSpecialist('stamps')).toBe('stamps');expect(NICHES.stamps.defaultSpecialist).toBe('stamps');
  for(const id of Object.keys(registry.products).filter(id=>id!=='stamps'))expect(getNicheSpecialistIds(id)).not.toContain('stamps');
  expect(isRouteAllowedForModule('/stamp-guide','stamps')).toBe(true);expect(isRouteAllowedForModule('/stamp-guide','coins')).toBe(false);
 });
 test('all philatelic modes use the shared identifier and field mapping',()=>{
  const profile=getSpecialistProfile('stamps')!;expect(profile.modes.map(mode=>mode.id)).toEqual(['item','sheet','cover','collection']);
  expect(mappedSpecialistSpecifics(profile,{country:'Great Britain',denomination:'1d',usage:'Used'})).toMatchObject({'Country/Region of Origin':'Great Britain',Denomination:'1d',Quality:'Used'});
  expect(read('services/nicheCaptureService.ts')).toContain("if (niche === 'stamps') return slots");
  for(const name of ['swish-identify','swish-list-generate','swish-market-value'])expect(read(`supabase/functions/${name}/index.ts`)).toContain('serveModule(');
 });
 test('Penny Black and Scott references do not trigger coin or bicycle classification',()=>{
  expect(classifyListing('', 'Stamps: Great Britain', 'Penny Black Scott 1 postage stamp').niche).toBe('stamps');
  expect(inferImportNiche('Stamps', 'British postage stamps job lot')).toBe('stamps');
  expect(classifyListing('', 'Coins', 'Penny Black postage stamp').niche).toBe('unclassified');
  expect(inferImportNiche('Crafts', 'rubber stamps')).toBeNull();
  expect(inferImportNiche('Stamps', 'Roman coin')).toBeNull();
 });
 test('AI cannot certify gum, perforation, watermark, price or catalogue association',()=>{
  const result=guardStampIdentification({canonicalTitle:'Great Britain SG 1 MNH postage stamp',confidence:0.9,identificationState:'verified',condition:'MNH',valuationMid:900,attributes:{perforation:'14',watermark:'Crown',sg_number:'1',gum:'MNH'},attributesConfirmed:{sg_number:'1'},specialistAnalysis:{fields:{watermark:{value:'Crown',basis:'observed'}}}});
  expect(result.identificationState).toBe('candidate');expect(result.attributesConfirmed.sg_number).toBeUndefined();expect(result.attributes.watermark).toBeUndefined();expect(result.attributes._stamp_suggestions.watermark).toBe('Crown');
  expect(result.canonicalTitle).not.toMatch(/\bMNH\b|SG 1/);expect(result.valuationMid).toBe(0);expect(result.conditionGrade).toBe('');expect(result.specialistAnalysis.fields.watermark.basis).toBe('inferred');
 });
 test('explicit measurement is retained as seller evidence, not catalogue verification',()=>{
  const result=guardStampIdentification({canonicalTitle:'Stamp',attributes:{}},{customNotes:'perforation: 14 (seller supplied; cross-check against photographs)'});
  expect(result.attributesConfirmed.perforation).toBe('14');expect(result.attributes.catalogue_status).toBe('unverified');
 });
 test('perforation helper counts intervals and refuses unusable input',()=>{
  expect(estimateStampPerforation('12','20').value).toBe(12);
  for(const input of [['','20'],['12','0'],['2.5','20'],['12','NaN'],['100','1']])expect(estimateStampPerforation(input[0],input[1]).value).toBeNull();
  expect(estimateStampPerforation('14','20').message).toContain('physical gauge');
 });
 test('time economics reuses shared fee rules and needs explicit inputs',()=>{
  expect(stampSellingEstimate({price:'',cost:'0',postage:'0',packaging:'0',minutes:'10'})).toBeNull();
  const result=stampSellingEstimate({price:'10',cost:'2',postage:'1',packaging:'0.5',minutes:'15'})!;
  expect(result.inputs.specialistId).toBe('stamps');expect(result.isEstimate).toBe(true);expect(result.profitPerHour).toBeCloseTo(result.netProfit*4);expect(result.netProfit).toBeLessThan(6.5);
 });
 test('market comparisons exclude unrelated issue, usage, gum and sale unit',()=>{
  expect(stampComparableIssue('GB Penny Black used postage stamp',{country:'Great Britain',issue_name:'Penny Black',usage:'Used',format:'Single'})).toBeNull();
  expect(stampComparableIssue('GB Penny Red used postage stamp',{issue_name:'Penny Black'})).not.toBeNull();
  expect(stampComparableIssue('Stamp MNH',{usage:'Used'})).not.toBeNull();
  expect(stampComparableIssue('Stamp mounted mint',{usage:'Unused',gum:'MNH'})).not.toBeNull();
  expect(stampComparableIssue('Stamp single used',{format:'Collection lot'})).not.toBeNull();
 });
 test('new stamp records prefer originals but preserve explicit seller selections',()=>{
  const original='https://storage.example/item/originals/front.jpg',processed='https://storage.example/item/studio/front.png';
  const attrs={_stamp_suggestions:{},_smart_studio_images:{front:{version:SMART_STUDIO_VERSION,status:'ready',originalUri:original,enhancedUri:processed,quality:{method:'backgrounderase',provider:'BackgroundErase',checks:{validPng:true,dimensionsUnchanged:true,foregroundPresent:true,transparencyPresent:true}}}}};
  expect(preferredListingPhotos([original],attrs)).toEqual([original]);expect(selectedListingPhotos([original],attrs,[processed])).toEqual([processed]);
 });
 test('deployment assets are byte-identical and artwork exists',()=>{
  for(const file of ['specialistIntelligence.ts','nichePolicy.ts','stampIdentification.ts','stampMarket.ts','ebayImportScope.ts','smartStudio.ts'])expect(read('supabase/functions/_shared/'+file)).toBe(read('shared/'+file));
  expect(fs.existsSync('assets/images/stamp-artwork.png')).toBe(true);
  expect(read('hooks/useSpecialistItemFields.ts')).toContain("initial[descriptor.key]=inferred?''");
 });
});
