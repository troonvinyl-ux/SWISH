// SWISH Exception Service
// Surfaces and manages operational exceptions requiring human attention.

import { getSupabaseClient } from '@/template';

export interface SwishException {
  id: string;
  tenantId: string;
  exceptionType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  detail: string;
  entityType?: string;
  entityId?: string;
  recommendedAction?: string;
  actionLabel?: string;
  isResolved: boolean;
  resolvedAt?: string;
  resolutionNotes?: string;
  autoResolvable: boolean;
  createdAt: string;
}

function mapException(row: any): SwishException {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    exceptionType: row.exception_type,
    severity: row.severity as SwishException['severity'],
    title: row.title,
    detail: row.detail ?? '',
    entityType: row.entity_type ?? undefined,
    entityId: row.entity_id ?? undefined,
    recommendedAction: row.recommended_action ?? undefined,
    actionLabel: row.action_label ?? undefined,
    isResolved: row.is_resolved ?? false,
    resolvedAt: row.resolved_at ?? undefined,
    resolutionNotes: row.resolution_notes ?? undefined,
    autoResolvable: row.auto_resolvable ?? false,
    createdAt: row.created_at,
  };
}

export async function listExceptions(
  tenantId: string,
  includeResolved = false
): Promise<{ exceptions: SwishException[]; error: string | null }> {
  const supabase = getSupabaseClient();
  let query = supabase
    .from('exceptions')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (!includeResolved) {
    query = query.eq('is_resolved', false);
  }

  const { data, error } = await query;
  if (error) return { exceptions: [], error: error.message };
  return { exceptions: (data ?? []).map(mapException), error: null };
}

export async function resolveException(
  id: string,
  notes?: string
): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('exceptions')
    .update({
      is_resolved: true,
      resolved_at: new Date().toISOString(),
      resolution_notes: notes ?? 'Resolved by user',
    })
    .eq('id', id);
  return { error: error?.message ?? null };
}

export async function createException(
  tenantId: string,
  input: Omit<SwishException, 'id' | 'tenantId' | 'isResolved' | 'createdAt' | 'resolvedAt' | 'resolutionNotes'>
): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('exceptions').insert({
    tenant_id: tenantId,
    exception_type: input.exceptionType,
    severity: input.severity,
    title: input.title,
    detail: input.detail,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    recommended_action: input.recommendedAction ?? null,
    action_label: input.actionLabel ?? null,
    auto_resolvable: input.autoResolvable ?? false,
  });
  return { error: error?.message ?? null };
}

// Generate exceptions from current inventory/business state
export async function scanForExceptions(tenantId: string, opts?: { skipStaleListings?: boolean }): Promise<void> {
  const supabase = getSupabaseClient();

  // Check for review_required items
  const { data: reviewItems } = await supabase
    .from('items')
    .select('id, canonical_title, identification_confidence')
    .eq('tenant_id', tenantId)
    .eq('status', 'review_required')
    .limit(20);

  if (reviewItems && reviewItems.length > 0) {
    // Check if this exception already exists unresolved
    const { count } = await supabase
      .from('exceptions')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('exception_type', 'low_confidence_id')
      .eq('is_resolved', false);

    if ((count ?? 0) === 0) {
      await createException(tenantId, {
        exceptionType: 'low_confidence_id',
        severity: 'medium',
        title: `${reviewItems.length} items need identification review`,
        detail: `${reviewItems.length} items have low AI confidence and require manual verification before listing.`,
        entityType: 'item',
        recommendedAction: 'open_inventory',
        actionLabel: 'Review Items',
        autoResolvable: false,
      });
    }
  }

  // Check for stale listings needing reprice (7+ days listed)
  if (!opts?.skipStaleListings) {
    const repricingStale = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { count: repricingCount } = await supabase
      .from('listings')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .in('status', ['active', 'published', 'draft'])
      .lt('updated_at', repricingStale);

    if ((repricingCount ?? 0) > 0) {
      const { count: existingReprice } = await supabase
        .from('exceptions')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('exception_type', 'stale_listings_reprice')
        .eq('is_resolved', false);

      if ((existingReprice ?? 0) === 0) {
        await createException(tenantId, {
          exceptionType: 'stale_listings_reprice',
          severity: (repricingCount ?? 0) > 10 ? 'high' : 'medium',
          title: `${repricingCount} listing${(repricingCount ?? 0) === 1 ? '' : 's'} may need repricing`,
          detail: `${repricingCount} listing${(repricingCount ?? 0) === 1 ? ' has' : 's have'} been active 7+ days without a sale. AI repricing suggestions available.`,
          entityType: 'listing',
          recommendedAction: 'open_repricing',
          actionLabel: 'Open Repricing Engine',
          autoResolvable: true,
        });
      }
    }
  }

  // Check for stale listings (14+ days listed without sale)
  const staleDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { count: staleCount } = await supabase
    .from('items')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('status', 'listed')
    .lt('updated_at', staleDate);

  if ((staleCount ?? 0) > 3) {
    const { count: existingStale } = await supabase
      .from('exceptions')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('exception_type', 'unusual_price_movement')
      .eq('is_resolved', false);

    if ((existingStale ?? 0) === 0) {
      await createException(tenantId, {
        exceptionType: 'unusual_price_movement',
        severity: 'low',
        title: `${staleCount} listings may need repricing`,
        detail: `${staleCount} items have been listed for 14+ days without a sale. Consider repricing or relisting.`,
        entityType: 'item',
        recommendedAction: 'open_inventory',
        actionLabel: 'Review Listings',
        autoResolvable: true,
      });
    }
  }
}

export const SEVERITY_CONFIG: Record<SwishException['severity'], {
  color: string; label: string; icon: string;
}> = {
  critical: { color: '#EF4444', label: 'Critical', icon: 'error' },
  high: { color: '#F97316', label: 'High', icon: 'warning' },
  medium: { color: '#F59E0B', label: 'Medium', icon: 'info' },
  low: { color: '#06B6D4', label: 'Low', icon: 'notifications' },
};
