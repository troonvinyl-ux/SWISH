import { NICHE_MODULES, type ProductionNicheId } from '@/constants/niches';
import { getSpecialistProfile } from '@/shared/specialistIntelligence';
export interface SpecialistTool { title:string;detail:string;route:string;icon:string }
export function specialistTools(nicheId:ProductionNicheId):SpecialistTool[] {
  const extras:Partial<Record<ProductionNicheId,SpecialistTool[]>>={
    coins:[{title:'Islamic & Indian Silver',detail:'Existing specialist attribution pipeline',route:'/islamic-batch',icon:'toll'},{title:'Deep Identification Lab',detail:'Legends, measurements and competing candidates',route:'/deep-id-lab',icon:'manage-search'}],
    trading_cards:[{title:'Raw vs graded scenarios',detail:'Fees, probabilities and sale assumptions; not a predicted professional grade',route:'/card-grading',icon:'style'}],
    antiques:[{title:'Marks & period guides',detail:'Evidence-led attribution reference',route:'/antique-guides',icon:'menu-book'},{title:'Conservation & care',detail:'Retain original surfaces and disclose repairs',route:'/antique-restoration',icon:'handyman'}],
    motocross:[{title:'MX acquisition calculator',detail:'Transport, repairs, testing and profit scenarios',route:'/mx-acquisition',icon:'calculate'}],
    surplus_flip:[{title:'Manifest & lot intelligence',detail:'Existing manifest import, yield, bid and decomposition workspace',route:'/surplus-flip',icon:'account-tree'}],
  };
  const tools=extras[nicheId]??[];
  const home=NICHE_MODULES[nicheId].home;
  if(home&&!tools.some(tool=>tool.route===`/${home.replace(/\.tsx$/,'')}`)) tools.push({title:'Original specialist dashboard',detail:'Retained bespoke calculators and specialist workflow',route:`/${home.replace(/\.tsx$/,'')}`,icon:'dashboard'});
  return tools;
}
export function specialistReviewSummary(nicheId:ProductionNicheId){
  const profile=getSpecialistProfile(nicheId);
  return {title:profile?.focus??'Specialist review',checks:profile?.sourcingChecks??[],condition:profile?.conditionRules??'',valuation:profile?.valuationRules??'',tools:specialistTools(nicheId)};
}
