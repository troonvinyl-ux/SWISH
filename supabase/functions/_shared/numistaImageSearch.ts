// Public, dependency-free Numista image-search contract. Credentials and catalogue calls stay server-side.
export const NUMISTA_IMAGE_LIMITS = { images: 2, dimension: 1024, imageCharacters: 800_000, finalists: 8 } as const;
export interface NumistaImage { mime_type: 'image/jpeg'; image_data: string; width: number; height: number; label: string }
export interface CoinPhotoSource { uri: string; slotId?: string; slotLabel?: string; width?: number; height?: number }
export interface NumistaVisualCandidate { typeId: number; numistaN: string; title: string; url: string; rank: number }
export interface NumistaImageSearchResult {
  status: 'results' | 'no_results' | 'unavailable' | 'not_requested';
  source: 'Numista'; imageCount: number; candidates: NumistaVisualCandidate[]; message: string;
}
export function selectNumistaFaces(photos: CoinPhotoSource[]): CoinPhotoSource[] {
  const unique = photos.filter((photo, index, all) => Boolean(photo.uri) && all.findIndex(other => other.uri === photo.uri) === index);
  const label = (photo: CoinPhotoSource) => `${photo.slotId ?? ''} ${photo.slotLabel ?? ''}`;
  const obverse = unique.find(photo => /obverse|avers|front|main/i.test(label(photo)) && !/edge|detail|mark/i.test(label(photo)));
  const reverse = unique.find(photo => photo !== obverse && /reverse|revers|back|underside/i.test(label(photo)) && !/edge|detail/i.test(label(photo)));
  const chosen = [obverse, reverse].filter((photo): photo is CoinPhotoSource => Boolean(photo));
  for (const photo of unique) if (chosen.length < 2 && !chosen.includes(photo) && !/edge|detail|hallmark|countermark/i.test(label(photo))) chosen.push(photo);
  for (const photo of unique) if (chosen.length < 2 && !chosen.includes(photo)) chosen.push(photo);
  return chosen.slice(0, 2);
}
// Read actual JPEG dimensions, not client-declared dimensions; no large pixel decode needed on the server.
export function jpegDimensions(base64: string): { width: number; height: number } | null {
  try {
    const data = atob(base64);
    const byte = (index: number) => data.charCodeAt(index);
    const word = (index: number) => (byte(index) << 8) | byte(index + 1);
    if (byte(0) !== 255 || byte(1) !== 216) return null;
    let offset = 2;
    while (offset + 4 < data.length) {
      if (byte(offset++) !== 255) return null;
      while (byte(offset) === 255) offset++;
      const marker = byte(offset++);
      if (marker === 217 || marker === 218) return null;
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      const size = word(offset);
      if (size < 2 || offset + size > data.length) return null;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && size >= 8) return { height: word(offset + 3), width: word(offset + 5) };
      offset += size;
    }
  } catch { /* Unsupported or corrupt analysis copy. */ }
  return null;
}
export function validateNumistaImages(value: unknown): string | null {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length > 2) return 'Numista image search accepts at most two coin faces.';
  for (const image of value) {
    if (!image || image.mime_type !== 'image/jpeg' || typeof image.image_data !== 'string' || image.image_data.length > NUMISTA_IMAGE_LIMITS.imageCharacters || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.image_data)) return 'Numista requires a bounded JPEG analysis copy.';
    const dimensions = jpegDimensions(image.image_data);
    if (!dimensions || dimensions.width < 1 || dimensions.height < 1 || Math.max(dimensions.width, dimensions.height) > 1024 || dimensions.width !== image.width || dimensions.height !== image.height) return 'Numista coin faces must be no larger than 1024 × 1024 pixels.';
    if (typeof image.label !== 'string' || image.label.length > 120) return 'Numista coin-face labels are invalid.';
  }
  return null;
}
export function numistaPhysicalContradictions(candidate: { weight?: unknown; size?: unknown; diameter?: unknown }, weight?: unknown, diameter?: unknown): string[] {
  const warnings: string[] = [];
  const suppliedWeight = Number(weight), catalogueWeight = Number(candidate.weight);
  const suppliedDiameter = Number(diameter), catalogueDiameter = Number(candidate.size ?? candidate.diameter);
  if (suppliedWeight > 0 && catalogueWeight > 0 && Math.abs(suppliedWeight - catalogueWeight) / catalogueWeight > 0.12) warnings.push(`Weight MAJOR CONTRADICTION: measured ${suppliedWeight}g vs Numista ${catalogueWeight}g.`);
  if (suppliedDiameter > 0 && catalogueDiameter > 0 && Math.abs(suppliedDiameter - catalogueDiameter) > 3) warnings.push(`Diameter CONTRADICTION: measured ${suppliedDiameter}mm vs Numista ${catalogueDiameter}mm.`);
  return warnings;
}
// Only these identifiers/operational facts are retained. Search titles/details are transient licensed data.
export function numistaSearchTrail(result: NumistaImageSearchResult) {
  return { source: 'Numista', status: result.status, imageCount: result.imageCount, candidateIds: result.candidates.map(candidate => candidate.typeId), checkedAt: new Date().toISOString(), method: 'search_by_image' };
}
