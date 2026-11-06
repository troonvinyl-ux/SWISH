import { validateNumistaImages, NUMISTA_IMAGE_LIMITS, numistaPhysicalContradictions, type NumistaImage, type NumistaImageSearchResult } from './numistaImageSearch.ts';
const API = 'https://api.numista.com/api/v3';
interface VisualSearch { result: NumistaImageSearchResult; catalogue: Record<string, any>[] }
// Only call after the existing JWT, membership, module, entitlement and quota checks.
// No raw response, photos, catalogue details or credentials are logged/cached/persisted here.
export async function searchNumistaImages(images: unknown, requestFetch: typeof fetch = fetch): Promise<VisualSearch> {
  const result: NumistaImageSearchResult = { status: 'not_requested', source: 'Numista', imageCount: Array.isArray(images) ? images.length : 0, candidates: [], message: 'Numista image search was not requested by this client. Update the app to enable it.' };
  const fail = (message: string): VisualSearch => ({ result: { ...result, status: 'unavailable', message }, catalogue: [] });
  if (!Array.isArray(images) || !images.length) return { result, catalogue: [] };
  const invalid = validateNumistaImages(images);
  if (invalid) return fail(invalid);
  const key = Deno.env.get('NUMISTA_API_KEY');
  if (!key) return fail('Numista image search is not configured. Existing visual and catalogue identification remains available.');
  try {
    // One paid search per explicitly requested identification. Never automatically replay.
    const response = await requestFetch(`${API}/search_by_image?lang=en`, {
      method: 'POST', headers: { 'Numista-API-Key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ images: (images as NumistaImage[]).map(image => ({ mime_type: image.mime_type, image_data: image.image_data })), category: 'coin', max_results: NUMISTA_IMAGE_LIMITS.finalists }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const message = response.status === 401 || response.status === 403 ? 'Numista image search was denied. Confirm the existing API key belongs to your activated Paid Plan.'
        : response.status === 402 ? 'Numista image search requires an active Paid Plan or billing review.'
        : response.status === 429 ? 'Numista image search is rate limited. No automatic retry was made.'
        : `Numista image search is temporarily unavailable (HTTP ${response.status}).`;
      return fail(message);
    }
    const data = await response.json();
    if (!Array.isArray(data.types)) return fail('Numista image search returned an unreadable candidate list.');
    const unique = new Map<number, Record<string, any>>();
    for (const row of data.types) {
      const id = Number(row?.id);
      if (Number.isSafeInteger(id) && id > 0 && !unique.has(id)) unique.set(id, row);
      if (unique.size >= NUMISTA_IMAGE_LIMITS.finalists) break;
    }
    if (!unique.size) return { result: { ...result, status: 'no_results', message: 'Numista found no visual matches. Text/legend discovery remains available.' }, catalogue: [] };
    // Eight detail requests at most, within the published 15-details-per-search allowance.
    const catalogue = await Promise.all([...unique].map(async ([id, row], index) => {
      let detail = row;
      try {
        const response = await requestFetch(`${API}/types/${id}?lang=en`, { headers: { 'Numista-API-Key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(6000) });
        if (response.ok) { const received = await response.json(); if (Number(received.id) === id) detail = received; }
      } catch { /* Keep the lightweight search candidate; do not invent specifications. */ }
      return { ...detail, id, _numistaImageRank: index + 1, _numistaDetailRetrieved: detail !== row };
    }));
    return { result: { ...result, status: 'results', message: 'Visual catalogue leads, not confirmed identity. Compare both faces and measured specifications.', candidates: catalogue.map(row => ({ typeId: row.id, numistaN: `N#${row.id}`, title: String(row.title ?? `Numista type ${row.id}`).slice(0, 180), url: `https://en.numista.com/${row.id}`, rank: row._numistaImageRank })) }, catalogue };
  } catch { return fail('Numista image search timed out or could not connect. Existing identification continues; no automatic retry was made.'); }
}
export function imageCatalogueReview(catalogue: Record<string, any>[], weight?: unknown, diameter?: unknown) {
  const scalar = (value: any) => typeof value === 'string' || typeof value === 'number' ? value : value?.name ?? value?.material ?? null;
  return catalogue.map(row => ({ typeId: row.id, numistaN: `N#${row.id}`, rank: row._numistaImageRank, title: row.title, issuer: scalar(row.issuer), denomination: scalar(row.value ?? row.min_unit), issuedFrom: row.issued_from, issuedTo: row.issued_to, catalogueWeight: row.weight, catalogueDiameter: row.size ?? row.diameter, material: scalar(row.composition), obverse: row.obverse?.description, obverseLettering: row.obverse?.lettering, reverse: row.reverse?.description, reverseLettering: row.reverse?.lettering, physicalContradictions: numistaPhysicalContradictions(row, weight, diameter) }));
}
