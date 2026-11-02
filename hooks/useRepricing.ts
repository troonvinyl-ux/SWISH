// SWISH Repricing Hook
import { useState, useEffect, useCallback } from 'react';
import { useApp } from './useApp';
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
  const nicheId = String(fixedNicheId ?? activeNicheId ?? '');
  const [rules, setRules] = useState<RepricingRule[]>([]);
  const [staleListings, setStaleListings] = useState<StaleListingInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [suggestionLoading, setSuggestionLoading] = useState<Record<string, boolean>>({});
  const [suggestions, setSuggestions] = useState<Record<string, RepriceSuggestion>>({});

  const load = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    const [rulesResult, staleResult] = await Promise.all([
      listRepricingRules(tenant.id),
      getStaleListings(tenant.id, nicheId, 7),
    ]);
    setRules(rulesResult.rules);
    setStaleListings(staleResult.listings);
    // Scan for exceptions in background
    scanForStaleListingExceptions(tenant.id, nicheId).catch(() => {});
    setLoading(false);
  }, [tenant?.id, nicheId]);

  useEffect(() => { load(); }, [load]);

  const addRule = useCallback(async (input: Parameters<typeof createRepricingRule>[1]) => {
    if (!tenant) return { error: 'No tenant' };
    const { rule, error } = await createRepricingRule(tenant.id, input);
    if (rule) setRules(prev => [rule, ...prev]);
    return { rule, error };
  }, [tenant?.id, nicheId]);

  const toggleRule = useCallback(async (ruleId: string, isActive: boolean) => {
    const { error } = await toggleRepricingRule(ruleId, isActive);
    if (!error) setRules(prev => prev.map(r => r.id === ruleId ? { ...r, isActive } : r));
    return { error };
  }, [tenant?.id, nicheId]);

  const removeRule = useCallback(async (ruleId: string) => {
    const { error } = await deleteRepricingRule(ruleId);
    if (!error) setRules(prev => prev.filter(r => r.id !== ruleId));
    return { error };
  }, []);

  const getAISuggestion = useCallback(async (listing: StaleListingInfo) => {
    if (!tenant) return;
    setSuggestionLoading(prev => ({ ...prev, [listing.id]: true }));
    const { suggestion, error } = await getAIRepriceSuggestion(listing.id, tenant.id, nicheId);
    setSuggestionLoading(prev => ({ ...prev, [listing.id]: false }));
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
  }, [tenant?.id]);

  const applyPrice = useCallback(async (listingId: string, newPrice: number) => {
    const { error } = await applyReprice(listingId, newPrice, tenant?.id ?? '', nicheId);
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
  }, []);

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
