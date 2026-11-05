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
import { restoredModule } from '@/services/moduleNavigationService';
import { recordNavigationFailure } from '@/services/verificationCentreService';

export const SWISH_MASTER_ADMIN_EMAIL = 'troonvinyl@gmail.com';
/** Legacy presentation helper only. AppProvider and backend grants NEVER derive roles from this. */
export function isSwishMasterAdmin(email?: string | null) { return (email ?? '').trim().toLowerCase() === SWISH_MASTER_ADMIN_EMAIL; }
const unified = Constants.expoConfig?.extra?.swishUnifiedBuild !== false;
const configured = Constants.expoConfig?.extra?.swishNicheId;
const fixedNiche: ProductionNicheId | null = unified ? null :
  resolveNicheFromNativeAppId(Platform.OS === 'android' ? Constants.expoConfig?.android?.package : Constants.expoConfig?.ios?.bundleIdentifier) ??
  resolveNicheFromNativeAppScheme(Constants.expoConfig?.scheme) ?? (isProductionNiche(configured) ? configured : null);
interface AppContextType {
  isMasterAdmin: boolean; accessReady: boolean; accessError: string | null; moduleError: string | null; canSwitchNiche: boolean; moduleLoading: boolean; moduleEpoch: number;
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
  const tenantFlight = useRef<{ uid: string; version: number } | null>(null);
  const accessFlight = useRef<{ uid: string; version: number } | null>(null);
  const tenantRef = useRef<Tenant | null>(null); const accessRef = useRef<ModuleAccessSnapshot | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null);
  const [tenantLoading, setTenantLoading] = useState(true); const [tenantError, setTenantError] = useState<string | null>(null);
  const [businessConfig, setBusinessConfig] = useState<BusinessConfig | null>(null);
  const [access, setAccess] = useState<ModuleAccessSnapshot | null>(null); const [accessError, setAccessError] = useState<string | null>(null);
  const [moduleError, setModuleError] = useState<string | null>(null);
  const moduleLock = useRef(false);
  const [subscriptionLoading, setSubscriptionLoading] = useState(false); const [moduleLoading, setModuleLoading] = useState(false);
  const [activeNicheId, setNiche] = useState<NicheId>('general'); const activeRef = useRef<NicheId>('general');
  const [moduleEpoch, setEpoch] = useState(0); const [inventoryReloadSignal, setReloadSignal] = useState(0);
  const [activeAcquisitionId, setActiveAcquisitionId] = useState<string | null>(null);
  const [scanMode, setScanMode] = useState<AppContextType['scanMode']>('idle');
  const clearModule = useCallback(() => { activeRef.current = 'general'; setNiche('general'); setActiveAcquisitionId(null); setScanMode('idle'); setEpoch(v => v + 1); }, []);

  const openModule = useCallback(async (id: ProductionNicheId) => {
    const grant = accessRef.current; const account = tenantRef.current; const uid = userRef.current;
    if (moduleLock.current) return false;
    if (!uid || !account || !grant || grant.tenantId !== account.id || !grant.nicheIds.includes(id) || (fixedNiche && fixedNiche !== id)) { setModuleError('This workspace is not permitted by your verified memberships. Refresh access and retry.'); return false; }
    moduleLock.current = true;
    const version = ++scopeRequest.current; setModuleLoading(true); setModuleError(null);
    try {
      const result = await activateModuleScope(account.id, id);
      if (userRef.current !== uid || scopeRequest.current !== version) return false;
      if (result.error) { setModuleError(result.error); if (grant.owner) void recordNavigationFailure(account.id, id); return false; }
      const config = await getBusinessConfig(account.id, id);
      if (userRef.current !== uid || scopeRequest.current !== version) return false;
      // Settings are optional; an unavailable overlay must not discard an authorized module.
      setBusinessConfig(config.config); setModuleError(config.error);
      setActiveAcquisitionId(null); setScanMode('idle'); setEpoch(v => v + 1);
      activeRef.current = id; setNiche(id); setReloadSignal(v => v + 1); return true;
    } catch { if (userRef.current === uid && scopeRequest.current === version) { setModuleError('Workspace initialization failed. Retry this module; no inventory was changed.'); if (grant.owner) void recordNavigationFailure(account.id, id); } return false;
    } finally { moduleLock.current = false; if (userRef.current === uid && scopeRequest.current === version) setModuleLoading(false); }
  }, [clearModule]);
  const returnToMaster = useCallback(async () => {
    const account = tenantRef.current; const uid = userRef.current;
    if (!account || !uid || !accessRef.current || (accessRef.current.nicheIds.length < 2 && !accessRef.current.owner) || fixedNiche) return false;
    if (moduleLock.current) return false;
    moduleLock.current = true;
    const version = ++scopeRequest.current; setModuleLoading(true); setModuleError(null);
    try {
      const result = await activateModuleScope(account.id, null);
      if (userRef.current !== uid || version !== scopeRequest.current) return false;
      if (result.error) { setModuleError(result.error); return false; }
      clearModule(); return true;
    } catch { setModuleError('Master home could not be authorized. Retry.'); return false;
    } finally { moduleLock.current = false; if (userRef.current === uid && version === scopeRequest.current) setModuleLoading(false); }
  }, [clearModule]);
  const loadAccess = useCallback(async () => {
    const account = tenantRef.current; const uid = userRef.current;
    if (!account || !uid || accessFlight.current?.uid === uid) return;
    const version = ++accessRequest.current; accessFlight.current = { uid, version }; setSubscriptionLoading(true);
    try {
      const result = await loadModuleAccess(account.id);
      if (uid !== userRef.current || version !== accessRequest.current) return;
      if (result.error || !result.snapshot) {
        accessRef.current = null; setAccess(null); setAccessError(result.error); clearModule(); return;
      }
      const first = accessRef.current === null;
      const next = result.snapshot; accessRef.current = next; setAccess(next); setAccessError(null);
      const restored = first ? await restoredModule(account.id) : null;
      if (uid !== userRef.current || version !== accessRequest.current) return;
      const chosen = fixedNiche ?? (restored && next.nicheIds.includes(restored) ? restored : next.nicheIds.length === 1 && !next.owner ? next.nicheIds[0] : null);
      if (chosen && next.nicheIds.includes(chosen) && (first || activeRef.current !== chosen)) await openModule(chosen);
      else if (!moduleLock.current && (first || (activeRef.current !== 'general' && !next.nicheIds.includes(activeRef.current as ProductionNicheId)))) {
        clearModule(); const scoped = await activateModuleScope(account.id, null);
        if (uid === userRef.current && version === accessRequest.current && scoped.error) setAccessError(scoped.error);
      }
      setReloadSignal(v => v + 1);
    } catch (cause) {
      if (uid === userRef.current && version === accessRequest.current) {
        accessRef.current = null; setAccess(null); clearModule();
        setAccessError(cause instanceof Error ? cause.message : 'Membership verification could not be reached. Retry.');
      }
    } finally {
      if (accessFlight.current?.version === version) accessFlight.current = null;
      if (uid === userRef.current && version === accessRequest.current) setSubscriptionLoading(false);
    }
  }, [openModule, clearModule]);
  const loadTenant = useCallback(async () => {
    const uid = user?.id;
    if (!uid) { setTenantLoading(false); return; }
    // One initialization per user/generation. Retry taps cannot queue more pool requests.
    if (tenantFlight.current?.uid === uid && tenantFlight.current.version === generation.current) return;
    const version = ++generation.current; tenantFlight.current = { uid, version };
    const valid = () => uid === userRef.current && version === generation.current;
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
      // Verify identity/membership first. Optional business settings are not account verification.
      tenantRef.current = result.tenant; setTenant(result.tenant); setLoadedUserId(uid);
      await loadAccess();
      if (!valid() || !accessRef.current) return;
      // openModule already reads its scoped configuration; do not duplicate that request.
      if (activeRef.current === 'general') {
        try {
          const config = await getBusinessConfig(result.tenant.id);
          if (!valid()) return;
          setBusinessConfig(config.config); setModuleError(config.error);
        } catch { if (valid()) setModuleError('Business settings are temporarily unavailable. Retry settings before listing.'); }
      }
    } catch (error) { if (valid()) { tenantRef.current = null; setTenant(null); setLoadedUserId(uid); setTenantError(error instanceof Error ? error.message : 'Account load failed.'); } }
    finally { if (tenantFlight.current?.version === version) tenantFlight.current = null; if (valid()) setTenantLoading(false); }
  }, [user?.id, user?.email, user?.username, loadAccess]);
  useEffect(() => {
    tenantFlight.current = null; accessFlight.current = null;
    tenantRef.current = null; accessRef.current = null; setTenant(null); setAccess(null); setBusinessConfig(null); setLoadedUserId(null);
    setAccessError(null); setModuleError(null); setModuleLoading(false); setSubscriptionLoading(false); clearModule(); void loadTenant();
    return () => { generation.current++; accessRequest.current++; scopeRequest.current++; };
  }, [loadTenant, clearModule]);
  // Never leave startup verification spinning forever if a backend request stalls.
  // Invalidate the in-flight generations so a retry can start a fresh request.
  useEffect(() => {
    const pending = tenantLoading || subscriptionLoading || moduleLoading ||
      (Boolean(user?.id) && !loadedUserId && !tenantError && !accessError);
    if (!pending) return;
    const timer = setTimeout(() => {
      generation.current++;
      accessRequest.current++;
      scopeRequest.current++;
      tenantFlight.current = null;
      accessFlight.current = null;
      moduleLock.current = false;
      setTenantLoading(false);
      setSubscriptionLoading(false);
      setModuleLoading(false);
      const message = 'Specialist access verification timed out. The backend did not finish responding. Your membership has not been changed. Tap retry to start a fresh check.';
      if (!loadedUserId || tenantLoading) setTenantError(message);
      else setAccessError(message);
    }, 25000);
    return () => clearTimeout(timer);
  }, [tenantLoading, subscriptionLoading, moduleLoading, loadedUserId, tenantError, accessError, user?.id]);

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
    moduleLoading, moduleError, moduleEpoch, openModule, returnToMaster,
    subscriptionStatus: effectiveAccess?.billingStatus ?? null, subscriptionLoading, subscriptionTier: effectiveTenant?.subscriptionTier ?? null, refreshSubscription: loadAccess,
    activeNiche: NICHES[accountMatches ? activeNicheId : 'general'], activeNicheId: accountMatches ? activeNicheId : 'general', fixedNicheId: fixedNiche,
    enabledNiches: effectiveAccess?.nicheIds ?? [], nichePreferencesLoading: Boolean(user?.id) && (!accountMatches || (!effectiveAccess && !accessError && !tenantError)),
    setActiveNiche, enableNiche: refreshPreferences, disableNiche: refreshPreferences,
    activeAcquisitionId, setActiveAcquisitionId, scanMode, setScanMode, inventoryReloadSignal, triggerInventoryReload: () => setReloadSignal(v => v + 1),
  }}>{children}</AppContext.Provider>;
}
