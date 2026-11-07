// Evidence-backed defaults shared by capture, saved stock and the listing editor.
import type { AIIdentificationResult } from './aiIdentificationService';
import type { Item } from './itemService';
import type { GeneratedListing } from './listingService';
import type { AntiqueAspect, AntiqueConditionPolicy } from '@/shared/antiqueListingPolicy';
import { seedAntiqueSpecifics, validateAntiqueSpecifics } from '@/shared/antiqueListingPolicy';
import { getSpecialistProfile, mappedSpecialistSpecifics } from '@/shared/specialistIntelligence';
import type { MarketValueResult } from './marketValueService';
const key = (value:string) => value.toLowerCase().replace(/[^a-z0-9]/g,'');
const text = (value:unknown) => (typeof value==='string'||typeof value==='number') && !/^(unknown|not established|not supplied|not visible|n\/a)$/i.test(String(value).trim()) ? String(value).trim() : '';
export function marketValueAmount(result:MarketValueResult|null|undefined,storedMid=0):number|null {
 const value=Number(result?.valuation?.valuationMid ?? storedMid);
 return Number.isFinite(value)&&value>0 ? value : null;
}
export function automaticListingPrice(result:MarketValueResult|null|undefined):number {
 const value=Number(result?.valuation?.recommendedListingPrice);
 return Number.isFinite(value)&&value>0 ? Math.round(value*100)/100 : marketValueAmount(result) ?? 0;
}
export function automaticCondition(policy:AntiqueConditionPolicy,condition:string,generatedId=''):string {
 const choices=policy.itemConditions;
 if(!choices.length)return '';
 const raw=condition.trim().toLowerCase();
 if(!raw||/cannot|unknown|not assessed|not established|unconfirmed/.test(raw))return '';
 const exact=choices.find(row=>row.conditionDescription.trim().toLowerCase()===raw);if(exact)return String(exact.conditionId);
 const desired=/for parts|not working|non.running|project/.test(raw)?'7000':/new other|open.box|unused.*open/.test(raw)?'1500':/refurbished/.test(raw)?'2500':/like new|near mint/.test(raw)?'2750':/very good/.test(raw)?'4000':/acceptable|poor/.test(raw)?'6000':/\bgood\b/.test(raw)?'5000':/\bnew\b|sealed/.test(raw)?'1000':/used|fair|excellent|worn/.test(raw)?'3000':'';
 const matching=choices.find(row=>String(row.conditionId)===desired);if(matching)return String(matching.conditionId);
 // Category-specific generated condition is a proposal, not certification; never turn used stock into new.
 const candidate=choices.find(row=>String(row.conditionId)===String(generatedId));
 if(candidate&&!(String(candidate.conditionId)==='1000'&&!/\bnew\b|sealed/.test(raw)))return String(candidate.conditionId);
 const used=choices.find(row=>String(row.conditionId)==='3000');
 return used&&!/\bnew\b|sealed/.test(raw)?String(used.conditionId):'';
}
export function automaticSpecifics(nicheId:string,result:AIIdentificationResult,generated:GeneratedListing,aspects:AntiqueAspect[]) {
 const known:Record<string,unknown>={...result.attributesConfirmed};
 for(const [name,entry] of Object.entries(result.specialistAnalysis?.fields??{}))if(entry.basis!=='inferred')known[name]=entry.value;
 for(const name of Object.keys(known))if(result.attributesInferred?.[name]!=null||result.attributes[`_inferred_${name}`]!=null||result.specialistAnalysis?.fields?.[name]?.basis==='inferred')delete known[name];
 const profile=getSpecialistProfile(nicheId);if(profile)Object.assign(known,mappedSpecialistSpecifics(profile,known));
 const seeded=seedAntiqueSpecifics([],aspects,known);
 for(const aspect of aspects){
  const row=seeded.find(value=>key(value.name)===key(aspect.name));if(row?.value)continue;
  const match=Object.entries(known).find(([name,value])=>key(name)===key(aspect.name)&&text(value));
  // Generated specifics are accepted only when corroborated by the retained evidence.
  const copy=Object.entries(generated.item_specifics??{}).find(([name])=>key(name)===key(aspect.name));
  const value=text(match?.[1])||(copy&&Object.values(known).some(knownValue=>key(text(knownValue))===key(text(copy[1])))?text(copy[1]):'');
  if(value&&!validateAntiqueSpecifics([{name:aspect.name,value}],[{...aspect,required:false}])){if(row)row.value=value;else seeded.push({name:aspect.name,value});}
 }
 // Required fields first; unsupported or genuinely unknown facts remain empty.
 return seeded.sort((a,b)=>Number(aspects.find(row=>row.name===b.name)?.required)-Number(aspects.find(row=>row.name===a.name)?.required)).slice(0,25);
}
export function inventoryIdentification(item:Item):AIIdentificationResult {
 const attributes={...item.attributes};const evidence=attributes._identification_evidence??{};
 const confirmed:Record<string,unknown>={};
 for(const [name,value] of Object.entries(attributes))if(!name.startsWith('_')&&!/^(ebay|numista|inferred|niche|identification|valuation)/i.test(name)&&text(value)&&attributes[`_inferred_${name}`]==null&&attributes._specialist_analysis?.fields?.[name]?.basis!=='inferred')confirmed[name]=value;
 const fields={manufacturer:item.manufacturer,material:item.material,year_made:item.yearMade,country_of_origin:item.countryOfOrigin,ruler:item.ruler,mint:item.mint,denomination:item.denomination,period:item.period,catalogue_number:item.catalogueNumber,weight_g:item.weightGrams,diameter_mm:item.diameterMm};
 for(const [name,value] of Object.entries(fields))if(text(value)&&attributes[`_inferred_${name}`]==null&&attributes._specialist_analysis?.fields?.[name]?.basis!=='inferred')confirmed[name]=value;
 return {canonicalTitle:item.canonicalTitle,specialistId:item.specialistId,confidence:item.identificationConfidence,confidenceTier:item.valuationConfidence,identificationSource:item.identificationSource,identificationState:attributes.identification_state,condition:item.condition,conditionGrade:item.conditionGrade,conditionNotes:item.conditionNotes,valuationLow:item.valuationLow,valuationMid:item.valuationMid,valuationHigh:item.valuationHigh,valuationConfidence:item.valuationConfidence,saleProb30d:item.saleProb30d,evidenceSupporting:evidence.supporting??[],evidenceContradictory:evidence.contradictory??[],missingInformation:evidence.missing??[],attributesConfirmed:confirmed,attributesInferred:{},attributes,specialistAnalysis:attributes._specialist_analysis,warnings:item.warnings,suggestedDisposition:'',dispositionDecision:item.dispositionDecision,numistaTypeId:attributes.numista_type_id,numistaMatchScore:attributes.numista_match_score,numistaMatchTier:attributes.numista_match_tier};
}
