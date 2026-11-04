import { createContext, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import { useAuth } from '@/template';
import { getUserPrimaryTenant, provisionTenant, type Tenant } from '@/services/tenantService';
import { getBusinessConfig, type BusinessConfig } from '@/services/businessConfigService';
import { NICHES, isProductionNiche, type NicheId, type NicheConfig, type ProductionNicheId } from '@/constants/niches';
import { resolveNicheFromNativeAppId, resolveNicheFromNativeAppScheme } from '@/services/nicheRouting';
import { loadModuleAccess, activateModuleScope, type ModuleAccessSnapshot } from '@/services/moduleAccessService';
import type { SubscriptionStatus } from '@/services/subscriptionService';

export const SWISH_MASTER_ADMIN_EMAIL = 'troonvinyl@gmail.com';
/** Legacy presentation helper only. AppProvider and backend grants NEVER derive roles from this. */
export function isSwishMasterAdmin(email?: string | null) { return (email ?? '').trim().toLowerCase() === SWISH_MASTER_ADMIN_EMAIL; }
const unified = Constants.expoConfig?.extra?.swishUnifiedBuild !== false;
const configured = Constants.expoConfig?.extra?.swishNicheId;
const fixedNiche: ProductionNicheId | null = unified ? null :
  resolveNicheFromNativeAppId(Platform.OS === 'android' ? Constants.expoConfig?.android?.package : Constants.expoConfig?.ios?.bundleIdentifier) ??
  resolveNicheFromNativeAppScheme(Constants.expoConfig?.scheme) ?? (isProductionNiche(configured) ? configured : null);
interface AppContextType {
  isMasterAdmin: boolean; accessReady: boolean; accessError: string | null; canSwitchNiche: boolean; moduleLoading: boolean; moduleEpoch: number;
  openModule: (id: ProductionNicheId) => Promise<boolean>; returnToMaster: () => Promise<boolean>;
  subscriptionStatus: SubscriptionStatus | null; subscriptionLoading: boolean; subscriptionTier: string | null; refreshSubscription: () => Promise<void>;
  tenant: Tenant | null; tenantLoading: boolean; tenantError: string | null; reloadTenant: () => Promise<void>;
  businessConfig: BusinessConfig | null; reloadBusinessConfig: () => Promise<void>;
  activeNiche: NicheConfig; activeNicheId: NicheId; fixedNicheId: NicheId | null; enabledNiches: NicheId[]; nichePreferencesLoading: boolean;
  setActiveNiche: (id: NicheId) => void; enableNiche: (id: NicheId) => void; disableNiche: (id: NicheId) => void;
  activeAcquisitionId: string | null; setActiveAcquisitionId: (id: string | null) => void;
  scanMode: 'idle' | 'capturing' | 'processing' | 'reviewing'; setScanMode: (mode: 'idle' | 'capturing' | 'processing' | 'reviewing') => void;
  inventoryReloadSignal: number; triggerInventoryReload: () => void;
}
export const AppContext = createContext<AppContextType | undefined>(undefined);
export function AppProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userRef = useRef(user?.id); userRef.current = user?.id;
  const generation = useRef(0); const accessRequest = useRef(0); const scopeRequest = useRef(0);
  const tenantRef = useRef<Tenant | null>(null); const accessRef = useRef<ModuleAccessSnapshot | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null);
  const [tenantLoading, setTenantLoading] = useState(true); const [tenantError, setTenantError] = useState<string | null>(null);
  const [businessConfig, setBusinessConfig] = useState<BusinessConfig | null>(null);
  const [access, setAccess] = useState<ModuleAccessSnapshot | null>(null); const [accessError, setAccessError] = useState<string | null>(null);
  const [subscriptionLoading, setSubscriptionLoading] = useState(false); const [moduleLoading, setModuleLoading] = useState(false);
  const [activeNicheId, setNiche] = useState<NicheId>('general'); const activeRef = useRef<NicheId>('general');
  const [moduleEpoch, setEpoch] = useState(0); const [inventoryReloadSignal, setReloadSignal] = useState(0);
  const [activeAcquisitionId, setActiveAcquisitionId] = useState<string | null>(null);
  const [scanMode, setScanMode] = useState<AppContextType['scanMode']>('idle');
  const clearModule = useCallback(() => { activeRef.current = 'general'; setNiche('general'); setActiveAcquisitionId(null); setScanMode('idle'); setEpoch(v => v + 1); }, []);

  const openModule = useCallback(async (id: ProductionNicheId) => {
    const grant = accessRef.current; const account = tenantRef.current; const uid = userRef.current;
    if (!uid || !account || !grant || grant.tenantId !== account.id || !grant.nicheIds.includes(id) || (fixedNiche && fixedNiche !== id)) return false;
    const version = ++scopeRequest.current; setModuleLoading(true); setAccessError(null); clearModule();
    try {
      const result = await activateModuleScope(account.id, id);
      if (userRef.current !== uid || scopeRequest.current !== version) return false;
      if (result.error) { setAccessError(result.error); return false; }
      const config = await getBusinessConfig(account.id, id);
      if (userRef.current !== uid || scopeRequest.current !== version) return false;
      if (config.error) { setAccessError(config.error); return false; }
      setBusinessConfig(config.config);
      activeRef.current = id; setNiche(id); setReloadSignal(v => v + 1); return true;
    } finally { if (userRef.current === uid && scopeRequest.current === version) setModuleLoading(false); }
  }, [clearModule]);
  const returnToMaster = useCallback(async () => {
    const account = tenantRef.current; const uid = userRef.current;
    if (!account || !uid || !accessRef.current || (accessRef.current.nicheIds.length < 2 && !accessRef.current.owner) || fixedNiche) return false;
    const version = ++scopeRequest.current; setModuleLoading(true); clearModule();
    try {
      const result = await activateModuleScope(account.id, null);
      if (userRef.current !== uid || version !== scopeRequest.current) return false;
      if (result.error) { setAccessError(result.error); return false; }
      return true;
    } finally { if (userRef.current === uid && version === scopeRequest.current) setModuleLoading(false); }
  }, [clearModule]);
  const loadAccess = useCallback(async () => {
    const account = tenantRef.current; const uid = userRef.current;
    if (!account || !uid) return;
    const version = ++accessRequest.current; setSubscriptionLoading(true);
    try {
      const result = await loadModuleAccess(account.id);
      if (uid !== userRef.current || version !== accessRequest.current) return;
      if (result.error || !result.snapshot) {
        accessRef.current = null; setAccess(null); setAccessError(result.error); clearModule(); return;
      }
      const first = accessRef.current === null;
      const next = result.snapshot; accessRef.current = next; setAccess(next); setAccessError(null);
      const chosen = fixedNiche ?? (next.nicheIds.length === 1 && !next.owner ? next.nicheIds[0] : null);
      if (chosen && next.nicheIds.includes(chosen) && (first || activeRef.current !== chosen)) await openModule(chosen);
      else if (first || (activeRef.current !== 'general' && !next.nicheIds.includes(activeRef.current as ProductionNicheId))) {
        clearModule(); const scoped = await activateModuleScope(account.id, null);
        if (uid === userRef.current && version === accessRequest.current && scoped.error) setAccessError(scoped.error);
      }
      setReloadSignal(v => v + 1);
    } finally { if (uid === userRef.current && version === accessRequest.current) setSubscriptionLoading(false); }
  }, [openModule, clearModule]);
  const loadTenant = useCallback(async () => {
    const uid = user?.id; const version = ++generation.current;
    const valid = () => uid === userRef.current && version === generation.current;
    if (!uid) { setTenantLoading(false); return; }
    setTenantLoading(true); setTenantError(null);
    try {
      let result = await getUserPrimaryTenant();
      if (!valid()) return;
      if (result.error) throw new Error(result.error);
      if (!result.tenant) {
        const provision = await provisionTenant(uid, `${user?.username ?? user?.email?.split('@')[0] ?? 'My'} Business`);
        if (!valid()) return;
        if (provision.error) throw new Error(provision.error);
        result = await getUserPrimaryTenant();
      }
      if (!valid()) return;
      if (result.error || !result.tenant) throw new Error(result.error ?? 'Business account unavailable.');
      const config = await getBusinessConfig(result.tenant.id);
      if (!valid()) return;
      if (config.error) throw new Error(config.error);
      tenantRef.current = result.tenant; setTenant(result.tenant); setBusinessConfig(config.config); setLoadedUserId(uid);
      await loadAccess();
    } catch (error) { if (valid()) { tenantRef.current = null; setTenant(null); setLoadedUserId(uid); setTenantError(error instanceof Error ? error.message : 'Account load failed.'); } }
    finally { if (valid()) setTenantLoading(false); }
  }, [user?.id, user?.email, user?.username, loadAccess]);
  useEffect(() => {
    tenantRef.current = null; accessRef.current = null; setTenant(null); setAccess(null); setBusinessConfig(null); setLoadedUserId(null);
    setAccessError(null); setModuleLoading(false); setSubscriptionLoading(false); clearModule(); void loadTenant();
    return () => { generation.current++; accessRequest.current++; scopeRequest.current++; };
  }, [loadTenant, clearModule]);
  useEffect(() => {
    if (!user?.id) return;
    const timer = setInterval(() => { if (AppState.currentState === 'active') void loadAccess(); }, 240000);
    const listener = AppState.addEventListener('change', state => { if (state === 'active') void loadAccess(); });
    return () => { clearInterval(timer); listener.remove(); };
  }, [user?.id, loadAccess]);
  const accountMatches = Boolean(user?.id && loadedUserId === user.id);
  const effectiveAccess = accountMatches ? access : null;
  const effectiveTenant = accountMatches ? tenant : null;
  const reloadBusinessConfig = useCallback(async () => {
    const account = tenantRef.current; const uid = userRef.current;
    if (!account) return;
    const result = await getBusinessConfig(account.id, isProductionNiche(activeRef.current) ? activeRef.current : null);
    if (!result.error && uid === userRef.current) setBusinessConfig(result.config);
  }, []);
  const setActiveNiche = useCallback((id: NicheId) => { if (isProductionNiche(id) && activeRef.current !== id) void openModule(id); }, [openModule]);
  // Legacy preference actions now refresh actual grants. Never modify entitlements locally.
  const refreshPreferences = useCallback((_id: NicheId) => { void loadAccess(); }, [loadAccess]);
  return <AppContext.Provider value={{
    tenant: effectiveTenant, tenantLoading: Boolean(user?.id) && (!accountMatches || tenantLoading), tenantError, reloadTenant: loadTenant,
    businessConfig: accountMatches ? businessConfig : null, reloadBusinessConfig,
    isMasterAdmin: effectiveAccess?.owner === true, accessReady: !!effectiveAccess && !accessError, accessError,
    canSwitchNiche: !fixedNiche && !!effectiveAccess && (effectiveAccess.owner || effectiveAccess.nicheIds.length > 1),
    moduleLoading, moduleEpoch, openModule, returnToMaster,
    subscriptionStatus: effectiveAccess?.billingStatus ?? null, subscriptionLoading, subscriptionTier: effectiveTenant?.subscriptionTier ?? null, refreshSubscription: loadAccess,
    activeNiche: NICHES[accountMatches ? activeNicheId : 'general'], activeNicheId: accountMatches ? activeNicheId : 'general', fixedNicheId: fixedNiche,
    enabledNiches: effectiveAccess?.nicheIds ?? [], nichePreferencesLoading: Boolean(user?.id) && (!accountMatches || (!effectiveAccess && !accessError && !tenantError)),
    setActiveNiche, enableNiche: refreshPreferences, disableNiche: refreshPreferences,
    activeAcquisitionId, setActiveAcquisitionId, scanMode, setScanMode, inventoryReloadSignal, triggerInventoryReload: () => setReloadSignal(v => v + 1),
  }}>{children}</AppContext.Provider>;
}
