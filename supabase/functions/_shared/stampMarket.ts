// Shared pure stamp relevance adapter, reused on the server; no new marketplace client.
const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value).trim().toLowerCase() : '';
function usage(value: string): string { return /\bcto\b|cancelled.to.order/.test(value) ? 'cto' : /\bused\b/.test(value) && !/\bunused\b/.test(value) ? 'used' : /\bunused\b|\bmint\b|\bmnh\b/.test(value) ? 'unused' : ''; }
function gum(value: string): string { return /\bmnh\b|never hinged|unmounted mint/.test(value) ? 'mnh' : /\bno gum\b|without gum/.test(value) ? 'none' : /hinged|mounted mint/.test(value) ? 'hinged' : ''; }
export function stampComparableIssue(title: string, attributes: Record<string, any>): string | null {
  const comp = text(title);
  if (/rubber stamp|stamp duty|embossing tool|craft stamp|stamp tongs|perforation gauge/.test(comp)) return 'Tool or non-philatelic material';
  const sourceFields=attributes?._specialist_analysis?.fields??{};
  const supported=(key:string)=>attributes[`_inferred_${key}`]==null && sourceFields[key]?.basis!=='inferred' ? text(attributes[key]) : '';
  for (const [key,prefix] of [['sg_number','sg'],['scott_number','scott'],['michel_number','michel']]) {
    const reference=supported(key).replace(new RegExp('^'+prefix+'\\s*#?\\s*'),'');
    if (reference && !new RegExp('\\b'+prefix+'\\s*#?\\s*'+reference.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b','i').test(comp)) return 'Exact seller-supplied catalogue reference absent';
  }
  const issueName=supported('issue_name');
  const issueWords=issueName.split(/[^a-z0-9]+/).filter(word=>word.length>=3&&!['the','and','stamp','stamps','issue'].includes(word));
  if(issueWords.length && issueWords.filter(word=>comp.includes(word)).length/issueWords.length<0.75)return 'Different or unestablished issue design';
  const country=supported('country');
  const aliases:Record<string,string[]>={ 'great britain':['great britain','britain','gb','british'], 'united states':['united states','usa','us'], 'united kingdom':['united kingdom','uk','gb','britain'] };
  if(country && !(aliases[country]??[country]).some(value=>new RegExp('\\b'+value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b','i').test(comp)))return 'Issuing country not established in comparable';
  const targetUsage=usage(supported('usage')),compUsage=usage(comp);
  if(targetUsage && compUsage && targetUsage!==compUsage)return 'Different usage category';
  if(targetUsage && !compUsage)return 'Comparable usage not established';
  const targetGum=gum(supported('gum')),compGum=gum(comp);
  if(targetGum && targetGum!==compGum)return 'Different or unestablished gum/hinge state';
  const format=supported('format');
  const lot=/lot|collection|album|kiloware|bundle/.test(format),otherLot=/\blot\b|collection|album|kiloware|bundle/.test(comp);
  if(format && lot!==otherLot)return 'Single-versus-lot sale unit mismatch';
  if(/cover|postal history/.test(format) && !/cover|postal history/.test(comp))return 'Different postal-history format';
  return null;
}
export function stampMarketQueries(title:string,attributes:Record<string,any>):string[] {
  const fields=['country','denomination','issue_name','year','usage','format'];
  const identity=fields.map(key=>attributes[`_inferred_${key}`]==null?text(attributes[key]):'').filter(value=>value && !/unknown|not established|not checked/.test(value));
  const query=[...identity,'postage stamps'].join(' ').slice(0,100);
  return [...new Set([query,title.trim().slice(0,100)].filter(value=>value.length>=4))];
}
