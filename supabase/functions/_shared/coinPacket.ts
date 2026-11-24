// Shared packet OCR contract. Printed/handwritten claims are not independent attribution or measurements.
export const coinPacketKeys = ['attribution','ruler','denomination','mint','year','catalogue_number','weight_g','diameter_mm'] as const;
export type CoinPacketKey = typeof coinPacketKeys[number];
export interface CoinPacketField { value:string; quote:string; uncertain:boolean }
export interface CoinPacket { transcript:string; fields:Partial<Record<CoinPacketKey,CoinPacketField>>; limitations:string[]; source:'coin_packet_photo' }
const text=(v:unknown,max=240)=>typeof v==='string'?v.trim().slice(0,max):'';
const folded=(v:string)=>v.toLowerCase().replace(/\s+/g,' ').trim();
export const coinPacketInstructions = `COIN PACKET OCR: A packet/holder/ticket is documentation for the SAME coin, not another object or coin face. Read printed AND handwritten text exactly; preserve uncertain letters as ? and do not expand abbreviations into an invented ruler, denomination or catalogue reference. Add coinPacket as a top-level member of the existing identification JSON even when its schema example omits it: {transcript:literal text,fields:{attribution|ruler|denomination|mint|year|catalogue_number|weight_g|diameter_mm:{value:string,quote:exact substring from transcript,uncertain:boolean}},limitations:[unreadable or conflicting text]}. Omit unreadable fields. Text field values must be literal substrings of their quote. A catalogue reference needs its readable catalogue prefix and number; do not invent a number from handwriting or a location code. Weight and diameter require explicit g/gram and mm units; return numeric strings in those fields. A packet-recorded measurement is NOT a fresh seller measurement or catalogue standard. A packet attribution is a seller-document claim: compare both coin faces against it, retain genuine contradictions and do not certify authenticity. Do not confuse a price or storage code with a weight, year or reference. Extract all supported packet fields for editable prefill; missing mint/date/reference may remain blank. Three usable views (obverse, reverse, packet) can produce a draft; do not demand edge, legend or ruler photographs as extra mandatory steps unless evidence is genuinely unusable. Never use packet text as the coin's visible legend.`;
/** Reject mismatched units, invented expansions and quotes absent from the transcription. */
export function normalizeCoinPacket(raw:unknown):CoinPacket|null {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
 const r=raw as Record<string,unknown>,transcript=text(r.transcript,2000);
 if(!transcript)return null;
 const input=r.fields&&typeof r.fields==='object'&&!Array.isArray(r.fields)?r.fields as Record<string,unknown>:{},fields:CoinPacket['fields']={};
 for(const key of coinPacketKeys){
  const entry=input[key];if(!entry||typeof entry!=='object'||Array.isArray(entry))continue;
  const row=entry as Record<string,unknown>,value=text(row.value),quote=text(row.quote);
  if(!value||!quote||!folded(transcript).includes(folded(quote))||/^(unknown|not established|not legible|n\/a)$/i.test(value))continue;
  const uncertain=row.uncertain===true||quote.includes('?')||value.includes('?');
  if(key==='weight_g'||key==='diameter_mm'){
   const unit=key==='weight_g'?/(\d+(?:[.,]\d+)?)\s*(?:g\b|grams?\b)/i:/(\d+(?:[.,]\d+)?)\s*mm\b/i;
   const match=quote.match(unit),amount=Number(value.replace(',','.'));
   if(!match||!Number.isFinite(amount)||amount<=0||Number(match[1].replace(',','.'))!==amount)continue;
   fields[key]={value:String(amount),quote,uncertain};
  }else {
   if(!folded(quote).includes(folded(value)))continue;
   fields[key]={value,quote,uncertain};
  }
 }
 const limitations=Array.isArray(r.limitations)?r.limitations.filter((v):v is string=>typeof v==='string').map(v=>text(v)).filter(Boolean).slice(0,8):[];
 return {transcript,fields,limitations,source:'coin_packet_photo'};
}
export function coinPacketFingerprint(packet:CoinPacket):string {
 let value=2166136261;const canonical=JSON.stringify([packet.transcript,...coinPacketKeys.map(key=>[key,packet.fields[key]??null]),packet.limitations]);
 for(let i=0;i<canonical.length;i++)value=Math.imul(value^canonical.charCodeAt(i),16777619);
 return `coin-packet-v1:${(value>>>0).toString(16)}`;
}
/** Preserve physical conflicts and separately measured values; OCR stays a proposal. */
export function applyCoinPacketEvidence(result:Record<string,any>,packet:CoinPacket|null):Record<string,any> {
 if(!packet)return result;
 const attributes:Record<string,any>={...(result.attributes??{}),_coin_packet:packet},confirmed:Record<string,any>={...(result.attributesConfirmed??{})};
 const fields={...(result.specialistAnalysis?.fields??{})};
 for(const key of coinPacketKeys){
  const row=packet.fields[key];if(!row||row.uncertain||key==='attribution')continue;
  if((key==='weight_g'||key==='diameter_mm')&&Number(attributes[`supplied_${key}`])>0)continue;
  if(!attributes[key]||folded(String(attributes[key]))===folded(row.value)){
   attributes[key]=row.value;attributes[`_packet_${key}`]=true;delete confirmed[key];
   fields[key]={value:row.value,basis:'inferred',reason:`Coin packet inscription: ${row.quote}. Seller review required; not independent verification.`};
  }
 }
 return {...result,attributes,attributesConfirmed:confirmed,...(result.specialistAnalysis?{specialistAnalysis:{...result.specialistAnalysis,fields}}:{})};
}
