// Quick List contracts: observations are not independent accuracy measurements.
import type { RegisteredNicheId } from './moduleContracts';
import type { BarcodeMetadata } from './barcodeIdentification';
export type QuickListNiche = RegisteredNicheId;
// Preserve legacy stages; TD is draft completion, T5 is saved review, TP is the provider response.
export type QuickStage = 'T0'|'T1'|'T2'|'T3'|'T4'|'TD'|'T5'|'T6'|'TP'|'T7';
export interface QuickFailure { operation:string; at:number; elapsedMs:number; message:string }
export type AttributeSource = 'barcode_catalogue'|'ai_barcode_research'|'photograph'|'specialist_identification'|'external_catalogue'|'user_confirmation';
export interface QuickAttributeEvidence { key:string; value:string; sources:AttributeSource[]; accepted:boolean; note:string }
export interface ProductLead extends BarcodeMetadata { id:string; title:string; gtin:string; brand:string; model:string; categoryId:string; categoryName:string; specifics:Record<string,string>; source:'eBay Browse'|'OnSpace AI'|'Discogs'; url:string; sourceUrls?:string[]; summary?:string; confidence?:number }
export interface QuickTiming { id:string; nicheId:QuickListNiche; timestamps:Partial<Record<QuickStage,number>>; actions:number; barcodeAttempted:boolean; barcodeMatched:boolean; aiAttempted:boolean; aiMatched:boolean; publicationAttempted:boolean; outcome:'running'|'live'|'failed'|'unconfirmed'|'abandoned'; eligible:boolean; reasons:string[]; operations:Record<string,number>; externalListingId?:string; platform:string; manualInterventions?:number; failures?:QuickFailure[]; endedAt?:number; clock?:'expo_js_launch_or_foreground' }
export const quickBarcodeTypes = ['ean13','ean8','upc_a','upc_e','code128','code39','itf14','qr'] as const;
function checksum(code:string):boolean { const digits=code.split('').map(Number);const check=digits.pop();return (10-digits.reverse().reduce((sum,digit,index)=>sum+digit*(index%2===0?3:1),0)%10)%10===check; }
/** QR payloads are data only. Never fetch an arbitrary scanned URL. */
export function normalizeProductBarcode(value:string,type=''):string|null {
 let code=value.trim();
 if(type==='qr' || /^https?:/i.test(code)) { code=code.match(/(?:\/01\/|\(01\))(\d{14})(?:\D|$)/)?.[1] ?? ''; }
 code=code.replace(/[\s-]/g,'');
 if(type==='upc_e' && /^\d{8}$/.test(code)) {
  const [system,a,b,c,d,e,last,check]=code;
  if(!['0','1'].includes(system!))return null;
  code=system+(['0','1','2'].includes(last!)?a!+b!+last!+'0000'+c!+d!+e!:last==='3'?a!+b!+c!+'00000'+d!+e!:last==='4'?a!+b!+c!+d!+'00000'+e!:a!+b!+c!+d!+e!+'0000'+last!)+check;
 }
 if(/^\d{9}[\dX]$/i.test(code)) { if(code.split('').reduce((sum,digit,index)=>sum+(digit.toUpperCase()==='X'?10:Number(digit))*(10-index),0)%11!==0)return null;const base='978'+code.slice(0,9);code=base+String((10-base.split('').reduce((sum,digit,index)=>sum+Number(digit)*(index%2?3:1),0)%10)%10); }
 return /^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)&&checksum(code)?code:null;
}
export function sameGtin(left:string,right:string):boolean {return !!left&&!!right&&left.padStart(14,'0')===right.padStart(14,'0');}
const percentile=(values:number[],p:number):number|null=>values.length?values[Math.max(0,Math.ceil(values.length*p)-1)]!:null;
export function quickListMetrics(sessions:QuickTiming[]) {
 const live=sessions.filter(row=>row.outcome==='live'&&row.timestamps.T0!=null&&row.timestamps.T7!=null&&row.timestamps.T7>=row.timestamps.T0&&/^\d+$/.test(row.externalListingId??''));
 const times=live.map(row=>row.timestamps.T7!-row.timestamps.T0!).sort((a,b)=>a-b);
 // Keep app/foreground legacy metrics intact; scanner KPI never substitutes an old T0.
 const scannerLive=live.filter(row=>row.timestamps.T1!=null&&Number.isFinite(row.timestamps.T1)&&row.timestamps.T7!>=row.timestamps.T1!);
 const scannerTimes=scannerLive.map(row=>row.timestamps.T7!-row.timestamps.T1!).sort((a,b)=>a-b);
 const scannerToLive={samples:scannerTimes.length,medianMs:scannerTimes.length?scannerTimes.length%2?scannerTimes[Math.floor(scannerTimes.length/2)]!:(scannerTimes[scannerTimes.length/2-1]!+scannerTimes[scannerTimes.length/2]!)/2:null,p90Ms:percentile(scannerTimes,0.9),under60Count:scannerTimes.filter(ms=>ms<60000).length,under60Pct:scannerTimes.length?Math.round(scannerTimes.filter(ms=>ms<60000).length/scannerTimes.length*10000)/100:null,measurement:'T1 scanner opened to T7 reconciled live on eBay; includes capture, user review, retries and provider latency'};
 const median=times.length?times.length%2?times[Math.floor(times.length/2)]!:(times[times.length/2-1]!+times[times.length/2]!)/2:null;
 const ratio=(a:number,b:number)=>b?Math.round(a/b*10000)/100:null;
 const duration=(row:QuickTiming,from:QuickStage,to:QuickStage)=>{const a=row.timestamps[from],b=row.timestamps[to];return a!=null&&b!=null&&Number.isFinite(a)&&Number.isFinite(b)&&b>=a?b-a:null;};
 const stagePairs:Array<[string,QuickStage,QuickStage]>=[['openToCapture','T0','T2'],['identification','T2','T3'],['valuationAfterIdentity','T3','T4'],['draftAfterIdentity','T3','TD'],['review','TD','T5'],['publication','T6','T7']];
 const stageTimes=Object.fromEntries(stagePairs.map(([name,from,to])=>{const values=sessions.map(row=>duration(row,from,to)).filter((value):value is number=>value!==null).sort((a,b)=>a-b);return [name,{samples:values.length,medianMs:values.length?values.length%2?values[Math.floor(values.length/2)]!:(values[values.length/2-1]!+values[values.length/2]!)/2:null,p90Ms:percentile(values,0.9)}];}));
 const eligible=sessions.filter(row=>row.eligible),barcodes=sessions.filter(row=>row.barcodeAttempted),ai=sessions.filter(row=>row.aiAttempted),submitted=sessions.filter(row=>row.publicationAttempted);
 return {scannerToLive,sampleCount:sessions.length,confirmedLiveCount:live.length,medianMs:median,p90Ms:percentile(times,0.9),successfulWithin60Pct:ratio(times.filter(ms=>ms<=60000).length,live.length),eligibleWithin60Pct:ratio(live.filter(row=>row.eligible&&row.timestamps.T7!-row.timestamps.T0!<=60000).length,eligible.length),barcodeMatchPct:ratio(barcodes.filter(row=>row.barcodeMatched).length,barcodes.length),aiMatchPct:ratio(ai.filter(row=>row.aiMatched).length,ai.length),failedPublicationPct:ratio(submitted.filter(row=>row.outcome==='failed').length,submitted.length),unconfirmedPublications:submitted.filter(row=>row.outcome==='unconfirmed').length,averageActions:sessions.length?sessions.reduce((sum,row)=>sum+row.actions,0)/sessions.length:null,stageTimes,failedOperations:sessions.flatMap(row=>row.failures??[]),manualInterventions:sessions.reduce((sum,row)=>sum+(row.manualInterventions??0),0),abandonedSessions:sessions.filter(row=>row.outcome==='abandoned').length,over60Reasons:sessions.filter(row=>row.timestamps.T0!=null&&(row.timestamps.T7??row.endedAt??Date.now())-row.timestamps.T0!>60000).map(row=>({id:row.id,reasons:row.reasons,operations:row.operations})),note:'No draft or acknowledgement-only outcome is counted as live. Match rates describe workflow outcomes, not independently verified identification accuracy.'};
}
