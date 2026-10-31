// SWISH Repricing Hook
import { useState, useEffect, useCallback } from 'react';
import { useApp } from './useApp';
import { getProductionNicheSpecialistIds } from '@/services/nicheRouting';
import {
  RepricingRule,
  StaleListingInfo,
  listRepricingRules,
  createRepricingRule,
  toggleRepricingRule,
  deleteRepricingRule,
  getStaleListings,
  getAIRepriceSuggestion,
  applyReprice,
  scanForStaleListingExceptions,
  RepriceSuggestion,
} from '@/services/repricingService';

export function useRepricing() {
  const { tenant, activeNicheId, fixedNicheId } = useApp();
  // A branded APK's fixed niche must take precedence over persisted workspace state.
  const nicheId = fixedNicheId ?? activeNicheId;
  const specialistIds = getProductionNicheSpecialistIds(nicheId);
  const [rules, setRules] = useState<RepricingRule[]>([]);
  const [staleListings, setStaleListings] = useState<StaleListingInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [suggestionLoading, setSuggestionLoading] = useState<Record<string, boolean>>({});
  const [suggestions, setSuggestions] = useState<Record<string, RepriceSuggestion>>({});

  const load = useCallback(async () => {
    if (!tenant?.id) {
      setRules([]);
      setStaleListings([]);
      return;
    }
    setLoading(true);
    try {
      const [rulesResult, staleResult] = await Promise.all([
        listRepricingRules(tenant.id),
        // The service enforces the niche boundary in the database query (fail closed).
        getStaleListings(tenant.id, nicheId ?? '', 7),
      ]);
      const scopedListings = staleResult.listings.filter(listing => specialistIds.includes(listing.specialistId));
      const scopedItemIds = new Set(scopedListings.map(listing => listing.itemId));
      const scopedListingIds = new Set(scopedListings.map(listing => listing.id));
      setRules(rulesResult.rules.filter(rule =>
        (!rule.itemId && !rule.listingId) ||
        (rule.itemId ? scopedItemIds.has(rule.itemId) : false) ||
        (rule.listingId ? scopedListingIds.has(rule.listingId) : false)
      ));
      setStaleListings(scopedListings);
      // Exception scans must use the same fixed-niche-aware scope as the visible list.
      if (specialistIds.length > 0) {
        scanForStaleListingExceptions(tenant.id, nicheId ?? '').catch(() => {});
      }
    } finally {
      setLoading(false);
    }
  }, [tenant?.id, nicheId, specialistIds.join('|')]);

  useEffect(() => { void load(); }, [load]);

  const addRule = useCallback(async (input: Parameters<typeof createRepricingRule>[1]) => {
    if (!tenant) return { error: 'No tenant' };
    const { rule, error } = await createRepricingRule(tenant.id, input);
    if (rule) setRules(prev => [rule, ...prev]);
    return { rule, error };
  }, [tenant?.id]);

  const toggleRule = useCallback(async (ruleId: string, isActive: boolean) => {
    const { error } = await toggleRepricingRule(ruleId, isActive);
    if (!error) setRules(prev => prev.map(r => r.id === ruleId ? { ...r, isActive } : r));
    return { error };
  }, []);

  const removeRule = useCallback(async (ruleId: string) => {
    const { error } = await deleteRepricingRule(ruleId);
    if (!error) setRules(prev => prev.filter(r => r.id !== ruleId));
    return { error };
  }, []);

  const getAISuggestion = useCallback(async (listing: StaleListingInfo) => {
    if (!tenant?.id || !nicheId) return { error: 'No active niche' };
    setSuggestionLoading(prev => ({ ...prev, [listing.id]: true }));
    try {
      const { suggestion, error } = await getAIRepriceSuggestion(listing.id, tenant.id, nicheId);
      if (suggestion) {
        setSuggestions(prev => ({
          ...prev,
          [listing.id]: {
            ...suggestion,
            itemTitle: listing.itemTitle,
            daysListed: listing.daysListed,
            views: listing.views,
            watchers: listing.watchers,
          },
        }));
      }
      return { error };
    } finally {
      setSuggestionLoading(prev => ({ ...prev, [listing.id]: false }));
    }
  }, [tenant?.id, nicheId]);

  const applyPrice = useCallback(async (listingId: string, newPrice: number) => {
    if (!tenant?.id || !nicheId) return { error: 'No active niche' };
    const { error } = await applyReprice(listingId, newPrice, tenant.id, nicheId);
    if (!error) {
      setStaleListings(prev => prev.map(l =>
        l.id === listingId ? { ...l, price: newPrice } : l
      ));
      setSuggestions(prev => {
        const next = { ...prev };
        delete next[listingId];
        return next;
      });
    }
    return { error };
  }, [tenant?.id, nicheId]);

  const activeRules = rules.filter(r => r.isActive);

  return {
    rules,
    activeRules,
    staleListings,
    loading,
    suggestionLoading,
    suggestions,
    addRule,
    toggleRule,
    removeRule,
    getAISuggestion,
    applyPrice,
    reload: load,
  };
}
