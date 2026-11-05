import { getSupabaseClient } from '@/template';
import { backendRead } from './backendRequestService';
import { MODULE_PATHS } from './unifiedModuleRegistry';
import { isProductionNiche, type ProductionNicheId } from '@/constants/niches';
export function moduleEntryPath(id: ProductionNicheId): string { return MODULE_PATHS[id]; }
export async function restoredModule(tenantId: string): Promise<ProductionNicheId | null> {
  try { const { data, error } = await backendRead('current-module', signal => getSupabaseClient().rpc('swish_current_module').abortSignal(signal), 'access');
    return !error && data?.tenant_id === tenantId && isProductionNiche(data?.niche_id) ? data.niche_id : null;
  } catch { return null; }
}
