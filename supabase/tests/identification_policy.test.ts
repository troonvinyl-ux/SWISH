// Dependency-free Deno policy checks. No credentials, network or production writes.
import { validateIdentificationPayload, parseIdentificationJson, guardMusicIdentification, identificationResize } from '../functions/_shared/identificationPolicy.ts';
import { getSpecialistProfile } from '../functions/_shared/specialistIntelligence.ts';
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
Deno.test('bounded photos and aligned labels', () => {
  const photo = 'data:image/jpeg;base64,YQ==';
  assert(validateIdentificationPayload({ images: [photo], imageLabels: ['Rear cover'] }) === null, 'Valid request rejected');
  assert(validateIdentificationPayload({ images: Array(9).fill(photo) }) !== null, 'Excessive photos accepted');
  assert(validateIdentificationPayload({ images: [photo], imageLabels: [] }) !== null, 'Misaligned labels accepted');
  assert(validateIdentificationPayload({ images: ['file://original.heic'] }) !== null, 'Local image URL accepted');
  assert(JSON.stringify(identificationResize(3024, 4032)) === JSON.stringify({ width: 768, height: 1024 }), 'Portrait not long-edge bounded');
});
Deno.test('music stays candidate without invented catalogue verification', () => {
  const profile = getSpecialistProfile('tunes_flip')!;
  const result = guardMusicIdentification({ objectType: 'CD', identificationState: 'verified', numistaN: 'N#1', coinFields: { denomination: 'CD3' }, attributes: { artist: 'Visible Artist', discogs_release_id: '123', media_grade: 'M' } }, profile.fields.map(field => field.key), profile.taxonomy);
  assert(result.objectType === 'CD' && result.identificationState === 'candidate', 'Incorrect music classification');
  assert(!result.coinFields && !result.numistaN && !result.attributes.discogs_release_id && !result.attributes.media_grade, 'Invented catalogue or grade survived');
  assert(result.attributes.artist === 'Visible Artist', 'Legible artist lost');
});
Deno.test('JSON format variations and invalid output', () => {
  assert(parseIdentificationJson('```json\n{"canonicalTitle":"Album"}\n```').canonicalTitle === 'Album', 'Fenced JSON rejected');
  let rejected = false;
  try { parseIdentificationJson('[{"canonicalTitle":"Album"}]'); } catch { rejected = true; }
  assert(rejected, 'Array accepted as identification');
});
