// Shared manifest normalisation. Supplier facts are not verified product/sales evidence.
export interface ManifestProduct {
  id: string; sourceRow: number; sku: string; lotSku: string; title: string; description: string;
  asin: string; eanRaw: string; ean: string; brand: string; category: string; subcategory: string;
  images: string[]; quantity: number; condition: string; grade: string; weightKg: number;
  currency: string; unitRrp: number; totalRrp: number; warnings: string[];
}
export interface ParsedManifest { rows: ManifestProduct[]; warnings: string[]; units: number; rrp: number; weightKg: number; declaredRrp: number | null }
const clean = (v: unknown) => /^(nan|null|undefined|n\/a)$/i.test(String(v ?? '').trim()) ? '' : String(v ?? '').trim();
const key = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
export function manifestNumber(v: unknown): number | null {
  const text = clean(v).replace(/[£$€,\s]/g, '');
  if (!text || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return null;
  const n = Number(text); return Number.isFinite(n) && n >= 0 ? n : null;
}
export function stripSupplierHtml(text: string): string {
  return text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/\s+/g, ' ').trim();
}
export function validGtin(raw: string): boolean {
  if (![8, 12, 13, 14].includes(raw.length) || !/^\d+$/.test(raw)) return false;
  let sum = 0; for (let i = raw.length - 2, j = 0; i >= 0; i--, j++) sum += Number(raw[i]) * (j % 2 === 0 ? 3 : 1);
  return (10 - sum % 10) % 10 === Number(raw[raw.length - 1]);
}
export function parseManifestText(text: string): string[][] {
  if (text.length > 2000000) throw new Error('Manifest text exceeds 2 MB. Split the manifest.');
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const table = lines.split('\n').filter(line => line.trim().startsWith('|'));
  if (table.length > 1) return table.filter(line => !/^\s*\|[\s:|\-]+\|\s*$/.test(line)).map(line =>
    line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(cell => cell.replace(/\\([_|])/g, '$1').trim()));
  const delimiter = lines.split('\n')[0].includes('\t') ? '\t' : ',';
  const matrix: string[][] = []; let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < lines.length; i++) {
    const char = lines[i];
    if (char === '"') { if (quoted && lines[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (char === delimiter && !quoted) { row.push(cell); cell = ''; }
    else if (char === '\n' && !quoted) { row.push(cell); if (row.some(v => v.trim())) matrix.push(row); row = []; cell = ''; }
    else cell += char;
  }
  if (quoted) throw new Error('Unclosed CSV quote. Check the exported file.');
  row.push(cell); if (row.some(v => v.trim())) matrix.push(row); return matrix;
}
export function normaliseManifest(matrix: unknown[][]): ParsedManifest {
  const headerIndex = matrix.findIndex(row => row.some(v => ['producttitle', 'title', 'productname'].includes(key(clean(v)))));
  if (headerIndex < 0) throw new Error('Product Title / Title header not found.');
  const headers = matrix[headerIndex].map(v => key(clean(v)));
  const column = (...names: string[]) => names.map(key).map(name => headers.indexOf(name)).find(i => i >= 0) ?? -1;
  const rows: ManifestProduct[] = []; const warnings: string[] = []; let declaredRrp: number | null = null;
  for (let i = headerIndex + 1; i < matrix.length; i++) {
    const cells = matrix[i]; const get = (...names: string[]) => clean(cells[column(...names)]);
    const title = get('Product Title', 'Title', 'Product Name');
    if (!title || /^total$/i.test(title)) {
      if (cells.some(v => /^total$/i.test(clean(v)))) declaredRrp = manifestNumber(get('Total RRP'));
      continue;
    }
    const notes: string[] = []; const q = manifestNumber(get('Quantity', 'Qty', 'Units'));
    const quantity = q !== null && Number.isInteger(q) && q > 0 && q <= 100000 ? q : 0;
    if (!quantity) notes.push('Quantity missing/invalid; excluded until corrected.');
    const eanRaw = get('EAN', 'Barcode', 'GTIN');
    // Never expand rounded scientific notation or guess discarded digits/check digits.
    const ean = validGtin(eanRaw) ? eanRaw : '';
    if (eanRaw && !ean) notes.push('EAN is rounded/scientific or fails its check digit. Read the actual label; not sent to eBay.');
    const unitRrp = manifestNumber(get('Unit RRP', 'RRP', 'Retail Price')) ?? 0;
    const totalRrp = manifestNumber(get('Total RRP')) ?? unitRrp * quantity;
    if (Math.abs(totalRrp - unitRrp * quantity) > 0.02) notes.push('Supplier line total does not match quantity × unit RRP.');
    const condition = get('Condition'); const grade = get('Grade');
    if (/return/i.test(condition) && !grade) notes.push('Ungraded customer return: functionality, completeness and condition are unknown.');
    const description = stripSupplierHtml(get('Product Description', 'Description'));
    if (/4k/i.test(title) && /1920\s*[*x×]\s*1080/i.test(description)) notes.push('Resolution claim conflicts with the specification; verify native resolution.');
    if (/\b20\b/.test(title) && /\b30 (drills|bits)/i.test(description)) notes.push('Accessory count conflicts with title; count actual contents.');
    const currency = (get('Currency') || 'GBP').toUpperCase();
    if (currency !== 'GBP') notes.push('Non-GBP row: convert and confirm prices before evaluating/importing.');
    const sku = get('Product SKU', 'SKU', 'Supplier SKU');
    rows.push({ id: `${i + 1}:${sku || title}`, sourceRow: i + 1, sku, lotSku: get('Manifest SKU', 'Lot SKU'), title,
      description, asin: get('ASIN').toUpperCase(), eanRaw, ean, brand: get('Brand'), category: get('Category Name', 'Category'),
      subcategory: get('Sub Category Name', 'Subcategory'), images: Array.from({ length: 6 }, (_, index) => get(`Image ${index + 1}`).replace(/\\_/g, '_')).filter(url => /^https:\/\//i.test(url)),
      quantity, condition, grade, weightKg: manifestNumber(get('Unit Weight (kg)', 'Weight kg')) ?? 0,
      currency, unitRrp, totalRrp, warnings: notes });
  }
  if (!rows.length) throw new Error('No product rows found. Summary rows are not products.');
  if (rows.length > 500) throw new Error('Maximum 500 product rows per lot. Split larger manifests.');
  const identifiers = new Map<string, number>();
  rows.forEach(row => { if (row.eanRaw) identifiers.set(row.eanRaw, (identifiers.get(row.eanRaw) ?? 0) + 1); });
  rows.forEach(row => { if ((identifiers.get(row.eanRaw) ?? 0) > 1) { row.ean = ''; row.warnings.push('Barcode shared across manifest rows; cannot establish product identity.'); } });
  const skus = new Set<string>(); rows.forEach(row => { if (row.sku && skus.has(row.sku)) warnings.push(`Repeated SKU ${row.sku}: rows kept separate; review duplicate quantities.`); skus.add(row.sku); });
  const rrp = rows.reduce((sum, row) => sum + row.totalRrp, 0);
  if (declaredRrp !== null && Math.abs(declaredRrp - rrp) > 0.02) warnings.push('Declared manifest total differs from product line totals.');
  warnings.push('RRP is supplier retail reference, not a completed sale or guaranteed resale value.');
  return { rows, warnings, units: rows.reduce((sum, row) => sum + row.quantity, 0), rrp, weightKg: rows.reduce((sum, row) => sum + row.quantity * row.weightKg, 0), declaredRrp };
}
