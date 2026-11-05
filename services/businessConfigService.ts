import { getSupabaseClient } from '@/template';
import { backendRead, shareBackendRequest } from './backendRequestService';
export interface BusinessConfig {
  id: string; tenantId: string; startingCapital: number; availableCapital: number; targetCapital: number | null; targetProfit: number | null; targetTimeframeMonths: number | null; timeframeStartDate: string;
  riskTolerance: 'low' | 'medium' | 'high' | 'aggressive'; weeklyHoursAvailable: number; maxSingleAcquisition: number; maxTotalDeployment: number | null; autonomousSpendingLimit: number;
  automationLevel: 'manual' | 'assisted' | 'one_click' | 'auto_approval' | 'autonomous';
  autoIdentify: boolean; autoResearch: boolean; autoValue: boolean; autoList: boolean; autoPublish: boolean; autoReprice: boolean; autoAcquire: boolean;
  preferredCategories: string[]; prohibitedCategories: string[]; preferredMarketplaces: string[]; geography: string; currency: string;
  minROIThreshold: number; minMarginThreshold: number; highValueThreshold: number; defaultShippingCost: number; onboardingComplete: boolean; setupStep: number; createdAt: string; updatedAt: string;
}
const fieldMap: Record<string, string> = {
 startingCapital:'starting_capital',availableCapital:'available_capital',targetCapital:'target_capital',targetProfit:'target_profit',targetTimeframeMonths:'target_timeframe_months',
 riskTolerance:'risk_tolerance',weeklyHoursAvailable:'weekly_hours_available',maxSingleAcquisition:'max_single_acquisition',maxTotalDeployment:'max_total_deployment',autonomousSpendingLimit:'autonomous_spending_limit',automationLevel:'automation_level',
 autoIdentify:'auto_identify',autoResearch:'auto_research',autoValue:'auto_value',autoList:'auto_list',autoPublish:'auto_publish',autoReprice:'auto_reprice',autoAcquire:'auto_acquire',
 preferredCategories:'preferred_categories',prohibitedCategories:'prohibited_categories',preferredMarketplaces:'preferred_marketplaces',geography:'geography',currency:'currency',
 minROIThreshold:'min_roi_threshold',minMarginThreshold:'min_margin_threshold',highValueThreshold:'high_value_threshold',defaultShippingCost:'default_shipping_cost',onboardingComplete:'onboarding_complete',setupStep:'setup_step',
};
const moduleKeys = new Set(['currency','geography','default_shipping_cost','preferred_categories','prohibited_categories','preferred_marketplaces','min_roi_threshold','min_margin_threshold','high_value_threshold','auto_identify','auto_research','auto_value','auto_list','auto_publish','auto_reprice','auto_acquire']);
function mapConfig(row: any): BusinessConfig {
 return { id:row.id,tenantId:row.tenant_id,startingCapital:Number(row.starting_capital ?? 0),availableCapital:Number(row.available_capital ?? 0),targetCapital:row.target_capital == null?null:Number(row.target_capital),targetProfit:row.target_profit == null?null:Number(row.target_profit),targetTimeframeMonths:row.target_timeframe_months ?? null,timeframeStartDate:row.timeframe_start_date ?? '',riskTolerance:row.risk_tolerance ?? 'medium',weeklyHoursAvailable:Number(row.weekly_hours_available ?? 5),maxSingleAcquisition:Number(row.max_single_acquisition ?? 500),maxTotalDeployment:row.max_total_deployment == null?null:Number(row.max_total_deployment),autonomousSpendingLimit:Number(row.autonomous_spending_limit ?? 100),automationLevel:row.automation_level ?? 'assisted',autoIdentify:row.auto_identify ?? true,autoResearch:row.auto_research ?? true,autoValue:row.auto_value ?? true,autoList:row.auto_list ?? false,autoPublish:row.auto_publish ?? false,autoReprice:row.auto_reprice ?? false,autoAcquire:row.auto_acquire ?? false,preferredCategories:row.preferred_categories ?? [],prohibitedCategories:row.prohibited_categories ?? [],preferredMarketplaces:row.preferred_marketplaces ?? ['ebay'],geography:row.geography ?? 'GB',currency:row.currency ?? 'GBP',minROIThreshold:Number(row.min_roi_threshold ?? 0.3),minMarginThreshold:Number(row.min_margin_threshold ?? 0.2),highValueThreshold:Number(row.high_value_threshold ?? 100),defaultShippingCost:Number(row.default_shipping_cost ?? 0),onboardingComplete:row.onboarding_complete ?? false,setupStep:row.setup_step ?? 0,createdAt:row.created_at ?? '',updatedAt:row.updated_at ?? '' };
}
export async function getBusinessConfig(tenantId: string, nicheId?: string | null): Promise<{ config: BusinessConfig | null; error: string | null }> {
 return shareBackendRequest(`business-config:${tenantId}:${nicheId ?? 'resolve'}`, async () => {
  try {
   const client=getSupabaseClient();
   const {data}=await backendRead(`business-base:${tenantId}`, signal => client.from('business_config').select('*').eq('tenant_id',tenantId).maybeSingle().abortSignal(signal));
   if(!data) return {config:null,error:null};
   // Known scoped callers already passed swish_open_module. RLS still checks the settings read.
   let selected=nicheId;
   if(nicheId===undefined) {
    const scope=await backendRead('current-module', signal => client.rpc('swish_current_module').abortSignal(signal));
    selected=scope.data?.tenant_id===tenantId?scope.data.niche_id:null;
   }
   let overlay:Record<string,unknown>={};
   if(selected) {
    const preferences=await backendRead(`business-overlay:${tenantId}:${selected}`, signal => client.from('swish_niche_settings').select('settings').eq('tenant_id',tenantId).eq('niche_id',selected).maybeSingle().abortSignal(signal));
    overlay=Object.fromEntries(Object.entries(preferences.data?.settings ?? {}).filter(([key])=>moduleKeys.has(key)));
   }
   return {config:mapConfig({...data,...overlay}),error:null};
  } catch(cause) { return {config:null,error:cause instanceof Error?cause.message:'Specialist settings could not be loaded.'}; }
 });
}
export async function upsertBusinessConfig(tenantId:string,updates:Partial<Omit<BusinessConfig,'id'|'tenantId'|'createdAt'|'updatedAt'>>):Promise<{config:BusinessConfig|null;error:string|null}> {
 const client=getSupabaseClient();const payload:Record<string,unknown>={tenant_id:tenantId};
 for(const [key,value] of Object.entries(updates)) if(fieldMap[key] && value!==undefined) payload[fieldMap[key]]=value;
 const scope=await client.rpc('swish_current_module');if(scope.error)return {config:null,error:'Settings authorization unavailable.'};
 const selected=scope.data?.tenant_id===tenantId?scope.data.niche_id:null;
 const moduleData=Object.fromEntries(Object.entries(payload).filter(([key])=>moduleKeys.has(key)));
 if(selected && Object.keys(moduleData).length) {
  const previous=await client.from('swish_niche_settings').select('settings').eq('tenant_id',tenantId).eq('niche_id',selected).maybeSingle();
  if(previous.error)return {config:null,error:'Specialist settings could not be read.'};
  const saved=await client.from('swish_niche_settings').upsert({tenant_id:tenantId,niche_id:selected,settings:{...(previous.data?.settings ?? {}),...moduleData},updated_at:new Date().toISOString()},{onConflict:'tenant_id,niche_id'});
  if(saved.error)return {config:null,error:'Specialist settings could not be saved.'};
  for(const key of Object.keys(moduleData))delete payload[key];
 }
 if(Object.keys(payload).length>1) {
  const result=await client.from('business_config').upsert(payload,{onConflict:'tenant_id'});
  if(result.error)return {config:null,error:result.error.message};
 }
 return getBusinessConfig(tenantId,selected);
}
export function computeGoalProgress(config:BusinessConfig,currentCapital:number) {
 const start=config.startingCapital || 1,target=config.targetCapital ?? start*2.5,growth=currentCapital-start;
 const progressPct=Math.min(100,Math.max(0,(growth/Math.max(1,target-start))*100));
 const startDate=new Date(config.timeframeStartDate || config.createdAt),totalDays=(config.targetTimeframeMonths ?? 6)*30;
 const daysElapsed=Math.max(0,Math.floor((Date.now()-startDate.getTime())/86400000)),daysRemaining=Math.max(0,totalDays-daysElapsed);
 const projectedFinalCapital=currentCapital+(daysElapsed>0?growth/daysElapsed:0)*daysRemaining;
 return {progressPct,capitalGrowth:growth,daysElapsed,daysRemaining,onTrack:projectedFinalCapital>=target,projectedFinalCapital};
}
