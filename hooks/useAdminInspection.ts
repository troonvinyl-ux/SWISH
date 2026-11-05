import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/template';
import { loadAdminInspection, type AdminInspection, type AdminInspectionSection } from '@/services/commandCentreService';
import type { ProductionNicheId } from '@/constants/niches';
export function useAdminInspection(enabled: boolean, initialNicheId: ProductionNicheId | null = null) {
 const { user } = useAuth(); const [section, setSection] = useState<AdminInspectionSection>(initialNicheId ? 'inventory' : 'users');
 const [nicheId, setNicheId] = useState<ProductionNicheId | null>(initialNicheId);
 const key = `${user?.id ?? ''}:${enabled}:${section}:${nicheId ?? ''}`; const current = useRef(key); current.current = key;
 const generation = useRef(0); const [state, setState] = useState({ key: '', inspection: null as AdminInspection | null, error: null as string | null, loading: false });
 const refresh = useCallback(async () => {
  if (!enabled || !user) return;
  const version = ++generation.current; setState({ key, inspection: null, error: null, loading: true });
  const result = await loadAdminInspection(section, nicheId);
  if (key === current.current && version === generation.current) setState({ key, ...result, loading: false });
 }, [enabled, user?.id, section, nicheId, key]);
 useEffect(() => { void refresh(); return () => { generation.current++; }; }, [refresh]);
 return { section, setSection, nicheId, setNicheId, refresh, inspection: enabled && state.key === key ? state.inspection : null, error: state.key === key ? state.error : null, loading: enabled && (state.key !== key || state.loading) };
}
