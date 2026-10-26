// useAcquisitions — real OnSpace Cloud data
import { useState, useEffect, useCallback } from 'react';
import { useApp } from './useApp';
import {
  Acquisition,
  listAcquisitions,
  createAcquisition,
  getAcquisition,
} from '@/services/acquisitionService';
import {
  DecompositionResult,
  runDecomposition as runDecompositionService,
} from '@/services/decompositionService';
import { Item, listItems } from '@/services/itemService';

export function useAcquisitions() {
  const { tenant } = useApp();
  const [acquisitions, setAcquisitions] = useState<Acquisition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    setError(null);
    const { acquisitions: data, error: err } = await listAcquisitions(tenant.id);
    setAcquisitions(data);
    if (err) setError(err);
    setLoading(false);
  }, [tenant?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const addAcquisition = useCallback(async (input: {
    title: string;
    source?: string;
    purchasePrice?: number;
    notes?: string;
  }) => {
    if (!tenant) return;
    const { acquisition, error: err } = await createAcquisition(tenant.id, input);
    if (acquisition) {
      setAcquisitions((prev) => [acquisition, ...prev]);
    }
    return { error: err };
  }, [tenant?.id]);

  return { acquisitions, loading, error, addAcquisition, reload: load };
}

export function useAcquisitionDetail(acquisitionId: string) {
  const [acquisition, setAcquisition] = useState<Acquisition | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [decomposition, setDecomposition] = useState<DecompositionResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [decomposing, setDecomposing] = useState(false);
  const { tenant } = useApp();

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      const [acqResult, itemsResult] = await Promise.all([
        getAcquisition(acquisitionId),
        tenant ? listItems(tenant.id, { acquisitionId }) : Promise.resolve({ items: [], error: null }),
      ]);
      if (!active) return;
      setAcquisition(acqResult.acquisition);
      setItems(itemsResult.items);
      setLoading(false);
    }
    load();
    return () => { active = false; };
  }, [acquisitionId, tenant?.id]);

  const runDecomposition = useCallback(async () => {
    if (!acquisition || !tenant?.id) return;
    setDecomposing(true);
    try {
      const response = await runDecompositionService(tenant.id, acquisition.id, {
        acquisitionTitle: acquisition.title,
        acquisitionDescription: acquisition.description,
        acquisitionSource: acquisition.source,
        purchasePrice: acquisition.purchasePrice,
        itemCount: acquisition.itemCount,
        existingItems: items.map(item => ({
          title: item.canonicalTitle,
          specialist: item.specialistId,
          valuationMid: item.valuationMid,
          condition: item.condition,
        })),
      });
      if (response.error || !response.result) {
        throw new Error(response.error ?? 'The decomposition service returned no result.');
      }
      setDecomposition(response.result);
    } finally {
      setDecomposing(false);
    }
  }, [acquisition, items, tenant?.id]);

  return { acquisition, items, decomposition, loading, decomposing, runDecomposition };
}
