import React, { createContext, useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { useAuth } from '@/template';
import { Tenant, getUserPrimaryTenant, provisionTenant } from '@/services/tenantService';
import { BusinessConfig, getBusinessConfig } from '@/services/businessConfigService';
import { NicheId, NicheConfig, NICHES, PRODUCTION_NICHE_IDS, isProductionNiche } from '@/constants/niches';
import { checkSubscription, type SubscriptionStatus } from '@/services/subscriptionService';

const NICHE_STORAGE_PREFIX = '@swish_active_niches';
export const SWISH_MASTER_ADMIN_EMAIL = 'troonvinyl@gmail.com';
/** Presentation-only legacy owner hint. Server permissions never use this email. */
export function isSwishMasterAdmin(email?: string | null) { return (email ?? '').trim().toLowerCase() === SWISH_MASTER_ADMIN_EMAIL; }
const CONFIGURED_BUILD_NICHE = Constants.expoConfig?.extra?.swishNicheId;
const FIXED_BUILD_NICHE_ID: NicheId | null = isProductionNiche(CONFIGURED_BUILD_NICHE) ? CONFIGURED_BUILD_NICHE : null;
interface AppContextType {
  isMasterAdmin: boolean;
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
  const isMasterAdmin = isSwishMasterAdmin(user?.email);
  const currentUser = useRef(user?.id); currentUser.current = user?.id;
  const loadVersion = useRef(0);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null);
  const [tenantLoading, setTenantLoading] = useState(true);
  const [tenantError, setTenantError] = useState<string | null>(null);
  const [businessConfig, setBusinessConfig] = useState<BusinessConfig | null>(null);
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus | null>(null);
  const [subscriptionLoading, setSubscriptionLoading] = useState(false);
  const [activeAcquisitionId, setActiveAcquisitionId] = useState<string | null>(null);
  const [scanMode, setScanMode] = useState<AppContextType['scanMode']>('idle');
  const [inventoryReloadSignal, setInventoryReloadSignal] = useState(0);
  const [enabledNiches, setEnabledNiches] = useState<NicheId[]>(FIXED_BUILD_NICHE_ID ? [FIXED_BUILD_NICHE_ID] : ['general']);
  const [activeNicheId, setActiveNicheId] = useState<NicheId>(FIXED_BUILD_NICHE_ID ?? 'general');
  const [nichePreferencesLoading, setNichePreferencesLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setNichePreferencesLoading(true);
    setActiveNicheId(FIXED_BUILD_NICHE_ID ?? 'general');
    setEnabledNiches(FIXED_BUILD_NICHE_ID ? [FIXED_BUILD_NICHE_ID] : ['general']);
    const loadPreferences = async () => {
      if (FIXED_BUILD_NICHE_ID || !user?.id) return;
      try {
        const value = await AsyncStorage.getItem(`${NICHE_STORAGE_PREFIX}:${user.id}`);
        const saved = value ? JSON.parse(value) : {};
        if (cancelled) return;
        const selected: NicheId = isProductionNiche(saved.active) ? saved.active : (isMasterAdmin ? 'coins' : 'general');
        setActiveNicheId(selected);
        setEnabledNiches(isMasterAdmin ? [...PRODUCTION_NICHE_IDS] : Array.isArray(saved.enabled) ? saved.enabled.filter(isProductionNiche) : [selected]);
      } catch { /* Corrupt preferences remain general; never fall into another product. */ }
    };
    void loadPreferences().finally(() => { if (!cancelled) setNichePreferencesLoading(false); });
    return () => { cancelled = true; };
  }, [user?.id, isMasterAdmin]);

  const persist = useCallback((active: NicheId, enabled: NicheId[]) => {
    if (!user?.id || FIXED_BUILD_NICHE_ID) return;
    void AsyncStorage.setItem(`${NICHE_STORAGE_PREFIX}:${user.id}`, JSON.stringify({ active, enabled })).catch(() => {});
  }, [user?.id]);
  const setActiveNiche = useCallback((id: NicheId) => {
    if (!isProductionNiche(id) || (FIXED_BUILD_NICHE_ID && id !== FIXED_BUILD_NICHE_ID)) return;
    setActiveNicheId(id);
    setEnabledNiches(previous => { const next = previous.includes(id) ? previous : [id, ...previous.filter(isProductionNiche)]; persist(id, next); return next; });
  }, [persist]);
  const enableNiche = useCallback((id: NicheId) => {
    if (!isProductionNiche(id) || FIXED_BUILD_NICHE_ID) return;
    setEnabledNiches(previous => { const next = [...new Set([...previous.filter(isProductionNiche), id])]; persist(activeNicheId, next); return next; });
  }, [persist, activeNicheId]);
  const disableNiche = useCallback((id: NicheId) => {
    if (FIXED_BUILD_NICHE_ID) return;
    setEnabledNiches(previous => { const filtered = previous.filter(n => n !== id && isProductionNiche(n)); const next: NicheId[] = filtered.length ? filtered : ['general'];
      const active = next.includes(activeNicheId) ? activeNicheId : next[0]; setActiveNicheId(active); persist(active, next); return next; });
  }, [persist, activeNicheId]);

  const loadSubscription = useCallback(async () => {
    const uid = currentUser.current;
    if (!uid) return;
    setSubscriptionLoading(true);
    try { const { status, error } = await checkSubscription(); if (currentUser.current === uid) setSubscriptionStatus(error ? null : status); }
    finally { if (currentUser.current === uid) setSubscriptionLoading(false); }
  }, []);
  const loadTenant = useCallback(async () => {
    const uid = user?.id;
    const version = ++loadVersion.current;
    const valid = () => currentUser.current === uid && loadVersion.current === version;
    if (!uid) { setTenant(null); setBusinessConfig(null); setTenantLoading(false); return; }
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
      if (result.error || !result.tenant) throw new Error(result.error ?? 'Business account could not be loaded');
      const configResult = await getBusinessConfig(result.tenant.id);
      if (!valid()) return;
      if (configResult.error) throw new Error(configResult.error);
      setTenant(result.tenant); setBusinessConfig(configResult.config); setLoadedUserId(uid);
      void loadSubscription().catch(() => {});
    } catch (error: any) { if (valid()) { setTenant(null); setBusinessConfig(null); setLoadedUserId(uid); setTenantError(error?.message ?? 'Account load failed'); } }
    finally { if (valid()) setTenantLoading(false); }
  }, [user?.id, user?.email, user?.username, loadSubscription]);

  useEffect(() => {
    setTenant(null); setBusinessConfig(null); setSubscriptionStatus(null); setSubscriptionLoading(false);
    setLoadedUserId(null); setActiveAcquisitionId(null); setScanMode('idle');
    void loadTenant();
    return () => { loadVersion.current++; };
  }, [loadTenant]);
  const accountMatches = Boolean(user?.id && loadedUserId === user.id);
  const effectiveTenant = accountMatches ? tenant : null;
  const reloadBusinessConfig = useCallback(async () => {
    if (!effectiveTenant) return;
    const uid = currentUser.current; const id = effectiveTenant.id;
    const { config, error } = await getBusinessConfig(id);
    if (!error && currentUser.current === uid) setBusinessConfig(config);
  }, [effectiveTenant?.id]);

  return <AppContext.Provider value={{
    tenant: effectiveTenant, tenantLoading: Boolean(user?.id) && (!accountMatches || tenantLoading), tenantError,
    reloadTenant: loadTenant, businessConfig: accountMatches ? businessConfig : null, reloadBusinessConfig,
    isMasterAdmin, subscriptionStatus: accountMatches ? subscriptionStatus : null, subscriptionLoading,
    // Paid access is based on stored tenant/server billing state, never the client email hint.
    subscriptionTier: effectiveTenant?.subscriptionTier ?? null, refreshSubscription: loadSubscription,
    activeNiche: NICHES[FIXED_BUILD_NICHE_ID ?? activeNicheId] ?? NICHES.general,
    activeNicheId: FIXED_BUILD_NICHE_ID ?? activeNicheId, fixedNicheId: FIXED_BUILD_NICHE_ID,
    enabledNiches, nichePreferencesLoading, setActiveNiche, enableNiche, disableNiche,
    activeAcquisitionId, setActiveAcquisitionId, scanMode, setScanMode,
    inventoryReloadSignal, triggerInventoryReload: () => setInventoryReloadSignal(value => value + 1),
  }}>{children}</AppContext.Provider>;
}
