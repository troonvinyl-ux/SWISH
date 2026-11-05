import {createContext,useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import {AppState,Platform} from 'react-native';
import Constants from 'expo-constants';
import {useAuth} from '@/template';
import {getUserPrimaryTenant,provisionTenant,type Tenant} from '@/services/tenantService';
import {getBusinessConfig,type BusinessConfig} from '@/services/businessConfigService';
import {NICHES,isProductionNiche,type NicheId,type NicheConfig,type ProductionNicheId} from '@/constants/niches';
import {resolveNicheFromNativeAppId,resolveNicheFromNativeAppScheme} from '@/services/nicheRouting';
import {loadModuleAccess,activateModuleScope,type ModuleAccessSnapshot} from '@/services/moduleAccessService';
import type {SubscriptionStatus} from '@/services/subscriptionService';
import {recordNavigationFailure} from '@/services/verificationCentreService';
import {isBackendUnavailable} from '@/services/backendAvailabilityService';
const verificationMaxAge=300000;
export const SWISH_MASTER_ADMIN_EMAIL='troonvinyl@gmail.com';
/** Presentation helper only. Backend identity, never editable metadata, determines privilege. */
export function isSwishMasterAdmin(email?:string|null){return (email??'').trim().toLowerCase()===SWISH_MASTER_ADMIN_EMAIL;}
const unified=Constants.expoConfig?.extra?.swishUnifiedBuild!==false;
const configured=Constants.expoConfig?.extra?.swishNicheId;
const fixedNiche:ProductionNicheId|null=unified?null:resolveNicheFromNativeAppId(Platform.OS==='android'?Constants.expoConfig?.android?.package:Constants.expoConfig?.ios?.bundleIdentifier)??resolveNicheFromNativeAppScheme(Constants.expoConfig?.scheme)??(isProductionNiche(configured)?configured:null);
interface AppContextType {
 isMasterAdmin:boolean;accessReady:boolean;accessError:string|null;moduleError:string|null;canSwitchNiche:boolean;moduleLoading:boolean;moduleEpoch:number;
 openModule:(id:ProductionNicheId)=>Promise<boolean>;returnToMaster:()=>Promise<boolean>;
 subscriptionStatus:SubscriptionStatus|null;subscriptionLoading:boolean;subscriptionTier:string|null;refreshSubscription:()=>Promise<void>;
 tenant:Tenant|null;tenantLoading:boolean;tenantError:string|null;reloadTenant:()=>Promise<void>;
 businessConfig:BusinessConfig|null;reloadBusinessConfig:()=>Promise<void>;
 activeNiche:NicheConfig;activeNicheId:NicheId;fixedNicheId:NicheId|null;enabledNiches:NicheId[];nichePreferencesLoading:boolean;
 setActiveNiche:(id:NicheId)=>void;enableNiche:(id:NicheId)=>void;disableNiche:(id:NicheId)=>void;
 activeAcquisitionId:string|null;setActiveAcquisitionId:(id:string|null)=>void;
 scanMode:'idle'|'capturing'|'processing'|'reviewing';setScanMode:(mode:'idle'|'capturing'|'processing'|'reviewing')=>void;
 inventoryReloadSignal:number;triggerInventoryReload:()=>void;
}
export const AppContext=createContext<AppContextType|undefined>(undefined);
export function AppProvider({children}:{children:ReactNode}){
 const {user}=useAuth();
 const userRef=useRef(user?.id);userRef.current=user?.id;
 const profileRef=useRef(user);profileRef.current=user;
 const generation=useRef(0),accessRequest=useRef(0),scopeRequest=useRef(0);
 const tenantFlight=useRef<{uid:string;version:number}|null>(null),accessFlight=useRef<{uid:string;version:number}|null>(null);
 const tenantRef=useRef<Tenant|null>(null),accessRef=useRef<ModuleAccessSnapshot|null>(null);
 const moduleLock=useRef(false),activeRef=useRef<NicheId>('general');
 const [tenant,setTenant]=useState<Tenant|null>(null),[loadedUserId,setLoadedUserId]=useState<string|null>(null);
 const [tenantLoading,setTenantLoading]=useState(true),[tenantError,setTenantError]=useState<string|null>(null);
 const [businessConfig,setBusinessConfig]=useState<BusinessConfig|null>(null);
 const [access,setAccess]=useState<ModuleAccessSnapshot|null>(null),[accessError,setAccessError]=useState<string|null>(null);
 const [moduleError,setModuleError]=useState<string|null>(null);
 const [subscriptionLoading,setSubscriptionLoading]=useState(false),[moduleLoading,setModuleLoading]=useState(false);
 const [activeNicheId,setNiche]=useState<NicheId>('general');
 const [moduleEpoch,setEpoch]=useState(0),[inventoryReloadSignal,setReloadSignal]=useState(0);
 const [activeAcquisitionId,setActiveAcquisitionId]=useState<string|null>(null);
 const [scanMode,setScanMode]=useState<AppContextType['scanMode']>('idle');
 const clearModule=useCallback(()=>{activeRef.current='general';setNiche('general');setBusinessConfig(null);setActiveAcquisitionId(null);setScanMode('idle');setEpoch(v=>v+1);},[]);
 const openModule = useCallback(async(id:ProductionNicheId)=>{
  const grant=accessRef.current,account=tenantRef.current,uid=userRef.current;
  if(moduleLock.current)return false;
  if(!uid||!account||!grant||grant.tenantId!==account.id||!grant.nicheIds.includes(id)||(fixedNiche&&fixedNiche!==id)){
   setModuleError('This workspace is not permitted by your verified memberships. Refresh access and retry.');return false;
  }
  moduleLock.current=true;const version=++scopeRequest.current;setModuleLoading(true);setModuleError(null);
  const valid=()=>userRef.current===uid&&scopeRequest.current===version&&tenantRef.current?.id===account.id;
  try {
   const result=await activateModuleScope(account.id, id);
   if(!valid())return false;
   if(result.error){clearModule();setModuleError(result.error);if(grant.owner&&!isBackendUnavailable(result.error))void recordNavigationFailure(account.id,id);return false;}
   // Only a confirmed swish_open_module response commits module state.
   setBusinessConfig(null);setActiveAcquisitionId(null);setScanMode('idle');setEpoch(v=>v+1);
   activeRef.current=id;setNiche(id);setReloadSignal(v=>v+1);
   // Optional settings never hold the verification spinner open. No old overlay crosses a module change.
   void getBusinessConfig(account.id,id).then(config=>{if(valid()&&activeRef.current===id){setBusinessConfig(config.config);setModuleError(config.error);}}).catch(()=>{if(valid())setModuleError('Specialist settings are temporarily unavailable.');});
   return true;
  } catch(cause){if(valid()){clearModule();setModuleError(cause instanceof Error?cause.message:'Workspace initialization failed. Retry.');}return false;}
  finally{if(valid()){moduleLock.current=false;setModuleLoading(false);}}
 },[clearModule]);
 const returnToMaster = useCallback(async()=>{
  const account=tenantRef.current,uid=userRef.current,grant=accessRef.current;
  if(!account||!uid||!grant||(grant.nicheIds.length<2&&!grant.owner)||fixedNiche||moduleLock.current)return false;
  moduleLock.current=true;const version=++scopeRequest.current;setModuleLoading(true);setModuleError(null);
  const valid=()=>userRef.current===uid&&scopeRequest.current===version;
  try {
   const result=await activateModuleScope(account.id,null);if(!valid())return false;
   if(result.error){clearModule();setModuleError(result.error);return false;}
   clearModule();return true;
  }catch(cause){if(valid()){clearModule();setModuleError(cause instanceof Error?cause.message:'Master home authorization failed. Retry.');}return false;}
  finally{if(valid()){moduleLock.current=false;setModuleLoading(false);}}
 },[clearModule]);
 const loadAccess=useCallback(async()=>{
  const account=tenantRef.current,uid=userRef.current;
  if(!account||!uid||accessFlight.current?.uid===uid)return;
  const version=++accessRequest.current;accessFlight.current={uid,version};
  const previous=accessRef.current;setSubscriptionLoading(!previous);
  const valid=()=>uid===userRef.current&&version===accessRequest.current&&tenantRef.current?.id===account.id;
  const failure=(message:string)=>{
   if(!valid())return;
   if(previous?.tenantId===account.id&&isBackendUnavailable(message)&&Date.now()-previous.verifiedAt<verificationMaxAge){setModuleError(message);return;}
   accessRef.current=null;setAccess(null);setAccessError(message);clearModule();
  };
  try {
   const result=await loadModuleAccess(account.id);if(!valid())return;
   if(result.error||!result.snapshot){failure(result.error??'Membership verification returned no snapshot.');return;}
   const first=accessRef.current===null,next=result.snapshot;
   accessRef.current=next;setAccess(next);setAccessError(null);
   // New logins: one entitlement opens directly; multi/owner starts at the portfolio.
   // Subsequent membership refreshes preserve the explicitly selected, still-permitted module.
   const chosen=fixedNiche??(next.nicheIds.length===1&&!next.owner?next.nicheIds[0]:null);
   if(chosen&&next.nicheIds.includes(chosen)&&(first||activeRef.current!==chosen))await openModule(chosen);
   else if(!moduleLock.current&&(first||(activeRef.current!=='general'&&!next.nicheIds.includes(activeRef.current as ProductionNicheId)))){
    clearModule();const scoped=await activateModuleScope(account.id,null);if(valid()&&scoped.error)setModuleError(scoped.error);
   }
   // An unchanged membership refresh is not an inventory invalidation.
  }catch(cause){failure(cause instanceof Error?cause.message:'Membership verification could not be reached. Retry.');}
  finally{if(accessFlight.current?.version===version)accessFlight.current=null;if(valid())setSubscriptionLoading(false);}
 },[openModule,clearModule]);
 const loadTenant = useCallback(async()=>{
  const uid=userRef.current;if(!uid){setTenantLoading(false);return;}
  if(tenantFlight.current?.uid===uid&&tenantFlight.current.version===generation.current)return;
  const version=++generation.current;tenantFlight.current={uid,version};
  const valid=()=>uid===userRef.current&&version===generation.current;
  setTenantLoading(true);setTenantError(null);
  try {
   let result=await getUserPrimaryTenant();if(!valid())return;if(result.error)throw new Error(result.error);
   if(!result.tenant){
    const provision=await provisionTenant(uid,`${profileRef.current?.username??profileRef.current?.email?.split('@')[0]??'My'} Business`);
    if(!valid())return;if(provision.error)throw new Error(provision.error);result=await getUserPrimaryTenant();
   }
   if(!valid())return;if(result.error||!result.tenant)throw new Error(result.error??'Business account unavailable.');
   tenantRef.current=result.tenant;setTenant(result.tenant);setLoadedUserId(uid);
   await loadAccess();if(!valid()||!accessRef.current)return;
   if(activeRef.current==='general'){
    const accountId=result.tenant.id,scopeVersion=scopeRequest.current;
    void getBusinessConfig(accountId,null).then(config=>{if(valid()&&tenantRef.current?.id===accountId&&scopeRequest.current===scopeVersion&&activeRef.current==='general'){setBusinessConfig(config.config);setModuleError(config.error);}}).catch(()=>{if(valid())setModuleError('Business settings are temporarily unavailable.');});
   }
  }catch(cause){if(valid()){
   const message=cause instanceof Error?cause.message:'Account load failed.';
   if(tenantRef.current&&accessRef.current&&isBackendUnavailable(message)&&Date.now()-accessRef.current.verifiedAt<verificationMaxAge)setModuleError(message);
   else{tenantRef.current=null;accessRef.current=null;setTenant(null);setAccess(null);clearModule();setLoadedUserId(uid);setTenantError(message);}
  }}finally{if(tenantFlight.current?.version===version)tenantFlight.current=null;if(valid())setTenantLoading(false);}
 },[user?.id,loadAccess,clearModule]);
 useEffect(()=>{
  tenantFlight.current=null;accessFlight.current=null;moduleLock.current=false;
  tenantRef.current=null;accessRef.current=null;setTenant(null);setAccess(null);setBusinessConfig(null);setLoadedUserId(null);
  setAccessError(null);setModuleError(null);setModuleLoading(false);setSubscriptionLoading(false);clearModule();void loadTenant();
  return()=>{generation.current++;accessRequest.current++;scopeRequest.current++;};
 },[loadTenant,clearModule]);
 // Individual HTTP reads abort at 12s (billing at 20s). This aggregate startup deadline
 // covers sequential tenant + billing + server module restoration/activation, including provisioning.
 useEffect(()=>{
  const pending=tenantLoading||subscriptionLoading||moduleLoading||(Boolean(user?.id)&&!loadedUserId&&!tenantError&&!accessError);
  if(!pending)return;
  const timer=setTimeout(()=>{
   generation.current++;accessRequest.current++;scopeRequest.current++;tenantFlight.current=null;accessFlight.current=null;moduleLock.current=false;
   setTenantLoading(false);setSubscriptionLoading(false);setModuleLoading(false);setLoadedUserId(userRef.current??null);
   const message='Specialist access verification timed out. The backend did not finish responding. Tap retry to start a fresh check.';
   if(accessRef.current&&Date.now()-accessRef.current.verifiedAt<verificationMaxAge){setModuleError(message);return;}
   accessRef.current=null;setAccess(null);clearModule();if(!loadedUserId||tenantLoading)setTenantError(message);else setAccessError(message);
  },60000);
  return()=>clearTimeout(timer);
 },[tenantLoading,subscriptionLoading,moduleLoading,loadedUserId,tenantError,accessError,user?.id,clearModule]);
 useEffect(()=>{
  if(!access)return;
  const timer=setTimeout(()=>{if(accessRef.current===access){accessRef.current=null;setAccess(null);clearModule();setAccessError('Membership verification expired. Refresh access to continue.');void loadAccess();}},Math.max(1,verificationMaxAge-(Date.now()-access.verifiedAt)));
  return()=>clearTimeout(timer);
 },[access,clearModule,loadAccess]);
 useEffect(()=>{
  if(!user?.id)return;
  const timer=setInterval(()=>{if(AppState.currentState==='active')void loadAccess();},240000);
  const listener=AppState.addEventListener('change',state=>{if(state==='active')void loadAccess();});
  return()=>{clearInterval(timer);listener.remove();};
 },[user?.id,loadAccess]);
 const accountMatches=Boolean(user?.id&&loadedUserId===user.id),effectiveAccess=accountMatches?access:null,effectiveTenant=accountMatches?tenant:null;
 const reloadBusinessConfig=useCallback(async()=>{
  const account=tenantRef.current,uid=userRef.current,id=activeRef.current,version=scopeRequest.current;
  if(!account)return;
  const result=await getBusinessConfig(account.id,isProductionNiche(id)?id:null);
  if(uid===userRef.current&&tenantRef.current?.id===account.id&&scopeRequest.current===version&&activeRef.current===id){setModuleError(result.error);if(!result.error)setBusinessConfig(result.config);}
 },[]);
 const setActiveNiche=useCallback((id:NicheId)=>{if(isProductionNiche(id)&&activeRef.current!==id)void openModule(id);},[openModule]);
 const refreshPreferences=useCallback((_id:NicheId)=>{void loadAccess();},[loadAccess]);
 return <AppContext.Provider value={{
  tenant:effectiveTenant,tenantLoading:Boolean(user?.id)&&(!accountMatches||tenantLoading),tenantError,reloadTenant:loadTenant,
  businessConfig:accountMatches?businessConfig:null,reloadBusinessConfig,
  isMasterAdmin:effectiveAccess?.owner===true,accessReady:!!effectiveAccess&&!accessError,accessError,
  canSwitchNiche:!fixedNiche&&!!effectiveAccess&&(effectiveAccess.owner||effectiveAccess.nicheIds.length>1),moduleLoading,moduleError,moduleEpoch,openModule,returnToMaster,
  subscriptionStatus:effectiveAccess?.billingStatus??null,subscriptionLoading,subscriptionTier:effectiveTenant?.subscriptionTier??null,refreshSubscription:loadAccess,
  activeNiche:NICHES[accountMatches?activeNicheId:'general'],activeNicheId:accountMatches?activeNicheId:'general',fixedNicheId:fixedNiche,enabledNiches:effectiveAccess?.nicheIds??[],
  nichePreferencesLoading:Boolean(user?.id)&&(!accountMatches||(!effectiveAccess&&!accessError&&!tenantError)),setActiveNiche,enableNiche:refreshPreferences,disableNiche:refreshPreferences,
  activeAcquisitionId,setActiveAcquisitionId,scanMode,setScanMode,inventoryReloadSignal,triggerInventoryReload:()=>setReloadSignal(v=>v+1),
 }}>{children}</AppContext.Provider>;
}
