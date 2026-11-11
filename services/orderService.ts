// SWISH Order & Fulfilment Service
// Manages the post-sale lifecycle: order intake, fulfilment, tracking, returns, reconciliation.

import { getSupabaseClient } from '@/template';
import { markItemSold } from '@/services/itemService';
import { getProductionNicheSpecialistIds } from '@/services/nicheRouting';

export type OrderStatus =
  | 'pending'
  | 'payment_received'
  | 'picked'
  | 'packed'
  | 'dispatched'
  | 'delivered'
  | 'completed'
  | 'cancelled'
  | 'return_requested'
  | 'returned'
  | 'disputed';

export interface Order {
  id: string;
  tenantId: string;
  itemId?: string;
  listingId?: string;
  saleId?: string;
  marketplaceId: string;
  externalOrderId?: string;
  buyerName?: string;
  buyerEmail?: string;
  buyerAddress: Record<string, string>;
  status: OrderStatus;
  salePrice: number;
  marketplaceFee: number;
  shippingCost: number;
  packagingCost: number;
  netRevenue: number;
  trackingNumber?: string;
  carrier?: string;
  dispatchedAt?: string;
  deliveredAt?: string;
  returnReason?: string;
  resolutionNotes?: string;
  requiresAction: boolean;
  actionRequired?: string;
  // joined
  itemTitle?: string;
  listingTitle?: string;
  createdAt: string;
  updatedAt: string;
}

export const ORDER_STATUS_CONFIG: Record<OrderStatus, {
  label: string;
  color: string;
  icon: string;
  nextStatus?: OrderStatus;
  nextLabel?: string;
}> = {
  pending: { label: 'Waiting for payment', color: '#F59E0B', icon: 'hourglass-empty', nextStatus: 'payment_received', nextLabel: 'Mark Paid' },
  payment_received: { label: 'Payment Received', color: '#3B82F6', icon: 'payments', nextStatus: 'picked', nextLabel: 'Mark Picked' },
  picked: { label: 'Picked', color: '#8B5CF6', icon: 'inventory', nextStatus: 'packed', nextLabel: 'Mark Packed' },
  packed: { label: 'Packed', color: '#6366F1', icon: 'inventory-2', nextStatus: 'dispatched', nextLabel: 'Mark Dispatched' },
  dispatched: { label: 'Dispatched', color: '#06B6D4', icon: 'local-shipping', nextStatus: 'delivered', nextLabel: 'Mark Delivered' },
  delivered: { label: 'Delivered', color: '#10B981', icon: 'check-circle', nextStatus: 'completed', nextLabel: 'Complete' },
  completed: { label: 'Completed', color: '#10B981', icon: 'task-alt' },
  cancelled: { label: 'Cancelled', color: '#EF4444', icon: 'cancel' },
  return_requested: { label: 'Return Requested', color: '#F97316', icon: 'keyboard-return', nextStatus: 'returned', nextLabel: 'Process Return' },
  returned: { label: 'Returned', color: '#EF4444', icon: 'assignment-return' },
  disputed: { label: 'Disputed', color: '#EF4444', icon: 'gavel' },
};

