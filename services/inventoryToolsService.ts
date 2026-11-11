// Shared inventory utilities. No alternate inventory, auth client or niche-specific writes.
import { publishGeneratedListings, submitListingsInBulk } from './listingService';
import { getProductionNicheSpecialistIds, resolveProductionNiche } from './nicheRouting';
import type { InventoryViewItem } from './inventoryViewService';
import type { NicheConfig } from '@/constants/niches';
export interface InventoryToolLink { title: string; detail: string; icon: string; route: string }
export function inventoryMoreLinks(nicheId: string): InventoryToolLink[] {
 const common: InventoryToolLink[] = [
  { title: 'Inventory tools', detail: 'All records, archived items, bulk revalue, reidentify, publish and order sync', icon: 'inventory-2', route: '/inventory-tools' },
  { title: 'Buy a lot · split & sell', detail: 'Manifest, maximum bid and unit / bundle economics', icon: 'account-tree', route: '/lot-opportunity' },
 ];
 const niche = resolveProductionNiche(nicheId);
 const specialist: Partial<Record<string, InventoryToolLink[]>> = {
  stamps: [{ title: 'Stamp guide & time savers', detail: 'Condition terms, safe handling, perforation helper and sort-to-sell plan', icon: 'menu-book', route: '/stamp-guide' }],
  coins: [
   { title: 'Islamic & Indian Silver', detail: 'Zeno, Numista and specialist evidence', icon: 'toll', route: '/islamic-batch' },
   { title: 'Silver batch', detail: 'Shared inventory with silver-specific checks', icon: 'layers', route: '/silver-batch' },
   { title: 'Deep identification lab', detail: 'Advanced coin identification and reference checks', icon: 'manage-search', route: '/deep-id-lab' },
  ],
  motocross: [{ title: 'MX Acquisition Calculator', detail: 'Purchase, repair costs and estimated profit', icon: 'calculate', route: '/mx-acquisition' }],
  surplus_flip: [{ title: 'Import Job-lot Manifest', detail: 'Import supplier lines and match product photos', icon: 'upload-file', route: '/surplus-flip' }],
  tunes_flip: [
   { title: 'Search Discogs', detail: 'Find the exact release and pressing', icon: 'search', route: '/music-search' },
   { title: 'Music collection', detail: 'Your music-specific catalogue tools', icon: 'library-music', route: '/music-collection' },
  ],
  trading_cards: [{ title: 'Card grading', detail: 'Centering and condition assessment', icon: 'style', route: '/card-grading' }],
 };
 return [...common, ...(specialist[niche ?? ''] ?? [])];
}
/** Metadata is adapted, the physical record is not. Top-level coin fields remain visible. */
export function inventoryCardMetadata(item: InventoryViewItem, config: NicheConfig): string {
 const aliases: Record<string, unknown> = {
  denomination: item.denomination, ruler: item.ruler, mint: item.mint, material: item.material,
  year: item.yearMade, grade: item.conditionGrade || item.condition, catalogue_number: item.catalogueNumber,
 };
 const values = config.keyAttributes.map(key => {
  const value = item.attributes?.[key];
  return value === undefined || value === null || value === '' ? aliases[key] : value;
 })
  .filter((value): value is string | number => (typeof value === 'string' && value.trim().length > 0) || typeof value === 'number');
 return [...new Set(values.map(String))].slice(0, 3).join(' · ');
}
export async function publishInventoryBatch(tenantId: string, nicheId: string, tab: 'stock' | 'draft', items: InventoryViewItem[], isCurrent: () => boolean): Promise<{ live: number; total: number }> {
 const allowed = getProductionNicheSpecialistIds(nicheId);
 if (!tenantId || !allowed.length || !items.length || new Set(items.map(item => item.id)).size !== items.length || items.some(item => item.tenantId !== tenantId || !allowed.includes(item.specialist_id) || (item.inventoryTab !== undefined && item.inventoryTab !== tab) || (tab === 'draft' && (!item.listing?.id || item.listing.tenantId !== tenantId)))) throw new Error('Inventory batch scope could not be verified.');
 let live = 0, total = 0;
 // One request at a time. Stop starting seller actions after logout/module changes.
 for (const item of items) {
  if (!isCurrent()) break;
  const result = tab === 'stock'
   ? (await publishGeneratedListings([{ itemId: item.id, tenantId, categoryId: String(item.attributes?.ebay_category_id ?? '') || undefined }]))[0]
   : item.listing?.id ? (await submitListingsInBulk(tenantId, [item.listing.id]))[0]?.result : undefined;
  total++;
  if (result?.success) live++;
 }
 return { live, total };
}
