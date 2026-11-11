// Shared conservative eBay import classification. Category evidence is a prior, never an entitlement.
import { NICHE_MODULES } from '@/constants/niches';
import { inferImportNiche } from '@/shared/ebayImportScope';
import type { RegisteredNicheId } from '@/shared/moduleContracts';
export type NicheClassification = RegisteredNicheId | 'unclassified';
// Retained legacy category-ID mappings; new stamp leaf IDs come from live Taxonomy, not AI.
const CATEGORY_ID_TO_NICHE: Record<string, NicheClassification> = {
 '4726':'coins','40714':'coins','18594':'coins','18593':'coins','4157':'coins','4158':'coins','4138':'coins','4735':'coins','4734':'coins','527':'coins','4733':'coins','260':'coins','11116':'coins','14486':'coins','14487':'coins',
 // '1469' is broad Other Collectables, not proof of numismatic ownership.
 '4744':'coins','37968':'coins','40717':'coins','4159':'coins','18596':'coins','29539':'coins','47188':'coins','620':'coins','10968':'coins',
 '6760':'motocross','6759':'motocross','10767':'motocross','10768':'motocross','47002':'motocross','6761':'motocross','50434':'motocross','26455':'motocross','26459':'motocross','26456':'motocross','26457':'motocross','50370':'motocross','26460':'motocross','25634':'motocross','25633':'motocross',
 '2904':'bicycles','56197':'bicycles','177831':'bicycles','48647':'bicycles','56199':'bicycles','56198':'bicycles','177832':'bicycles','2906':'bicycles','15279':'bicycles','15274':'bicycles','15278':'bicycles','15272':'bicycles','46060':'bicycles','56203':'bicycles','56200':'bicycles','15275':'bicycles',
 '1059':'clothing','11450':'clothing','15724':'clothing','15725':'clothing','57990':'clothing','57991':'clothing','11483':'clothing','11484':'clothing','152506':'clothing','45333':'clothing','169291':'clothing','175748':'clothing','50995':'clothing','3002':'clothing','57988':'clothing','14890':'clothing','63848':'clothing','172131':'clothing','169741':'clothing',
 '183454':'trading_cards','2536':'trading_cards','261328':'trading_cards','261329':'trading_cards','261330':'trading_cards','246':'trading_cards',
 '20081':'antiques','20091':'antiques','870':'antiques','261186':'antiques','550':'antiques','37958':'antiques','360':'antiques','14324':'antiques','14325':'antiques','50':'antiques','13956':'antiques',
};
const CATEGORY_NAME_NICHE_KEYWORDS: Array<{keywords:string[];niche:NicheClassification}> = [
 {keywords:['postage stamp','stamps','philatelic','postal history','first day cover','miniature sheet'],niche:'stamps'},
 {keywords:['vinyl records','music cds','audio cassettes','music records'],niche:'tunes_flip'},
 {keywords:['coin','numismatic','banknote','currency','medal','token','exonumia','bullion','hammered','roman coin','greek coin','british coin','world coin'],niche:'coins'},
 {keywords:['motocross','enduro','dirt bike','mx bike','pit bike','minimoto','ktm','husqvarna','trial bike','off-road motorcycle','motorbike parts','motorcycle engine','motorcycle exhaust','motorcycle suspension','motorcycle frame'],niche:'motocross'},
 {keywords:['bicycle','mountain bike','road bike','bmx','cycling','bike frame','pedal cycle','electric bike','e-bike','folding bike','hybrid bike','cycle'],niche:'bicycles'},
 {keywords:["men's clothing","women's clothing","boys' clothing","girls' clothing",'t-shirt','hoodie','sweatshirt','jeans','dress','jacket','coat','trainer','sneaker','sportswear','activewear','vintage clothing','fashion'],niche:'clothing'},
 {keywords:['pokémon','pokemon','magic gathering','trading card','sports card','ccg','tcg','yu-gi-oh'],niche:'trading_cards'},
 {keywords:['fossil','ammonite','trilobite','mineral specimen','petrified'],niche:'fossils'},
 {keywords:['skincare','skin care','makeup','cosmetic','perfume','fragrance','beauty product','lipstick','foundation','serum'],niche:'beauty'},
 {keywords:['laptop','computer','tablet','smartphone','graphics card','processor','monitor','electronics','computer components'],niche:'tech'},
 {keywords:['action figure','action figures','figurine','figurines','comic','comics','comic book','board game','board games','memorabilia','pop culture','collectible bear','diecast','model car','model train','toy soldier','vintage toy','vintage toys','souvenir','movie memorabilia','music memorabilia','sports memorabilia','collectables','toys'],niche:'collectibles'},
 {keywords:['antique','vintage watch','wristwatch','pocket watch','fine jewellery','militaria','ceramics','pottery','antiquarian book'],niche:'antiques'},
];
const TITLE_NICHE_KEYWORDS: Array<{patterns:RegExp[];niche:NicheClassification;confidence:'high'|'medium'}> = [
 {patterns:[/\b(postage stamps?|philatelic|philately|first day cover|postal history|miniature sheet|stamp booklet)\b/i],niche:'stamps',confidence:'high'},
 {patterns:[/\b(vinyl record|vinyl lp|audio cassette|music cd|compact disc|7[- ]inch single|12[- ]inch single)\b/i],niche:'tunes_flip',confidence:'high'},
 {patterns:[/\b(coin|denarius|dirham|tetradrachm|drachm|solidus|florin|shilling|penny|sovereign|groat|tanka|rupee|stater|obol|nummus|follis|sesterce|aureus|sestertius)\b/i,/\b(ancient coin|roman coin|greek coin|byzantine coin|medieval coin|hammered coin|milled coin|decimal coin|victorian coin|george iii coin|edward vii coin|silver coin|gold coin|bronze coin)\b/i,/\b(numismatic|spink|km #|kgm|ric\b|bmc\b|sng\b|n#|graded coin|pcgs|ngc)\b/i],niche:'coins',confidence:'high'},
 {patterns:[/\b(ktm|husqvarna|husky|yamaha yz|yamaha wr|honda crf|honda cr|kawasaki kx|suzuki rm|suzuki rmz|beta xtrainer|sherco|gas gas|tm racing|fantic|dirt bike)\b/i,/\b(motocross|enduro|supermoto|pit bike|mx bike|sx\b|exc\b|xcw\b|sxf\b|xcf\b|fe\b|te\b|fc\b|2-stroke|4-stroke|250sx|450sx|250xc|300exc)\b/i,/\b(tpi\b|2t\b|4t\b|monoshock|linkage|usd forks|triple clamp|rekluse|twin air|boyesen|wb\b)\b/i],niche:'motocross',confidence:'high'},
 {patterns:[/\b(shimano|sram|campagnolo|specialized|trek|giant|cannondale|scott|cervélo|pinarello|de rosa|colnago|bianchi|focus|genesis|kona|marin)\b/i,/\b(mountain bike|road bike|bmx|cycling|bicycle|bike frame|wheels (\d{2}mm|\d{2}")[^a-z]|deraill|cassette|chainset|groupset|carbon fork|alloy frame)\b/i],niche:'bicycles',confidence:'high'},
 {patterns:[/\b(vintage tee|band tee|graphic tee|dead?stock|nwt\b|nos\b|bnwt\b|stone island|north face|superdry|levi|wrangler|carhartt|dickies|ralph lauren)\b/i,/\b(size [xsml]\b|size \d{2}\b|chest \d{2}|length \d{2}|made in (england|hong kong|taiwan|usa)|care label|composition label)\b/i],niche:'clothing',confidence:'medium'},
 {patterns:[/\b(pokémon|pokemon card|magic: the gathering|yu-gi-oh|mtg\b|graded psa|graded bgs|holo rare|first edition|shadowless|booster pack)\b/i],niche:'trading_cards',confidence:'high'},
 {patterns:[/\b(fossil|ammonite|trilobite|shark tooth|petrified wood|dinosaur bone|mineral specimen)\b/i],niche:'fossils',confidence:'high'},
 {patterns:[/\b(skincare|makeup|cosmetic|perfume|fragrance|lipstick|foundation|serum|beauty product)\b/i],niche:'beauty',confidence:'high'},
 {patterns:[/\b(laptop|desktop computer|graphics card|processor|motherboard|monitor|tablet|smartphone|electronics)\b/i],niche:'tech',confidence:'high'},
 {patterns:[/\b(wedgwood|royal doulton|royal worcester|harrods.{0,20}bear|silver[ -]plated|jasperware|giftware|commemorative figurine)\b/i,/\b(action figure|action figures|figurine|figurines|comic book|comic books|comics|board game|board games|memorabilia|pop culture|collectible bear|diecast|model car|model train|toy soldier|vintage toy|vintage toys|souvenir|movie memorabilia|music memorabilia|sports memorabilia)\b/i,/\b(lego set|star wars figure|transformers figure|funko pop|hot wheels|matchbox car|teddy bear collection|limited edition figurine)\b/i],niche:'collectibles',confidence:'medium'},
 {patterns:[/\b(job lot|joblot|surplus|pallet|clearance lot|wholesale lot|liquidation|manifest)\b/i],niche:'surplus_flip',confidence:'medium'},
];
export interface ClassificationResult { niche:NicheClassification;confidence:'category_id'|'category_name'|'title_high'|'title_medium'|'none';reason:string }
export function classifyListing(categoryId:string|null|undefined,categoryName:string|null|undefined,title:string|null|undefined,description?:string|null):ClassificationResult {
 const catId=(categoryId??'').trim(),catName=(categoryName??'').trim().toLowerCase(),titleStr=(title??'').trim();
 const review=(reason:string):ClassificationResult=>({niche:'unclassified',confidence:'none',reason});
 const sharedCategory=inferImportNiche(catName,''),sharedTitle=inferImportNiche('',titleStr),categoryNiche=CATEGORY_ID_TO_NICHE[catId];
 const stampEvidence=sharedCategory==='stamps'||sharedTitle==='stamps';
 // Apply before weak denomination / surname keywords: Penny Black and Scott are not coin/bicycle signals.
 if(stampEvidence) {
  const combined=inferImportNiche(catName,titleStr);
  if(combined!=='stamps'||(categoryNiche&&categoryNiche!=='stamps'))return review('Category and title evidence conflict; manual classification required');
  return {niche:'stamps',confidence:sharedCategory==='stamps'?'category_name':'title_high',reason:'Explicit philatelic evidence; denomination and catalogue-name words are not another niche identity.'};
 }
 const titleNiches=new Set<NicheClassification>(TITLE_NICHE_KEYWORDS.filter(rule=>rule.patterns.some(pattern=>pattern.test(titleStr))).map(rule=>rule.niche));
 if(sharedTitle)titleNiches.add(sharedTitle as NicheClassification);
 if(sharedCategory&&[...titleNiches].some(niche=>niche!==sharedCategory))return review('Category and title evidence conflict; manual classification required');
 if(categoryNiche&&[...titleNiches].some(niche=>niche!==categoryNiche))return review('Category and title evidence conflict; manual classification required');
 if(categoryNiche)return {niche:categoryNiche,confidence:'category_id',reason:`Category ID ${catId} mapped to ${categoryNiche}`};
 if(catName){
  const pathIds=new Set(catName.match(/\b\d+\b/g)??[]),matchedNiches=new Set([...pathIds].map(id=>CATEGORY_ID_TO_NICHE[id]).filter(Boolean));
  if(matchedNiches.size>1)return review('Category path spans specialist niches; review required');
  for(const [id,niche] of Object.entries(CATEGORY_ID_TO_NICHE))if(pathIds.has(id)){
   if([...titleNiches].some(value=>value!==niche))return review('Category path and item evidence conflict; review required');
   return {niche,confidence:'category_id',reason:`Category name path contains known ID ${id} → ${niche}`};
  }
  for(const {keywords,niche} of CATEGORY_NAME_NICHE_KEYWORDS)for(const keyword of keywords)if(catName.includes(keyword))return {niche,confidence:'category_name',reason:`Category name "${catName}" matches keyword "${keyword}" → ${niche}`};
 }
 if(titleNiches.size>1)return review('Multiple niche signals; manual classification required');
 for(const {patterns,niche,confidence} of TITLE_NICHE_KEYWORDS)if(patterns.some(pattern=>pattern.test(titleStr)))return {niche,confidence:`title_${confidence}`,reason:`Title matches pattern for ${niche}: "${titleStr.slice(0,60)}"`};
 return review(`No niche classification for catId="${catId}" catName="${catName.slice(0,40)}" title="${titleStr.slice(0,40)}"`);
}
export function nicheToSpecialistId(niche:NicheClassification):string { return niche!=='unclassified'&&Object.prototype.hasOwnProperty.call(NICHE_MODULES,niche)?NICHE_MODULES[niche].defaultSpecialist:'curiosities_collectibles'; }
export function isListingEligibleForNiche(result:ClassificationResult,targetNiche:NicheClassification|null):boolean { return Boolean(targetNiche&&targetNiche!=='unclassified'&&result.niche===targetNiche); }
