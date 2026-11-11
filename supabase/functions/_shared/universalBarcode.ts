// Shared orchestration inside the existing authenticated barcode endpoint. Warm-instance caches are only an optimization.
import { catalogueGtin } from './quickListBarcode.ts';
import { lookupAIBarcode, type AIBarcodeConfig } from './aiBarcodeLookup.ts';
import { BARCODE_ENGINE_VERSION, mergeBarcodeLeads, type BarcodeMergeLead } from './barcodeIdentification.ts';
export interface UniversalBarcodeResult { gtin: string; products: BarcodeMergeLead[]; status: 'candidates' | 'no_match' | 'unavailable' | 'invalid'; message: string; warnings: string[]; cached: boolean; durationMs: number }
interface Dependencies { ai: AIBarcodeConfig; catalogue: () => Promise<{ products: BarcodeMergeLead[]; message?: string; status: string }>; music?: () => Promise<{ products: BarcodeMergeLead[]; message?: string; status: string }>; reserveAI: () => Promise<boolean>; requestFetch?: typeof fetch; cacheMs?: number }
export function createUniversalBarcodeEngine() {
  const cache = new Map<string, { until: number; result: UniversalBarcodeResult }>();
  const flights = new Map<string, Promise<UniversalBarcodeResult>>();
  return function lookup(scope: string, value: string, dependencies: Dependencies): Promise<UniversalBarcodeResult> {
    const gtin = catalogueGtin(value), start = Date.now();
    const empty = (status: UniversalBarcodeResult['status'], message: string): UniversalBarcodeResult => ({ gtin: gtin ?? '', products: [], status, message, warnings: [], cached: false, durationMs: Date.now() - start });
    if (!gtin) return Promise.resolve(empty('invalid', 'Barcode check digit is invalid. Rescan or edit the code.'));
    const key = `${BARCODE_ENGINE_VERSION}:${scope}:${dependencies.ai.provider ?? 'gemini'}:${dependencies.ai.webResearch === true}:${gtin.padStart(14, '0')}`;
    const cached = cache.get(key);
    if (cached && cached.until > Date.now()) return Promise.resolve({ ...cached.result, cached: true, durationMs: 0 });
    if (cached) cache.delete(key);
    const flight = flights.get(key); if (flight) return flight;
    if (flights.size >= 128) return Promise.resolve(empty('unavailable', 'Barcode service is busy. Retry shortly.'));
    const run = async (): Promise<UniversalBarcodeResult> => {
      const unavailable = { products: [] as BarcodeMergeLead[], status: 'unavailable', message: 'Catalogue lookup could not complete.' };
      // Each job is independent: one failed API or exhausted AI budget cannot erase another source's result.
      const settle = (job: Promise<{ products: BarcodeMergeLead[]; status: string; message?: string }>) => job.then(result=>result&&Array.isArray(result.products)?result:unavailable).catch(()=>unavailable);
      const catalogue = settle(Promise.resolve().then(dependencies.catalogue));
      const music = dependencies.music ? settle(Promise.resolve().then(dependencies.music)) : Promise.resolve({ products: [] as BarcodeMergeLead[], status: 'not_applicable', message: '' });
      const ai = (async () => {
        try { if (!await dependencies.reserveAI()) return { ...unavailable, message: 'AI lookup budget reached or usage tracking unavailable. Catalogue results remain available.' }; return await lookupAIBarcode(gtin, dependencies.ai, dependencies.requestFetch); }
        catch { return { ...unavailable, message: 'AI usage tracking unavailable; no paid call was made.' }; }
      })();
      const results = await Promise.all([catalogue, music, ai]);
      const products = mergeBarcodeLeads(results.map(result => result.products.filter(product => product && typeof product.title==='string' && product.title.trim() && product.specifics && typeof product.specifics==='object' && catalogueGtin(product.gtin)?.padStart(14, '0') === gtin.padStart(14, '0'))));
      const warnings = results.filter(result => result.status === 'unavailable').map(result => result.message || 'One lookup source was unavailable.');
      const status = products.length ? 'candidates' : warnings.length ? 'unavailable' : 'no_match';
      const result: UniversalBarcodeResult = { gtin, products, status, warnings, cached: false, durationMs: Date.now() - start, message: products.length ? products.length > 1 ? 'Choose the matching product or edition. Different candidates were retained for review.' : products[0].verificationStatus === 'catalogue_verified' ? 'Verified catalogue barcode association. Check your item; any AI supplements remain suggestions.' : 'AI-suggested identification. Confirm or edit the product; photos are optional at this step.' : warnings.length ? 'Lookup incomplete. Retry, choose another provider or add photos.' : 'No credible product match. Rescan, edit details manually or use photos.' };
      if (status !== 'unavailable') {
        cache.set(key, { until: Date.now() + (products.length ? Math.max(1000, Math.min(3600000, dependencies.cacheMs ?? 300000)) : 30000), result });
        if (cache.size > 512) cache.delete(cache.keys().next().value!);
      }
      return result;
    };
    const pending = run().finally(() => flights.delete(key)); flights.set(key, pending); return pending;
  };
}
export const lookupUniversalBarcode = createUniversalBarcodeEngine();
