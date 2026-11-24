import { coinPacketKeys, normalizeCoinPacket, coinPacketFingerprint, type CoinPacket } from '@/shared/coinPacket';
import type { AIIdentificationResult } from './aiIdentificationService';
export function packetForResult(result:AIIdentificationResult|null|undefined):CoinPacket|null{return normalizeCoinPacket(result?.attributes?._coin_packet);}
export function packetReviewValues(packet:CoinPacket,answers:Record<string,string>):Record<string,string>{return Object.fromEntries(coinPacketKeys.map(key=>[key,answers[`_packet_edit_${key}`]??packet.fields[key]?.value??'']));}
export function packetReviewIssue(result:AIIdentificationResult):string|null {
 const packet=packetForResult(result);if(!packet)return null;
 const review=result.attributes._coin_packet_review;
 return review?.fingerprint===coinPacketFingerprint(packet)&&review?.confirmed===true?null:'Review the information read from your coin packet before listing. Unreadable details can stay blank; no extra photo is required.';
}
export function reviewCoinPacket(result:AIIdentificationResult,answers:Record<string,string>):AIIdentificationResult {
 const packet=packetForResult(result);if(!packet)return result;
 const values=Object.fromEntries(Object.entries(packetReviewValues(packet,answers)).map(([key,value])=>[key,value.trim().slice(0,240)])),attributes={...result.attributes},confirmed={...result.attributesConfirmed},inferred={...result.attributesInferred};
 const analysis=result.specialistAnalysis?{...result.specialistAnalysis,fields:{...result.specialistAnalysis.fields}}:undefined;
 for(const key of coinPacketKeys){const value=values[key].trim();
  if((key==='weight_g'||key==='diameter_mm')&&value&&(!Number.isFinite(Number(value.replace(',','.')))||Number(value.replace(',','.'))<=0))throw new Error('Packet weight and diameter must be positive numbers, or left blank.');
  // Existing independently supplied values are not overwritten by ticket OCR.
  if(key==='attribution')continue;
  const measured=result.attributes[`supplied_${key}`];
  if((key==='weight_g'||key==='diameter_mm')&&measured!=null&&Number(measured)>0){attributes[key]=String(measured);confirmed[key]=String(measured);delete attributes[`_packet_${key}`];continue;}
  if(value){const scalar=key==='weight_g'||key==='diameter_mm'?String(Number(value.replace(',','.'))):value;attributes[key]=scalar;confirmed[key]=scalar;delete inferred[key];delete attributes[`_inferred_${key}`];attributes[`_packet_${key}`]=true;
   if(analysis)analysis.fields[key]={value:String(attributes[key]),basis:'user_supplied',reason:'Seller reviewed the photographed packet inscription. Attribution and measurements are packet-recorded, not independently verified.'};
  }else if(attributes[`_packet_${key}`]){delete attributes[key];delete confirmed[key];delete inferred[key];if(analysis)delete analysis.fields[key];}
 }
 attributes._coin_packet_review={fingerprint:coinPacketFingerprint(packet),confirmed:true,values,source:'seller_reviewed_packet'};
 return {...result,attributes,attributesConfirmed:confirmed,attributesInferred:inferred,...(analysis?{specialistAnalysis:analysis}:{})};
}
const escape=(value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
export const packetFieldLabels:Record<string,string>={attribution:'Packet attribution',ruler:'Issuer / ruler',denomination:'Denomination',mint:'Mint',year:'Date / period',catalogue_number:'Catalogue reference',weight_g:'Packet-recorded weight (g)',diameter_mm:'Packet-recorded diameter (mm)'};
export function packetListingDisclosure(result:AIIdentificationResult):string {
 const packet=packetForResult(result);if(!packet)return '';
 const reviewed=result.attributes._coin_packet_review,values=reviewed?.fingerprint===coinPacketFingerprint(packet)?reviewed.values:packetReviewValues(packet,{});
 const rows=coinPacketKeys.filter(key=>values?.[key]?.trim()&&(reviewed?.confirmed===true||!packet.fields[key]?.uncertain));
 if(!rows.length)return '';
 return `<div><h3>Coin packet information</h3><p>${rows.map(key=>`${escape(packetFieldLabels[key])}: ${escape(String(values[key]))}`).join('<br />')}</p><p>Information transcribed from the accompanying coin packet. Attribution and catalogue reference are seller-document claims, not independent authentication. Weight and diameter are packet-recorded, not newly measured.</p></div>`;
}
