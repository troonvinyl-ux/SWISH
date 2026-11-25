import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { coinsInternationalTemplate, parseDeliveryPreferences } from './deliveryPreferences.ts';

interface DeliveryProfileScope {
  tenantId: string;
  userId: string;
  bindingId: string;
  nicheId: string;
}

export async function deliveryProfileRoute(
  db: SupabaseClient,
  scope: DeliveryProfileScope,
  body: Record<string, unknown>,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const { tenantId, userId, bindingId, nicheId } = scope;
  if (body.route === 'get_delivery_profiles') {
    const [profiles, preferred] = await Promise.all([
      db.from('swish_delivery_profiles').select('id,name,configuration,version,created_at,updated_at')
        .eq('tenant_id', tenantId).eq('user_id', userId).eq('binding_id', bindingId)
        .eq('marketplace', 'EBAY_GB').order('name'),
      db.from('swish_delivery_defaults').select('profile_id')
        .eq('tenant_id', tenantId).eq('user_id', userId).eq('binding_id', bindingId)
        .eq('marketplace', 'EBAY_GB').eq('niche_id', nicheId).maybeSingle(),
    ]);
    if (profiles.error || preferred.error) return { status: 503, data: { error: 'Delivery preferences could not be loaded.' } };
    return { status: 200, data: {
      profiles: profiles.data,
      defaultProfileId: preferred.data?.profile_id ?? null,
      template: nicheId === 'coins' ? coinsInternationalTemplate() : null,
    } };
  }

  const configuration = parseDeliveryPreferences(body.configuration);
  const version = body.expectedVersion ?? null;
  if (!configuration || (version !== null && (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1))
    || typeof body.makeDefault !== 'boolean') {
    return { status: 422, data: { error: 'Check the delivery preferences and try again.' } };
  }
  const { data, error } = await db.rpc('swish_save_delivery_profile', {
    p_tenant_id: tenantId,
    p_user_id: userId,
    p_binding_id: bindingId,
    p_niche_id: nicheId,
    p_configuration: configuration,
    p_make_default: body.makeDefault,
    p_expected_version: version,
  });
  if (error?.code === '40001') return { status: 409, data: { error: 'Delivery preferences changed. Reload before saving.' } };
  if (error?.code === '42501') return { status: 409, data: { error: 'Your eBay connection changed. Reopen delivery preferences.' } };
  if (error || !data) return { status: 503, data: { error: 'Delivery preferences could not be saved.' } };
  return { status: 200, data: { profile: data } };
}
