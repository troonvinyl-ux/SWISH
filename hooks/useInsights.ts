// useInsights — real OnSpace Cloud data
import { useState, useEffect, useCallback } from 'react';
import { useApp } from './useApp';
import {
  AIInsight,
  BusinessMetrics,
  WealthSnapshot,
  SpecialistPerformance,
  CapitalAnalysis,
  PredictionPerformance,
  TopItem,
  AcquisitionLeaderEntry,
  WeekDay,
  listInsights,
  computeBusinessMetrics,
  computeWealthSnapshot,
  computeCapitalAnalysis,
  computeSpecialistPerformance,
  getRealPredictionPerformance,
  getTopItems,
  getAcquisitionLeaderboard,
  getWeeklyRevenue,
  getActiveListingsCount,
} from '@/services/insightsService';

export function useDashboard() {
  const { tenant } = useApp();
  const [metrics, setMetrics] = useState<BusinessMetrics | null>(null);
  const [insights, setInsights] = useState<AIInsight[]>([]);
  const [wealth, setWealth] = useState<WealthSnapshot | null>(null);
  const [topItems, setTopItems] = useState<TopItem[]>([]);
  const [acquisitionLeaderboard, setAcquisitionLeaderboard] = useState<AcquisitionLeaderEntry[]>([]);
  const [specialistBreakdown, setSpecialistBreakdown] = useState<SpecialistPerformance[]>([]);
  const [weeklyRevenue, setWeeklyRevenue] = useState<WeekDay[]>([]);
  const [activeListings, setActiveListings] = useState<number>(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    const [
      metricsResult,
      insightsResult,
      wealthResult,
      topItemsResult,
      leaderboardResult,
      specialistResult,
      weeklyResult,
      activeListingsResult,
    ] = await Promise.all([
      computeBusinessMetrics(tenant.id),
      listInsights(tenant.id),
      computeWealthSnapshot(tenant.id),
      getTopItems(tenant.id, 5),
      getAcquisitionLeaderboard(tenant.id),
      computeSpecialistPerformance(tenant.id),
      getWeeklyRevenue(tenant.id),
      getActiveListingsCount(tenant.id),
    ]);
    setMetrics(metricsResult.metrics);
    setInsights(insightsResult.insights);
    setWealth(wealthResult);
    setTopItems(topItemsResult);
    setAcquisitionLeaderboard(leaderboardResult);
    setSpecialistBreakdown(specialistResult.sort((a, b) => b.itemCount - a.itemCount));
    setWeeklyRevenue(weeklyResult);
    setActiveListings(activeListingsResult);
    setLoading(false);
  }, [tenant?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const criticalInsights = insights.filter((i) => i.priority === 'critical');

  return {
    metrics, insights, criticalInsights, wealth,
    topItems, acquisitionLeaderboard, specialistBreakdown,
    weeklyRevenue, activeListings,
    loading, reload: load,
  };
}

export function useInsightsAnalytics() {
  const { tenant } = useApp();
  const [specialistPerf, setSpecialistPerf] = useState<SpecialistPerformance[]>([]);
  const [capital, setCapital] = useState<CapitalAnalysis | null>(null);
  const [predictions, setPredictions] = useState<PredictionPerformance[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tenant) return;
    let active = true;
    async function load() {
      setLoading(true);
      const [specResult, capResult, predResult] = await Promise.all([
        computeSpecialistPerformance(tenant!.id),
        computeCapitalAnalysis(tenant!.id),
        getRealPredictionPerformance(tenant!.id),
      ]);
      if (!active) return;
      setSpecialistPerf(specResult);
      setCapital(capResult);
      setPredictions(predResult);
      setLoading(false);
    }
    load();
    return () => { active = false; };
  }, [tenant?.id]);

  return { specialistPerf, capital, predictions, loading };
}
