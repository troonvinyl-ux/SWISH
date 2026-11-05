// Dependency-free identification transport and music evidence rules. No provider credentials.
export const IDENTIFICATION_LIMITS = {
  images: 8,
  imageCharacters: 800_000,
  requestBytes: 6_000_000,
  knownAttributeBytes: 30_000,
  musicProviderMs: 35_000,
  musicClientMs: 85_000,
  otherClientMs: 165_000,
} as const;

export function utf8Bytes(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}

export function identificationResize(width?: number, height?: number, maximum = 1024): { width: number; height?: number } | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || !width || !height || width <= 0 || height <= 0) return { width: maximum };
  const scale = Math.min(1, maximum / Math.max(width, height));
  if (scale === 1) return null;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function validateIdentificationPayload(body: Record<string, any>): string | null {
  if (body.images != null && !Array.isArray(body.images) || body.existingImageUrls != null && !Array.isArray(body.existingImageUrls)) return 'Photo lists must be arrays.';
  const images: unknown[] = body.images ?? [];
  const stored: unknown[] = body.existingImageUrls ?? [];
  if (!images.length && !stored.length) return 'At least one image is required.';
  if (images.length + stored.length > IDENTIFICATION_LIMITS.images) return 'Use at most eight photos per identification; your originals are retained.';
  const remote = (value: unknown) => typeof value === 'string' && /^https:\/\/\S+$/i.test(value) && value.length <= 2048;
  for (const image of images) {
    if (remote(image)) continue;
    if (typeof image !== 'string' || image.length > IDENTIFICATION_LIMITS.imageCharacters) return 'An analysis photo is too large. Resize or retake it; your original is unchanged.';
    if (!/^data:image\/(?:jpe?g|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(image) && !/^[A-Za-z0-9+/=]+$/.test(image)) return 'An analysis photo could not be read. Reselect or retake it.';
  }
  if (stored.some(url => !remote(url))) return 'Stored photographs must use valid HTTPS URLs.';
  if (body.imageLabels != null && (!Array.isArray(body.imageLabels) || body.imageLabels.length !== images.length || body.imageLabels.some((label: unknown) => typeof label !== 'string' || label.length > 120))) return 'Photo labels must match the supplied photos.';
  if (body.knownAttributes != null && (typeof body.knownAttributes !== 'object' || Array.isArray(body.knownAttributes) || utf8Bytes(JSON.stringify(body.knownAttributes)) > IDENTIFICATION_LIMITS.knownAttributeBytes)) return 'Known item details are too large or invalid. Shorten the notes and retry.';
  if (utf8Bytes(JSON.stringify(body)) > IDENTIFICATION_LIMITS.requestBytes) return 'Analysis photos exceed the safe upload limit. Use fewer or smaller photos; your originals are retained.';
  return null;
}

export function parseIdentificationJson(value: unknown): Record<string, any> {
  if (typeof value !== 'string') throw new Error('AI response did not contain text JSON.');
  const parse = (input: string): unknown => {
    const clean = input.replace(/^\uFEFF/, '').replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    try { return JSON.parse(clean); } catch (error) {
      const start = clean.indexOf('{');
      const end = clean.lastIndexOf('}');
      if (start >= 0 && end > start && !clean.startsWith('[')) return JSON.parse(clean.slice(start, end + 1));
      throw error;
    }
  };
  let result = parse(value);
  if (typeof result === 'string') result = parse(result);
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('AI response was not a JSON object.');
  return result as Record<string, any>;
}

export const MUSIC_IDENTIFICATION_RULES = `MUSIC PHOTO IDENTIFICATION:
This is a music release, never a coin/Numista task. First read the front/rear packaging for artist and release title; then cross-check label, catalogue number, barcode, format and disc count across ALL views.
Support CDs, multi-disc CD compilations, cassettes, vinyl and box sets, not just vinyl pressings. A printed CD2/CD3 indicates disc numbering, not a matrix/runout or a coin denomination. Record only visible or user-supplied disc counts; do not infer missing discs are present.
Capture-slot labels are intended views, not proof of their contents. A CD photographed in a Matrix/Runout or Side B slot is still a CD; inspect its actual contents and explain if the matrix is not legible.
A compilation cover is not necessarily a single-artist album. Read Various Artists or compilation branding only when supported. Do not infer an artist, track or release year from decorative artwork or disc colours.
Treat barcode/catalogue search and any supplied Discogs result as candidate context, not an exact-edition certificate. State agreements and contradictions; NEVER invent Discogs release IDs, Numista references, catalogue matches or external lookups.
Return a useful artist/title/format proposal when packaging is legible even if the edition is unresolved. Use observation_only and one targeted follow-up when title/artist cannot be read. Do not reject the entire object because a single extra-detail view is unclear.
Media and sleeve grades, completeness and playback are unassessed unless manually supplied; photographs cannot establish skips, noise, groove wear or audio quality. Leave grading and pressing confirmation for user review.
Keep the response concise: at most 6 supporting observations, 3 contradictions and 3 useful missing details. No valuations, invented tracks, full tracklist transcription or catalogue research in this photo call.`;

export function guardMusicIdentification(input: Record<string, any>, fieldKeys: string[], taxonomy: string[]): Record<string, any> {
  const result = { ...input };
  const allowed = new Set(fieldKeys.filter(key => !/^(discogs_|numista_|media_grade$|sleeve_grade$|pressing_reviewed$)/i.test(key)));
  const clean = (raw: unknown) => {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const output: Record<string, any> = {};
    for (const [key, value] of Object.entries(source)) {
      const base = key.replace(/^_inferred_/, '');
      if (allowed.has(base) && (typeof value === 'string' || typeof value === 'number')) output[key] = String(value).trim().slice(0, 500);
    }
    return output;
  };
  result.attributes = clean(result.attributes);
  result.attributesConfirmed = clean(result.attributesConfirmed);
  result.attributesInferred = clean(result.attributesInferred);
  const analysis = result.specialistAnalysis;
  if (analysis && typeof analysis === 'object' && !Array.isArray(analysis)) {
    const fields = analysis.fields && typeof analysis.fields === 'object' ? analysis.fields : {};
    result.specialistAnalysis = { ...analysis, fields: Object.fromEntries(Object.entries(fields).filter(([key]) => allowed.has(key))) };
  }
  for (const key of Object.keys(result)) if (/^(coinFields|medalFields|coinCandidates|coinResearch|numista|discogs)/i.test(key)) delete result[key];
  const category = typeof result.objectType === 'string' ? result.objectType.trim() : '';
  result.objectType = taxonomy.find(value => value.toLowerCase() === category.toLowerCase()) ?? 'music collectible';
  result.identificationState = result.identificationState === 'observation_only' ? 'observation_only' : 'candidate';
  result.identificationSource = result.identificationSource === 'detected' ? 'detected' : 'inferred';
  result.conditionGrade = null;
  result.valuationLow = 0;
  result.valuationMid = 0;
  result.valuationHigh = 0;
  result.saleProb30d = null;
  return result;
}
