// Pure Listing Studio contract shared by the app and the Edge Function.
// No React, Deno, network, keys or database dependencies.
import { normalizeCoinPacket, type CoinPacket } from './coinPacket.ts';
export const studioVersion='listing-studio-v2';
export interface StudioRole {id:string;label:string;why:string;critical?:boolean}
export interface StudioPhotoEvidence {slotId:string;role:string;observations:string[];condition:string[];limitations:string[];usable:boolean}
export interface StudioEvidence {signature:string;candidate:string;objectType:string;recommendedNiche:string|null;confidence:number|null;photos:StudioPhotoEvidence[];missing:string[];conflicts:string[];nextRole:string;guidance:string;ready:boolean;answer:string;coinPacket?:CoinPacket|null}
export interface StudioState {version:string;niche:string;evidence:StudioEvidence|null;history:StudioEvidence[];notes:string;question:string;analysisError:string;guidanceMinimized:boolean;guidanceHidden:boolean}
interface StudioProfile {recognition:string;fields:Array<{key:string}>;conditionRules:string;listingRules:string;valuationRules:string}
export function emptyStudio(niche:string):StudioState{return {version:studioVersion,niche,evidence:null,history:[],notes:'',question:'',analysisError:'',guidanceMinimized:false,guidanceHidden:false};}
const role=(id:string,label:string,why:string,critical=false):StudioRole=>({id,label,why,critical});
const main=role('main','Whole item','Point your camera at your item.');
const back=role('back','Reverse / base','Show the other side to reveal identifying details.');
const mark=role('marks','Identifying marks','Move closer to the mark so its lettering can be read.');
const flaws=role('condition','Visible flaws','Show wear or damage so the description stays accurate.');
const roles:Record<string,StudioRole[]>={
 coins:[role('obverse','Obverse','Photograph one complete face, including the visible legend.',true),role('reverse','Reverse','Turn the coin over so I can compare the reverse.',true),role('packet','Coin packet / information','Photograph the whole packet label to read weight, diameter and attribution; then tap Done.'),role('legend','Legend / mint mark','Show an unclear legend or mint mark for a more precise attribution.'),role('edge','Edge','Show the edge only if its lettering or construction matters.'),flaws],
 tunes_flip:[role('front_sleeve','Front cover','Show the artist and title on the sleeve or packaging.'),role('label_a','Record / disc label','Photograph the label to help identify the exact release.'),role('back_sleeve','Rear cover','Show the catalogue number and rear packaging.'),role('label_b','Other label','Show the other label if it distinguishes this version.'),role('barcode_detail','Barcode / catalogue number','Show the printed identifier so Discogs can compare releases.'),role('matrix','Matrix / runout','Show the runout only if the pressing is still uncertain.'),role('matrix_b','Other runout','Show the other matrix only if it resolves a competing version.'),role('contents','Included contents','Show the sleeve, discs and inserts actually included.'),flaws],
 tech:[main,role('model_label','Model label / barcode','Show the model label so I can confirm the exact version.',true),role('accessories','Accessories','Show the accessories that will be included.'),flaws],
 beauty:[role('main','Front packaging','Show the product name and variant on the packaging.'),role('barcode','Barcode / size','Show the barcode and printed size to identify the variant.',true),role('batch','Batch / expiry','Show expiry or batch details where materially relevant.'),role('seal','Packaging / seal','Show the seal; packaging alone cannot establish safety.'),flaws],
 clothing:[role('front','Front','Show the whole garment or pair of shoes.'),role('label','Brand / size label','Show the brand and size label so I can read them exactly.',true),back,role('care_label','Materials label','Show the care label to establish fibre composition.'),role('soles','Soles','For footwear, show the soles and wear.'),flaws],
 bicycles:[main,role('model_label','Frame / component label','Show the make, model or component marking.'),role('components','Components','Show identifying component details, not unrelated angles.'),back,flaws],
 motocross:[main,role('part_number','Make / model / part number','Show the identifying plate or part marking.'),role('components','Components / mounts','Show components or mounting points relevant to this item.'),back,flaws],
 antiques:[main,back,mark,role('scale','Size reference','Include a ruler to document size without guessing.'),flaws],
 collectibles:[main,role('label','Product / edition label','Show the full tag or edition label to identify the version.'),back,mark,flaws],
 fossils:[main,role('other_angle','Other angle','Show another angle to reveal distinguishing anatomy.'),role('scale','Size reference','Include a ruler to establish the actual size.'),role('features','Distinguishing features','Show the feature that separates plausible specimen groups.'),flaws],
 trading_cards:[role('front','Card front','Show the whole face, including all borders and the card number.',true),role('back','Card reverse','Turn the card over to document the reverse and wear.',true),role('number','Set / number','Show the printed set and number if unclear.'),role('corners','Corners / surface','Show relevant corner or surface defects without glare.'),flaws],
 stamps:[role('front','Full stamp / cover','Show all edges; keep covers, blocks and pages intact.'),role('back','Accessible reverse','Show the reverse only if loose; never detach the stamp.'),mark,flaws],
 surplus_flip:[main,role('label','SKU / barcode / model','Show the identifier to distinguish the actual product from a manifest claim.'),role('contents','Actual contents','Show included parts; packaging does not prove completeness.'),flaws],
 auto:[main,role('label','Identifying label','Show a label or mark to narrow down the item.'),back,flaws],
};
const bookRoles=[role('main','Front cover','Show the title and binding.'),role('title_page','Title page','Show the title page to establish the title, volume and author.'),role('copyright','Copyright / edition','Show the imprint or number line to check the edition.'),role('back','Back cover','Show the rear cover and any ISBN.'),flaws];
export function studioConfiguration(niche:string,objectType='',profile?:StudioProfile|null){
 const book=/\bbooks?\b/i.test(objectType),shoe=/shoe|trainer|sneaker|footwear/i.test(objectType);
 const sequence=(book&&['antiques','collectibles','surplus_flip','auto'].includes(niche)?bookRoles:roles[niche]??roles.auto).filter(r=>r.id!=='soles'||shoe);
 return {niche,roles:sequence,instructions:profile?.recognition??'Classify the actual object before recommending a registered specialist. Workspace choice is not proof of identity.',ocrTargets:profile?.fields.map(f=>f.key)??['brand','model','label','mark'],conditionQuestions:profile?.conditionRules??'Describe visible flaws; functional testing and authenticity require independent evidence.',listingRequirements:profile?.listingRules??'Leave unsupported specifics blank.',valuationStrategy:profile?.valuationRules??'Use real matching sold evidence; never invent prices.',tools:niche==='coins'?['Numista','Ask SWISH']:niche==='tunes_flip'?['Discogs','Barcode','Ask SWISH']:['tech','beauty','surplus_flip','collectibles'].includes(niche)?['Barcode','Ask SWISH']:['Ask SWISH'],sufficientEvidence:'Usable overview plus supported identity and relevant variant/condition evidence. Missing facts stay unknown; Done is always available after one photo.'};
}
// Local revision fingerprint, NOT an inventory or cryptographic ownership ID.
// Never persist image/base64 bytes in an evidence signature or send them as prior text.
export function studioSignature(images:readonly {slotId:string;uri:string}[],niche:string,notes='',question=''):string{
 const parts=[niche,notes,question,...images.flatMap(p=>[p.slotId,p.uri])];let a=2166136261,b=5381,length=0;
 for(const part of parts){length+=part.length;for(let i=0;i<part.length;i++){a=Math.imul(a^part.charCodeAt(i),16777619);b=Math.imul(b,33)^part.charCodeAt(i);}a=Math.imul(a^31,16777619);}
 return `${studioVersion}:${images.length}:${length}:${(a>>>0).toString(16)}:${(b>>>0).toString(16)}`;
}
export function nextStudioRole(niche:string,images:readonly {slotId:string}[],evidence:StudioEvidence|null):StudioRole{
 const configuration=studioConfiguration(niche,evidence?.objectType??''),fulfilled=new Set(images.map(p=>p.slotId));
 for(const p of evidence?.photos??[])if(p.usable)fulfilled.add(p.role);
 const retake=evidence?.photos.find(p=>!p.usable&&images.some(image=>image.slotId===p.slotId)&&(p.role===evidence.nextRole||p.slotId===evidence.nextRole));
 if(retake){const requested=configuration.roles.find(r=>r.id===retake.role||r.id===retake.slotId);if(requested)return {...requested,id:retake.slotId,label:`Retake ${requested.label}`,why:retake.limitations[0]||'Retake this view so the obscured detail can be read.'};}
 // Coins default to three views. Adaptive detail requests cannot crowd out the packet.
 if(niche==='coins'){
  const next=['obverse','reverse','packet'].find(id=>!fulfilled.has(id));
  if(next)return configuration.roles.find(r=>r.id===next)!;
  return role(`detail_${images.length+1}`,'Optional extra detail','Three views captured. Tap Done to build an editable listing, or add an optional close-up.');
 }
 const requested=configuration.roles.find(r=>r.id===evidence?.nextRole&&!fulfilled.has(r.id));
 return requested??configuration.roles.find(r=>!fulfilled.has(r.id))??role(`detail_${images.length+1}`,'Additional detail','Add another useful detail or finish to review your listing.');
}
const strings=(v:unknown,max=12):string[]=>Array.isArray(v)?v.filter((x):x is string=>typeof x==='string').map(x=>x.trim().slice(0,300)).filter(Boolean).slice(0,max):[];
const text=(v:unknown,max=300)=>typeof v==='string'?v.trim().slice(0,max):'';
export function normalizeStudioEvidence(raw:unknown,signature:string,photos:readonly {slotId:string}[],niche:string,registered:readonly string[]):StudioEvidence{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('AI guidance returned no structured evidence.');
 const r=raw as Record<string,unknown>,ids=new Set(photos.map(p=>p.slotId)),seen=new Set<string>(),objectType=text(r.objectType,80);
 const allowed=new Set([...studioConfiguration(niche,objectType).roles.map(p=>p.id),'unknown']);
 const observations:StudioPhotoEvidence[]=(Array.isArray(r.photos)?r.photos:[]).flatMap(input=>{
  if(!input||typeof input!=='object')return [];const p=input as Record<string,unknown>,slotId=text(p.slotId,80);
  if(!ids.has(slotId)||seen.has(slotId))return [];seen.add(slotId);
  return [{slotId,role:allowed.has(String(p.role))?String(p.role):'unknown',observations:strings(p.observations),condition:strings(p.condition),limitations:strings(p.limitations),usable:p.usable===true}];
 });
 const conflicts=strings(r.conflicts),missing=strings(r.missing),nextRole=text(r.nextRole,80);
 const confidence=typeof r.confidence==='number'&&Number.isFinite(r.confidence)&&r.confidence>=0&&r.confidence<=1&&observations.some(p=>p.observations.length)?r.confidence:null;
 const packet=observations.some(p=>p.role==='packet')||photos.some(p=>p.slotId==='packet')?normalizeCoinPacket(r.coinPacket):null;
 return {...(packet?{coinPacket:packet}:{}),signature,candidate:text(r.candidate,180),objectType,recommendedNiche:registered.includes(String(r.recommendedNiche))?String(r.recommendedNiche):null,confidence,photos:observations,missing,conflicts,nextRole:allowed.has(nextRole)?nextRole:'',guidance:text(r.guidance,180),ready:r.ready===true&&conflicts.length===0&&missing.length===0&&observations.length===photos.length&&observations.every(p=>p.usable),answer:text(r.answer,600)};
}
