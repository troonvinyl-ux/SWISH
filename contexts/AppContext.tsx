// SWISH appContext.tsx — Global tenant, scan, business config, and niche state
// Production accounts start with truthful empty states.
// No demo data seeding — new subscribers see honest empty states with guidance.
//
// Background sync: on first app open after login, if eBay is connected and items
// have eBay CDN images or blank titles, swish-image-download is called silently.

import React, { createContext, useState, useEffect, useRef, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/template';
import { getSupabaseClient } from '@/template';
import { Tenant, getUserPrimaryTenant, provisionTenant } from '@/services/tenantService';
import { BusinessConfig, getBusinessConfig } from '@/services/businessConfigService';
import {
  fetchAndStoreEbayImages, tenantNeedsImageSync,
} from '@/services/ebayImageService';
import { NicheId, NicheConfig, NICHES, getPrimaryNiche } from '@/constants/niches';
import { checkSubscription, SubscriptionStatus, PREMIUM_TIERS } from '@/services/subscriptionService';

const NICHE_STORAGE_KEY = '@swish_active_niches';

interface AppContextType {
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
  enabledNiches: NicheId[];
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
  const [enabledNiches, setEnabledNiches] = useState<NicheId[]>(['coins']);
  const [activeNicheId, setActiveNicheId] = useState<NicheId>('coins');

  // Load persisted niche preferences
  useEffect(() => {
    AsyncStorage.getItem(NICHE_STORAGE_KEY).then(val => {
      if (val) {
        try {
          const parsed = JSON.parse(val) as { active: NicheId; enabled: NicheId[] };
          if (parsed.active) setActiveNicheId(parsed.active);
          if (parsed.enabled && parsed.enabled.length > 0) setEnabledNiches(parsed.enabled);
        } catch {}
      }
    }).catch(() => {});
  }, []);

  const persistNiches = (active: NicheId, enabled: NicheId[]) => {
    AsyncStorage.setItem(NICHE_STORAGE_KEY, JSON.stringify({ active, enabled })).catch(() => {});
  };

  const setActiveNiche = (id: NicheId) => {
    setActiveNicheId(id);
    // Also ensure it's in the enabled list
    setEnabledNiches(prev => {
      const next = prev.includes(id) ? prev : [id, ...prev];
      persistNiches(id, next);
      return next;
    });
    persistNiches(id, enabledNiches.includes(id) ? enabledNiches : [id, ...enabledNiches]);
  };

  const enableNiche = (id: NicheId) => {
    setEnabledNiches(prev => {
      const next = prev.includes(id) ? prev : [...prev, id];
      persistNiches(activeNicheId, next);
      return next;
    });
  };

  const disableNiche = (id: NicheId) => {
    setEnabledNiches(prev => {
      const next = prev.filter(n => n !== id);
      const safeNext = next.length > 0 ? next : ['general' as NicheId];
      const newActive = safeNext.includes(activeNicheId) ? activeNicheId : safeNext[0];
      setActiveNicheId(newActive);
      persistNiches(newActive, safeNext);
      return safeNext;
    });
  };

  const activeNiche = NICHES[activeNicheId] ?? NICHES.coins;

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
        subscriptionStatus,
        subscriptionLoading,
        subscriptionTier: tenant?.subscriptionTier ?? null,
        refreshSubscription: loadSubscription,
        activeNiche,
        activeNicheId,
        enabledNiches,
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
