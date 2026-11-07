import { parseIdentificationJson } from './identificationPolicy.ts';
export interface FaceObservation {label:string;legends:string[];features:string[];countermarks:Array<{location:string;visibleText:string;shape:string}>;limitations:string[];available:boolean}
export const numismaticPathways=`SPECIALIST ANALYTICAL PATHWAYS (not separate products):
Greek/Hellenistic: portrait or deity, reverse symbols, ethnic legend, magistrates, monograms and weight standard; SNG only when actually supplied/retrieved.
Roman Imperial: obverse titulature/portrait, reverse legend/type, officina and exergue; use retrieved OCRE/ RIC evidence.
Roman Provincial: Greek civic ethnic, imperial portrait, local reverse type and mint/city; RPC is provincial, not a generic Greek catalogue.
Byzantine: regnal numerals, denomination marks, emperor/cross/Christ types, mint and officina; distinguish overstrikes.
Islamic/medieval: literal visible script and formula layout, legible ruler/date/mint fragments; distinguish AH from AD. Stephen Album references require an actually available licensed or user-supplied reference, not memory.
Countermarked/unusual: identify host independently, then each punch independently with location, visible characters, possible authority, confidence and uncertainties. Host date/issuer and later countermark date/authority are distinct. Do not complete worn inscriptions. An uncertain countermark does not invalidate a supported host; disclose it and any valuation uncertainty.
WildWinds is supplementary only; CoinArchives is auction evidence, not definitive identity. Do not claim a source was consulted unless retrieved evidence is supplied. No scraping/licence bypass.
Return numismaticReview {pathway,hostSupporting,hostContradictions,missingHostInformation,obverseMatched,reverseMatched,diagnosticMatches:[{kind:'legend|portrait|reverse_device|mintmark|measurement|reference',observation,referenceEvidence}],countermarks:[{location,visibleText,shape,attribution,dateRange,confidence,uncertainty}],surfaceAssessment:{strike,centring,surfaces,patina,damage,provenance},alternatives}. All assertions are model assessments of actual supplied evidence, not calibrated probabilities. Catalogue details are transient reference data, not owned-coin inscriptions.`;
export async function observeCoinFaces(images:string[],labels:string[],apiKey:string,baseUrl:string):Promise<FaceObservation[]> {
 return Promise.all(images.slice(0,2).map(async(url,index)=>{
 const label=labels[index]||`Face ${index+1}`;
 const empty:FaceObservation={label,legends:[],features:[],countermarks:[],limitations:['Independent face analysis unavailable; specialist review required.'],available:false};
 try{const response=await fetch(`${baseUrl}/chat/completions`,{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:'google/gemini-3-flash-preview',temperature:0.05,max_tokens:650,messages:[{role:'system',content:'Observe this one coin face independently. Do not identify a ruler, dynasty, date, denomination or reference yet. Transcribe only legible characters, using ? for gaps; do not complete legends. List literal diagnostic features and each countermark separately. Colour does not prove metal. Labels are user intent, not proof of the face.'},{role:'user',content:[{type:'text',text:`View: ${label}. Return JSON {legends:[],features:[],countermarks:[{location,visibleText,shape}],limitations:[]}.`},{type:'image_url',image_url:{url:url.startsWith('http')||url.startsWith('data:')?url:`data:image/jpeg;base64,${url}`}}]}]}),signal:AbortSignal.timeout(20000)});
 if(!response.ok)return empty;const data=await response.json();if(data.choices?.[0]?.finish_reason==='length')return empty;const parsed=parseIdentificationJson(data.choices?.[0]?.message?.content);
 const texts=(value:unknown)=>Array.isArray(value)?value.filter((entry):entry is string=>typeof entry==='string').slice(0,10):[];
 return {label,legends:texts(parsed.legends),features:texts(parsed.features),countermarks:Array.isArray(parsed.countermarks)?parsed.countermarks.slice(0,6):[],limitations:texts(parsed.limitations),available:true};}catch{return empty;}
 }));
}
/** Evidence ceilings, never an average or agreement-based uplift. Existing 95% publish gate is unchanged. */
export function constrainNumismaticEvidence(result:any,faces:FaceObservation[],catalogue:any){
 const review=result.numismaticReview??{};
 const matches=Array.isArray(review.diagnosticMatches)?review.diagnosticMatches.filter((entry:any)=>entry&&typeof entry.observation==='string'&&entry.observation.trim()&&typeof entry.referenceEvidence==='string'&&entry.referenceEvidence.trim()):[];
 const kinds=new Set(matches.map((entry:any)=>entry.kind));
 const hostContradictions=Array.isArray(review.hostContradictions)?review.hostContradictions:[];
 const alternatives=(catalogue?.alternatives??[]).filter((row:any)=>row.typeId!==catalogue?.typeId);
 const gap=alternatives.length?Number(catalogue?.matchScore??0)-Math.max(...alternatives.map((row:any)=>Number(row.score??0))):Infinity;
 let ceiling=0.69;const reasons:string[]=[];
 if(faces.length===2&&faces.every(face=>face.available)&&review.obverseMatched===true&&review.reverseMatched===true&&['verified','strong_match'].includes(catalogue?.status)&&catalogue.physicalMatchGood===true&&kinds.size>=4&&gap>=15&&hostContradictions.length===0)ceiling=0.98;
 else reasons.push('Both faces, four diagnostic evidence classes and a distinct catalogue winner are needed for high confidence.');
 if(hostContradictions.length||catalogue?.physicalMatchGood===false&&catalogue?.status!=='unavailable'){ceiling=Math.min(ceiling,0.49);reasons.push('Host attribution has unresolved visual or physical contradictions.');}
 if(gap<15){ceiling=Math.min(ceiling,0.69);reasons.push('Competing catalogue candidates remain close; obtain the discriminating legend or measurement.');}
 result.confidence=Math.min(Number(result.confidence??0),ceiling);result.confidenceTier=result.confidence>=0.85?'very_high':result.confidence>=0.7?'high':result.confidence>=0.5?'medium':'low';
 result.identificationState=result.confidence>=0.95?'verified':'candidate';result.attributes={...result.attributes,identification_state:result.identificationState,_numismatic_review:{...review,confidenceBasis:'diagnostic evidence ceilings; not calibrated accuracy',confidenceCeiling:ceiling}};
 result.warnings=[...new Set([...(result.warnings??[]),...reasons])];result.faceObservations=faces;
 // Uncertain countermark details stay outside host confidence penalties; preserve disclosure.
 for(const mark of review.countermarks??[])if(mark.uncertainty)result.warnings.push(`Countermark at ${mark.location??'unspecified location'}: ${mark.uncertainty}`);
 return result;
}
