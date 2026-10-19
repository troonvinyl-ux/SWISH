// SWISH appContext.tsx — Global tenant, scan, business config, and niche state
// Production accounts start with truthful empty states.
// No demo data seeding — new subscribers see honest empty states with guidance.
//
// Background sync: on first app open after login, if eBay is connected and items
// have eBay CDN images or blank titles, swish-image-download is called silently.

import React, { createContext, useState, useEffect, useRef, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { useAuth } from '@/template';
import { getSupabaseClient } from '@/template';
import { Tenant, getUserPrimaryTenant, provisionTenant } from '@/services/tenantService';
import { BusinessConfig, getBusinessConfig } from '@/services/businessConfigService';
import {
  fetchAndStoreEbayImages, tenantNeedsImageSync,
} from '@/services/ebayImageService';
import { NicheId, NicheConfig, NICHES, PRODUCTION_NICHE_IDS, isProductionNiche } from '@/constants/niches';
import { checkSubscription, SubscriptionStatus } from '@/services/subscriptionService';

const NICHE_STORAGE_PREFIX = '@swish_active_niches';
export const SWISH_MASTER_ADMIN_EMAIL = 'troonvinyl@gmail.com';
export function isSwishMasterAdmin(email?: string | null): boolean {
  return (email ?? '').trim().toLowerCase() === SWISH_MASTER_ADMIN_EMAIL;
}
const CONFIGURED_BUILD_NICHE = Constants.expoConfig?.extra?.swishNicheId;
const FIXED_BUILD_NICHE_ID: NicheId | null = isProductionNiche(CONFIGURED_BUILD_NICHE)
  ? CONFIGURED_BUILD_NICHE
  : null;

interface AppContextType {
  // Platform owner access
  isMasterAdmin: boolean;

  // Subscription
  subscriptionStatus: SubscriptionStatus | null;
  subscriptionLoading: boolean;
  subscriptionTier: string | null;  // direct tenant tier (lifetime, professional, etc.)
  refreshSubscription: () => Promise<void>;

  // Tenant
  tenant: Tenant | null;
  tenantLoading: boolean;
  tenantError: string | null;
  reloadTenant: () => Promise<void>;

  // Business Config
  businessConfig: BusinessConfig | null;
  reloadBusinessConfig: () => Promise<void>;

  // Active Niche — the primary working niche
  activeNiche: NicheConfig;
  activeNicheId: NicheId;
  fixedNicheId: NicheId | null;
  enabledNiches: NicheId[];
  nichePreferencesLoading: boolean;
  setActiveNiche: (id: NicheId) => void;
  enableNiche: (id: NicheId) => void;
  disableNiche: (id: NicheId) => void;

  // Active state
  activeAcquisitionId: string | null;
  setActiveAcquisitionId: (id: string | null) => void;

  // Scan state
  scanMode: 'idle' | 'capturing' | 'processing' | 'reviewing';
  setScanMode: (mode: 'idle' | 'capturing' | 'processing' | 'reviewing') => void;

  // Inventory reload signal — increment to trigger useInventory to refetch
  inventoryReloadSignal: number;
  triggerInventoryReload: () => void;
}

export const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const isMasterAdmin = isSwishMasterAdmin(user?.email);

  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [tenantLoading, setTenantLoading] = useState(false);
  const [tenantError, setTenantError] = useState<string | null>(null);
  const [businessConfig, setBusinessConfig] = useState<BusinessConfig | null>(null);
  const [activeAcquisitionId, setActiveAcquisitionId] = useState<string | null>(null);
  const [scanMode, setScanMode] = useState<'idle' | 'capturing' | 'processing' | 'reviewing'>('idle');
  const [inventoryReloadSignal, setInventoryReloadSignal] = useState(0);
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus | null>(null);
  const [subscriptionLoading, setSubscriptionLoading] = useState(false);

  // Niche state — persisted to AsyncStorage
  const [enabledNiches, setEnabledNiches] = useState<NicheId[]>(FIXED_BUILD_NICHE_ID ? [FIXED_BUILD_NICHE_ID] : ['general']);
  const [activeNicheId, setActiveNicheId] = useState<NicheId>(FIXED_BUILD_NICHE_ID ?? 'general');
  const [nichePreferencesLoading, setNichePreferencesLoading] = useState(true);

  // Niche preferences are account-scoped. Device-wide niche state allowed one
  // signed-in account to inherit another account's selected product on shared devices.
  useEffect(() => {
    let cancelled = false;
    setNichePreferencesLoading(true);
    setActiveNicheId(FIXED_BUILD_NICHE_ID ?? 'general');
    setEnabledNiches(FIXED_BUILD_NICHE_ID ? [FIXED_BUILD_NICHE_ID] : ['general']);
    const loadForAccount = async () => {
      if (!user?.id) {
        setActiveNicheId(FIXED_BUILD_NICHE_ID ?? 'general');
        setEnabledNiches(FIXED_BUILD_NICHE_ID ? [FIXED_BUILD_NICHE_ID] : ['general']);
        setSubscriptionStatus(null);
        setSubscriptionLoading(false);
        setNichePreferencesLoading(false);
        return;
      }

      const storageKey = `${NICHE_STORAGE_PREFIX}:${user.id}`;

      // The verified master account can switch every production niche, even
      // when the app was built as a single-niche branded build.
      if (isMasterAdmin) {
        let active: NicheId = 'coins';
        try {
          const val = await AsyncStorage.getItem(storageKey);
          const parsed = val ? JSON.parse(val) as { active?: string } : null;
          if (isProductionNiche(parsed?.active)) active = parsed.active;
        } catch {
          // Invalid saved preferences fall back to the default owner niche.
        }
        if (!cancelled) {
          setActiveNicheId(active);
          setEnabledNiches([...PRODUCTION_NICHE_IDS]);
          setNichePreferencesLoading(false);
        }
        return;
      }

      // Non-owner accounts in branded builds remain pinned to their product.
      if (FIXED_BUILD_NICHE_ID) {
        setActiveNicheId(FIXED_BUILD_NICHE_ID);
        setEnabledNiches([FIXED_BUILD_NICHE_ID]);
        setNichePreferencesLoading(false);
        return;
      }

      try {
        const val = await AsyncStorage.getItem(storageKey);
        if (cancelled || !val) return;
        const parsed = JSON.parse(val) as { active?: string; enabled?: string[] };
        const active = isProductionNiche(parsed.active) ? parsed.active : 'general';
        const enabled = Array.isArray(parsed.enabled)
          ? parsed.enabled.filter((id): id is NicheId => isProductionNiche(id))
          : [];
        if (!cancelled) {
          setActiveNicheId(active);
          setEnabledNiches(enabled.length > 0 ? enabled : ['general']);
        }
      } catch {
        // Corrupt preferences fail closed; they never select a product implicitly.
        if (!cancelled) {
          setActiveNicheId('general');
          setEnabledNiches(['general']);
        }
      } finally {
        if (!cancelled) setNichePreferencesLoading(false);
      }
    };
    loadForAccount().catch(() => {
      if (!cancelled) setNichePreferencesLoading(false);
    });
    return () => { cancelled = true; };
  }, [user?.id, isMasterAdmin]);

  const persistNiches = (active: NicheId, enabled: NicheId[]) => {
    if (!user?.id || (FIXED_BUILD_NICHE_ID && !isMasterAdmin)) return;
    const storageKey = `${NICHE_STORAGE_PREFIX}:${user.id}`;
    AsyncStorage.setItem(storageKey, JSON.stringify({ active, enabled })).catch(() => {});
  };

  const setActiveNiche = (id: NicheId) => {
    if (!isProductionNiche(id) || (FIXED_BUILD_NICHE_ID && id !== FIXED_BUILD_NICHE_ID && !isMasterAdmin)) return;
    setActiveNicheId(id);
    setEnabledNiches(prev => {
      const next = prev.includes(id) ? prev : [id, ...prev.filter(isProductionNiche)];
      persistNiches(id, next);
      return next;
    });
  };

  const enableNiche = (id: NicheId) => {
    if (!isProductionNiche(id) || (FIXED_BUILD_NICHE_ID && !isMasterAdmin)) return;
    setEnabledNiches(prev => {
      const next = prev.includes(id) ? prev : [...prev.filter(isProductionNiche), id];
      persistNiches(activeNicheId, next);
      return next;
    });
  };

  const disableNiche = (id: NicheId) => {
    if (!isProductionNiche(id) || (FIXED_BUILD_NICHE_ID && !isMasterAdmin)) return;
    setEnabledNiches(prev => {
      const next = prev.filter(n => n !== id && isProductionNiche(n));
      const safeNext: NicheId[] = next.length > 0 ? next : ['general'];
      const newActive = safeNext.includes(activeNicheId) ? activeNicheId : (safeNext[0] ?? 'general');
      setActiveNicheId(newActive);
      persistNiches(newActive, safeNext);
      return safeNext;
    });
  };

  // Safe fallback: use 'general' niche (never coin-specific) when activeNicheId is invalid
  const activeNiche = NICHES[activeNicheId] ?? NICHES.general;

  // Track whether background image/title sync has already fired this session
  const bgSyncFiredRef = useRef(false);

  const loadSubscription = async () => {
    setSubscriptionLoading(true);
    try {
      const { status } = await checkSubscription();
      setSubscriptionStatus(status);
    } catch {}
    setSubscriptionLoading(false);
  };

  const loadBusinessConfig = async (tid: string) => {
    const { config } = await getBusinessConfig(tid);
    setBusinessConfig(config);
  };

  /**
   * Silent background sync — runs once per session after tenant + eBay are ready.
   * Checks if any items still have eBay CDN images or blank titles, then calls
   * swish-image-download to permanently store photos and repair titles.
   * Completely non-blocking: errors are swallowed silently.
   */
  const runBackgroundSync = async (tenantId: string) => {
    if (bgSyncFiredRef.current) return;
    bgSyncFiredRef.current = true;

    try {
      const supabase = getSupabaseClient();

      // 1. Check eBay connector is connected
      const { data: connector } = await supabase
        .from('marketplace_connectors')
        .select('status')
        .eq('tenant_id', tenantId)
        .eq('marketplace_id', 'ebay')
        .maybeSingle();

      if (connector?.status !== 'connected') return;

      // 2. Check if any items need image download or title fix
      const needsSync = await tenantNeedsImageSync(tenantId);

      // Also check blank titles
      const { data: blankTitles } = await supabase
        .from('items')
        .select('id')
        .eq('tenant_id', tenantId)
        .or('canonical_title.is.null,canonical_title.eq.,canonical_title.eq.Untitled')
        .limit(1);

      if (!needsSync && (blankTitles?.length ?? 0) === 0) return; // Nothing to do

      console.log('[AppContext] Background sync: running swish-image-download...');

      // 3. Fire swish-image-download — fully server-side, non-blocking
      await fetchAndStoreEbayImages(tenantId, { fixTitles: true });

      console.log('[AppContext] Background sync: complete');
    } catch (e: any) {
      // Completely silent — never surfaces to the user
      console.log('[AppContext] Background sync skipped:', e?.message ?? 'unknown');
    }
  };

  const loadTenant = async () => {
    if (!user) {
      setTenant(null);
      setBusinessConfig(null);
      bgSyncFiredRef.current = false;
      return;
    }
    setTenantLoading(true);
    setTenantError(null);
    try {
      const { tenant: t, error } = await getUserPrimaryTenant();
      if (error) {
        setTenantError(error);
      } else if (t) {
        setTenant(t);
        await loadBusinessConfig(t.id);
        // Kick off background image/title sync without awaiting — fire and forget
        runBackgroundSync(t.id).catch(() => {});
        // Load subscription status (non-blocking)
        loadSubscription().catch(() => {});
      } else {
        // New user — provision a tenant automatically
        const businessName = user.username
          ? `${user.username}'s Business`
          : user.email.split('@')[0] + "'s Business";
        const { tenantId, error: provErr } = await provisionTenant(user.id, businessName);
        if (provErr) {
          setTenantError(provErr);
        } else {
          const { tenant: newT } = await getUserPrimaryTenant();
          if (newT) {
            setTenant(newT);
            await loadBusinessConfig(newT.id);
            // New tenant — nothing to sync yet, but fire anyway (noop if no eBay)
            runBackgroundSync(newT.id).catch(() => {});
            loadSubscription().catch(() => {});
          }
        }
      }
    } catch (e: any) {
      setTenantError(e?.message ?? 'Failed to load tenant');
    } finally {
      setTenantLoading(false);
    }
  };


  useEffect(() => {
    loadTenant();
  }, [user?.id]);

  return (
    <AppContext.Provider
      value={{
        tenant,
        tenantLoading,
        tenantError,
        reloadTenant: loadTenant,
        businessConfig,
        reloadBusinessConfig: async () => {
          if (tenant) await loadBusinessConfig(tenant.id);
        },
        isMasterAdmin,
        subscriptionStatus,
        subscriptionLoading,
        subscriptionTier: tenant?.subscriptionTier ?? null,
        refreshSubscription: loadSubscription,
        activeNiche,
        activeNicheId,
        fixedNicheId: FIXED_BUILD_NICHE_ID,
        enabledNiches,
        nichePreferencesLoading,
        setActiveNiche,
        enableNiche,
        disableNiche,
        activeAcquisitionId,
        setActiveAcquisitionId,
        scanMode,
        setScanMode,
        inventoryReloadSignal,
        triggerInventoryReload: () => setInventoryReloadSignal(s => s + 1),
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
