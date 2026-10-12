// SWISH Tenant Service
// Manages tenant provisioning, membership, and settings.

import { getSupabaseClient } from '@/template';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  subscriptionTier: string;
  activeSpecialists: string[];
  settings: TenantSettings;
  createdAt: string;
  updatedAt: string;
}

export interface TenantSettings {
  currency: string;
  highValueThreshold: number;
  automationLevel: string;
  defaultMarketplaces: string[];
  minMargin: number;
  minROI: number;
  maxAcquisitionBudget: number;
}

export interface TenantMembership {
  id: string;
  tenantId: string;
  userId: string;
  role: string;
  isOwner: boolean;
  createdAt: string;
}

function mapTenant(row: any): Tenant {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    subscriptionTier: row.subscription_tier,
    activeSpecialists: row.active_specialists ?? [],
    settings: row.settings ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Get all tenants the current user belongs to
export async function getUserTenants(): Promise<{ tenants: Tenant[]; error: string | null }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('tenants')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) return { tenants: [], error: error.message };
  return { tenants: (data ?? []).map(mapTenant), error: null };
}

// Get the user's primary (first/only) tenant
export async function getUserPrimaryTenant(): Promise<{ tenant: Tenant | null; error: string | null }> {
  const { tenants, error } = await getUserTenants();
  if (error) return { tenant: null, error };
  return { tenant: tenants[0] ?? null, error: null };
}

// Provision a brand-new tenant for a user on first signup
export async function provisionTenant(
  userId: string,
  tenantName: string
): Promise<{ tenantId: string | null; error: string | null }> {
  const supabase = getSupabaseClient();
  const slug = tenantName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) + '-' + Date.now().toString(36);

  const { data, error } = await supabase.rpc('swish_provision_tenant', {
    p_user_id: userId,
    p_tenant_name: tenantName,
    p_slug: slug,
  });

  if (error) return { tenantId: null, error: error.message };
  return { tenantId: data, error: null };
}

// Check if user has any tenant — used on first login
export async function checkUserHasTenant(userId: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from('tenant_memberships')
    .select('id')
    .eq('user_id', userId)
    .limit(1)
    .single();
  return !!data;
}

// Update tenant settings
export async function updateTenantSettings(
  tenantId: string,
  settings: Partial<TenantSettings>
): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('tenants')
    .update({ settings })
    .eq('id', tenantId);
  return { error: error?.message ?? null };
}