function mapOrder(row: any): Order {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    itemId: row.item_id ?? undefined,
    listingId: row.listing_id ?? undefined,
    saleId: row.sale_id ?? undefined,
    marketplaceId: row.marketplace_id,
    externalOrderId: row.external_order_id ?? undefined,
    buyerName: row.buyer_name ?? undefined,
    buyerEmail: row.buyer_email ?? undefined,
    buyerAddress: row.buyer_address ?? {},
    status: row.status as OrderStatus,
    salePrice: Number(row.sale_price ?? 0),
    marketplaceFee: Number(row.marketplace_fee ?? 0),
    shippingCost: Number(row.shipping_cost ?? 0),
    packagingCost: Number(row.packaging_cost ?? 0),
    netRevenue: Number(row.net_revenue ?? 0),
    trackingNumber: row.tracking_number ?? undefined,
    carrier: row.carrier ?? undefined,
    dispatchedAt: row.dispatched_at ?? undefined,
    deliveredAt: row.delivered_at ?? undefined,
    returnReason: row.return_reason ?? undefined,
    resolutionNotes: row.resolution_notes ?? undefined,
    requiresAction: row.requires_action ?? false,
    actionRequired: row.action_required ?? undefined,
    itemTitle: row.items?.canonical_title ?? undefined,
    listingTitle: row.listings?.title ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function listOrders(
  tenantId: string,
  filters?: { status?: OrderStatus; requiresAction?: boolean; nicheId?: string }
): Promise<{ orders: Order[]; error: string | null }> {
  if (!tenantId?.trim()) return { orders: [], error: 'tenantId is required.' };
  const specialists = filters?.nicheId ? getProductionNicheSpecialistIds(filters.nicheId) : [];
  if (filters?.nicheId && !specialists.length) return { orders: [], error: 'Registered niche required.' };
  const supabase = getSupabaseClient();
  let query = supabase
    .from('orders')
    .select(filters?.nicheId ? '*, items!inner(canonical_title,specialist_id,tenant_id), listings(title)' : '*, items(canonical_title), listings(title)')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (filters?.nicheId) query = query.eq('items.tenant_id', tenantId).in('items.specialist_id', specialists);
  if (filters?.status) query = query.eq('status', filters.status);
  if (filters?.requiresAction) query = query.eq('requires_action', true);

  const { data, error } = await query;
  if (error) return { orders: [], error: error.message };
  return { orders: (data ?? []).map(mapOrder), error: null };
}

export async function getOrder(id: string, tenantId: string, nicheId?: string): Promise<{ order: Order | null; error: string | null }> {
  if (!tenantId) return { order: null, error: 'tenantId is required.' };
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('orders')
    .select('*, items(canonical_title), listings(title)')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single();

  if (error || !data) return { order: null, error: error?.message ?? 'Order not found.' };
  if (nicheId) {
    const ids = getProductionNicheSpecialistIds(nicheId);
    const { data: owned, error: ownershipError } = await supabase.from('items').select('id')
      .eq('id', data.item_id).eq('tenant_id', tenantId).in('specialist_id', ids).maybeSingle();
    if (!ids.length || ownershipError || !owned) return { order: null, error: 'Order is outside this specialist inventory.' };
  }
  return { order: mapOrder(data), error: null };
}

export async function createOrder(
  tenantId: string,
  input: {
    itemId?: string;
    listingId?: string;
    marketplaceId: string;
    externalOrderId?: string;
    buyerName?: string;
    buyerEmail?: string;
    buyerAddress?: Record<string, string>;
    salePrice: number;
    marketplaceFee?: number;
    shippingCost?: number;
    packagingCost?: number;
  }
): Promise<{ order: Order | null; error: string | null }> {
  const supabase = getSupabaseClient();

  if (!tenantId) return { order: null, error: 'tenantId is required.' };

  // Validate linked records before creating a tenant-owned order. This prevents
  // a caller from linking another tenant's item or listing by supplying its ID.
  if (input.itemId) {
    const { data: linkedItem, error: linkedItemError } = await supabase
      .from('items').select('id').eq('id', input.itemId).eq('tenant_id', tenantId).maybeSingle();
    if (linkedItemError || !linkedItem) return { order: null, error: 'Inventory item not found or access denied.' };
  }
  if (input.listingId) {
    const { data: linkedListing, error: linkedListingError } = await supabase
      .from('listings').select('id, item_id').eq('id', input.listingId).eq('tenant_id', tenantId).maybeSingle();
    if (linkedListingError || !linkedListing) return { order: null, error: 'Listing not found or access denied.' };
    if (input.itemId && linkedListing.item_id && linkedListing.item_id !== input.itemId) {
      return { order: null, error: 'The selected listing does not belong to the selected inventory item.' };
    }
  }

  // Use actual marketplace fee when provided. The fallback (12.75%) is an indicative
  // estimate for eBay UK — actual fees vary by category, price tier and seller level.
  // Label as ESTIMATE in any user-facing display. Never present as exact.
  const marketplaceFee = input.marketplaceFee ?? input.salePrice * 0.1275; // ESTIMATE if not provided
  const shippingCost = input.shippingCost ?? 0;
  const packagingCost = input.packagingCost ?? 0;
  const netRevenue = input.salePrice - marketplaceFee - shippingCost - packagingCost;

  const { data, error } = await supabase
    .from('orders')
    .insert({
      tenant_id: tenantId,
      item_id: input.itemId ?? null,
      listing_id: input.listingId ?? null,
      marketplace_id: input.marketplaceId,
      external_order_id: input.externalOrderId ?? null,
      buyer_name: input.buyerName ?? null,
      buyer_email: input.buyerEmail ?? null,
      buyer_address: input.buyerAddress ?? {},
      status: 'payment_received',
      sale_price: input.salePrice,
      marketplace_fee: marketplaceFee,
      shipping_cost: shippingCost,
      packaging_cost: packagingCost,
      net_revenue: netRevenue,
      requires_action: true,
      action_required: 'Pack and dispatch this order',
    })
    .select('*, items(canonical_title), listings(title)')
    .single();

  if (error) return { order: null, error: error.message };

  // Update item through the atomic lifecycle command so the sale and audit trail agree.
  if (input.itemId) {
    const transition = await markItemSold(input.itemId, tenantId, {
      soldPrice: input.salePrice,
      marketplace: input.marketplaceId,
    });
    if (transition.error) {
      return { order: mapOrder(data), error: `Order was created, but inventory could not be transitioned to sold: ${transition.error}` };
    }
  }

  return { order: mapOrder(data), error: null };
}

export async function updateOrderStatus(
  orderId: string,
  tenantId: string,
  status: OrderStatus,
  extra?: {
    trackingNumber?: string;
    carrier?: string;
    returnReason?: string;
    resolutionNotes?: string;
  }
): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient();

  const updates: Record<string, any> = {
    status,
    updated_at: new Date().toISOString(),
  };

  if (status === 'dispatched') {
    updates.dispatched_at = new Date().toISOString();
    updates.requires_action = false;
    updates.action_required = null;
    if (extra?.trackingNumber) updates.tracking_number = extra.trackingNumber;
    if (extra?.carrier) updates.carrier = extra.carrier;
  } else if (status === 'delivered' || status === 'completed') {
    updates.delivered_at = new Date().toISOString();
    updates.requires_action = false;
    updates.action_required = null;
  } else if (status === 'return_requested') {
    updates.requires_action = true;
    updates.action_required = 'Process buyer return request';
    if (extra?.returnReason) updates.return_reason = extra.returnReason;
  } else if (status === 'returned') {
    updates.requires_action = false;
    if (extra?.resolutionNotes) updates.resolution_notes = extra.resolutionNotes;
  } else if (status === 'disputed') {
    updates.requires_action = true;
    updates.action_required = 'Resolve buyer dispute';
  } else if (status === 'cancelled') {
    updates.requires_action = false;
  }

  if (!tenantId) return { error: 'tenantId is required.' };
  const current=await supabase.from('orders').select('marketplace_id,external_order_id').eq('id',orderId).eq('tenant_id',tenantId).maybeSingle();
  if(current.error||!current.data)return {error:'Order not found in this workspace.'};
  if(current.data.marketplace_id==='ebay'&&current.data.external_order_id)return {error:'Use shared Seller Hub order actions; eBay payment and delivery cannot be marked manually.'};
  const { data: updated, error } = await supabase.from('orders').update(updates).eq('id', orderId).eq('tenant_id', tenantId).select('id').maybeSingle();
  return { error: error?.message ?? (updated ? null : 'Order update was not authorized or confirmed.') };
}

// ── Order Statistics ────────────────────────────────────────────────────────

export async function getOrderStats(tenantId: string): Promise<{
  total: number;
  pending: number;
  dispatched: number;
  completed: number;
  requiresAction: number;
  totalRevenue: number;
  avgOrderValue: number;
}> {
  const supabase = getSupabaseClient();

  const { data } = await supabase
    .from('orders')
    .select('status, requires_action, sale_price, net_revenue')
    .eq('tenant_id', tenantId);

  const orders = data ?? [];
  const total = orders.length;
  const pending = orders.filter(o => ['pending', 'payment_received', 'picked', 'packed'].includes(o.status)).length;
  const dispatched = orders.filter(o => o.status === 'dispatched').length;
  const completed = orders.filter(o => o.status === 'completed').length;
  const requiresAction = orders.filter(o => o.requires_action).length;
  const totalRevenue = orders.filter(o => o.status === 'completed').reduce((s, o) => s + Number(o.net_revenue ?? 0), 0);
  const avgOrderValue = completed > 0 ? totalRevenue / completed : 0;

  return { total, pending, dispatched, completed, requiresAction, totalRevenue, avgOrderValue };
}
