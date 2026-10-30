import type { LotLine, LotAssumptions, LotEvaluation } from './lotEconomicsService';
import { lineBlocked } from './lotEconomicsService';
import { stripSupplierHtml } from './manifestParser';
import { getSupabaseClient } from '@/template';
import { NICHE_MODULES } from '@/constants/niches';
import { resolveProductionNiche } from './nicheRouting';
import * as Crypto from 'expo-crypto';
export interface ManifestDraftUnit {
  key: string; title: string; quantity: number; physicalUnits: number; price: number;
  condition: string; description: string; media: string[]; sku: string; attributes: Record<string, unknown>;
  ready: boolean; reasons: string[];
}
export function compileManifestDrafts(lines: LotLine[], a: LotAssumptions, strategy: 'individual' | 'grouped' | 'whole'): ManifestDraftUnit[] {
  const make = (rows: LotLine[], pack: number, count: number, price: number, suffix: string): ManifestDraftUnit => {
    const row = rows[0];
    const text = rows.length > 1 ? `Mixed job lot: ${rows.length} product lines` : stripSupplierHtml(row.title);
    const title = `${pack > 1 ? `Bundle of ${pack}: ` : ''}${text}`.slice(0, 80);
    const reasons = rows.flatMap(r => [
      ...(!r.inspected ? ['Inspect actual identity, sellable quantity, condition, accessories and functionality.'] : []),
      ...(lineBlocked(r) ? ['Safety-critical item needs competent safety/provenance verification.'] : []),
      ...(!r.include ? ['Excluded from sale plan; retain for inspection/disposal.'] : []),
      ...(r.currency !== 'GBP' ? ['Convert currency first.'] : []),
    ]);
    if (price <= 0) reasons.push('Enter a reviewed listing price.');
    if (rows.length !== 1 || !row.categoryId || !row.taxonomyChecked) reasons.push('Select an eBay category and retrieve its required specifics.');
    if (rows.some(r => r.priceSource === 'rrp_assumption')) reasons.push('Review the RRP-derived price assumption.');
    for (const required of row.requiredSpecifics ?? []) if (!row.specifics?.some(s => s.name.toLowerCase() === required.toLowerCase() && s.value.trim())) reasons.push(`Missing required eBay specific: ${required}.`);
    if (!row.images.length) reasons.push('Add actual product photos in the listing editor.');
    if (rows.some(r => !r.condition.trim() || /customer return/i.test(r.condition))) reasons.push('Replace supplier return status with inspected item condition.');
    const description = `Sale contains ${pack} unit(s) per purchase.\n${rows.map(r => `${r.sku}: ${r.title} — ${r.quantity} manifest units`).join('\n')}\nCondition: ${row.condition || 'Not inspected'}.\nSupplier descriptions and stock images are reference only. Verify contents, specifications and actual photographs before publishing. No manufacturer, safety, medical or authenticity claims are confirmed by this manifest.`;
    const specifics = rows.length === 1 ? row.specifics ?? (row.brand && row.brand.length <= 65 ? [{ name: 'Brand', value: row.brand }] : []) : [];
    return { key: `${rows.map(r => r.id).join('|')}:${suffix}`, title, quantity: count, physicalUnits: pack * count,
      price, condition: row.condition, description, media: [...new Set(rows.flatMap(r => r.images))].slice(0, 12),
      sku: `${row.sku || 'MANIFEST'}${suffix === 'single' ? '' : '-' + suffix}`,
      attributes: { brand: rows.length === 1 ? row.brand : '', ...(rows.length === 1 && row.ean ? { ean: row.ean } : {}),
        ebay_item_specifics: specifics, ebay_category_id: rows.length === 1 ? row.categoryId ?? '' : '',
        ebay_category_name: rows.length === 1 ? row.categoryName ?? '' : '', _manifest_review_required: reasons.length > 0,
        _manifest: { rows: rows.map(r => ({ source_row: r.sourceRow, supplier_sku: r.sku, manifest_sku: r.lotSku,
          asin: r.asin, raw_ean: r.eanRaw, unit_rrp: r.unitRrp, quantity: r.quantity, supplier_description: r.description.slice(0, 2000), warnings: r.warnings })),
          units_per_sale: pack, physical_units: pack * count, strategy, price_basis: rows.every(r => r.priceSource === 'user_scenario') ? 'user_scenario' : 'rrp_assumption',
          inspection_confirmed: rows.every(r => r.inspected), review_reasons: [...new Set(reasons)] } }, ready: reasons.length === 0, reasons: [...new Set(reasons)] };
  };
  const usable = lines.filter(row => Number.isInteger(row.quantity) && row.quantity > 0);
  if (!usable.length) return [];
  if (strategy === 'whole') return [make(usable, usable.reduce((s, r) => s + r.quantity, 0), 1, a.wholeLotPrice, 'whole')];
  return usable.flatMap(row => {
    const pack = strategy === 'grouped' && Number.isInteger(row.packSize) && row.packSize > 1 ? row.packSize : 1;
    const count = Math.floor(row.quantity / pack), remainder = row.quantity % pack;
    const price = pack === 1 ? row.price : row.packPrice || row.price * pack * (1 - a.bundleDiscount);
    return [...(count > 0 ? [make([row], pack, count, price, pack === 1 ? 'single' : `pack${pack}`)] : []), ...(remainder ? [make([row], 1, remainder, row.price, 'remainder')] : [])];
  });
}
export async function manifestIdentity(lines: LotLine[], nicheId: string): Promise<string> {
  // Stable across filenames, source ordering, bid changes and grouping revisions. Never use a rounded barcode as identity.
  const identities = lines.map(r => ({ sku: r.sku, lot: r.lotSku, title: r.title, quantity: r.quantity })).sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify({ nicheId, identities }));
}
export async function savePurchasedManifest(params: { tenantId: string; nicheId: string; name: string; key: string; paidHammer: number; assumptions: LotAssumptions; units: ManifestDraftUnit[]; analysis?: LotEvaluation }): Promise<{ acquisitionId: string; itemIds: string[]; listingIds: string[]; existing: boolean }> {
  const niche = resolveProductionNiche(params.nicheId);
  if (!params.tenantId || !niche || !Number.isFinite(params.paidHammer) || params.paidHammer < 0) throw new Error('Account, niche and actual paid hammer price are required.');
  const body = { name: params.name, key: params.key, specialist: NICHE_MODULES[niche].defaultSpecialist,
    paid_hammer: params.paidHammer, assumptions: params.assumptions, units: params.units, analysis: params.analysis ?? null };
  if (JSON.stringify(body).length * 3 > 850000) throw new Error('Prepared lot is too large for one atomic save. Split the manifest before importing.');
  const { data, error } = await getSupabaseClient().rpc('swish_import_manifest_lot', { p_tenant_id: params.tenantId, p_niche_id: niche, p_lot: body });
  if (error || !data) throw new Error(error?.message ?? 'Save outcome is not confirmed. Retry the same manifest, not a new copy.');
  return data;
}
