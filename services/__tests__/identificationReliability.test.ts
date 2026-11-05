// Pure policy/deadline regressions; no live AI, inventory or seller requests.
import fs from 'node:fs';
import path from 'node:path';
import { IDENTIFICATION_LIMITS, validateIdentificationPayload, identificationResize, utf8Bytes, parseIdentificationJson, guardMusicIdentification, MUSIC_IDENTIFICATION_RULES } from '../../shared/identificationPolicy';
import { getSpecialistProfile } from '../../shared/specialistIntelligence';
import { invokeWithIdentificationDeadline, IdentificationTimeoutError } from '../identificationTransportService';
const read = (file: string) => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
const photo = 'data:image/jpeg;base64,YQ==';

describe('Identification payload policy', () => {
  test('accepts labelled photos and existing HTTPS photos', () => {
    expect(validateIdentificationPayload({ images: [photo], imageLabels: ['Rear cover'], existingImageUrls: ['https://storage.example/disc.jpg'] })).toBeNull();
  });
  test('rejects missing, excessive, unreadable and oversized photos before a request', () => {
    for (const body of [{}, { images: Array(9).fill(photo) }, { images: ['file://original.heic'] }, { images: ['data:image/jpeg;base64,'] }, { images: ['A'.repeat(IDENTIFICATION_LIMITS.imageCharacters + 1)] }]) expect(validateIdentificationPayload(body)).not.toBeNull();
  });
  test('per-photo limits do not replace the total JSON upload limit', () => {
    expect(validateIdentificationPayload({ images: Array(8).fill(`data:image/jpeg;base64,${'A'.repeat(760_000)}`) })).toMatch(/safe upload limit/);
  });
  test('UTF-8 size includes multibyte characters', () => {
    expect(utf8Bytes('Aé音')).toBe(6);
    expect(utf8Bytes('𝄞')).toBe(4);
    expect(validateIdentificationPayload({ images: [photo], knownAttributes: { customNotes: '音'.repeat(11_000) } })).toMatch(/Known item details/);
  });
  test('labels must stay aligned and stored images cannot be local URLs', () => {
    expect(validateIdentificationPayload({ images: [photo], imageLabels: [] })).toMatch(/labels/);
    expect(validateIdentificationPayload({ existingImageUrls: ['file://disc.jpg'] })).toMatch(/HTTPS/);
  });
  test('portrait and landscape resize preserve aspect ratio without upscaling', () => {
    expect(identificationResize(3024, 4032)).toEqual({ width: 768, height: 1024 });
    expect(identificationResize(4032, 3024)).toEqual({ width: 1024, height: 768 });
    expect(identificationResize(640, 480)).toBeNull();
  });
});

describe('Structured music identification', () => {
  test.each(['{"canonicalTitle":"Album"}', '```json\n{"canonicalTitle":"Album"}\n```', 'Result:\n{"canonicalTitle":"Album"}', JSON.stringify('{"canonicalTitle":"Album"}')])('parses safe JSON format variations', value => {
    expect(parseIdentificationJson(value).canonicalTitle).toBe('Album');
  });
  test.each(['[]', '[{"canonicalTitle":"Album"}]', 'null', '{"canonicalTitle":', 'not JSON'])('rejects non-object or truncated JSON', value => {
    expect(() => parseIdentificationJson(value)).toThrow();
  });
  test('CDs are not coins and model catalogue IDs/grades are not confirmations', () => {
    const profile = getSpecialistProfile('tunes_flip')!;
    const raw = { canonicalTitle: 'Compilation', objectType: 'CD', identificationState: 'verified', identificationSource: 'verified', confidence: 0.9, numistaN: 'N#123', coinFields: { denomination: 'CD3' }, discogsReleaseId: 123,
      attributes: { artist: 'Visible Artist', format: 'CD', matrix: 'Literal mark', discogs_release_id: '123', discogs_pressing_confirmed: true, media_grade: 'M', sleeve_grade: 'M', pressing_reviewed: 'yes' },
      attributesConfirmed: { release_title: 'Compilation' }, attributesInferred: { country: 'UK' },
      specialistAnalysis: { fields: { artist: { value: 'Visible Artist', basis: 'observed' }, discogs_release_id: { value: '123', basis: 'observed' }, media_grade: { value: 'M', basis: 'observed' } } }, valuationMid: 500, saleProb30d: 1 };
    const result = guardMusicIdentification(raw, profile.fields.map(field => field.key), profile.taxonomy);
    expect(result.objectType).toBe('CD'); expect(result.identificationState).toBe('candidate'); expect(result.identificationSource).toBe('inferred');
    expect(result.attributes.artist).toBe('Visible Artist'); expect(result.attributes.matrix).toBe('Literal mark');
    expect(result.coinFields).toBeUndefined(); expect(result.numistaN).toBeUndefined(); expect(result.discogsReleaseId).toBeUndefined();
    for (const key of ['discogs_release_id', 'discogs_pressing_confirmed', 'media_grade', 'sleeve_grade', 'pressing_reviewed']) expect(result.attributes[key]).toBeUndefined();
    expect(result.specialistAnalysis.fields.media_grade).toBeUndefined(); expect(result.conditionGrade).toBeNull(); expect(result.valuationMid).toBe(0);
    expect(raw.attributes.media_grade).toBe('M');
  });
  test('prompt supports CD compilations and treats incorrect slot names as intended views only', () => {
    expect(MUSIC_IDENTIFICATION_RULES).toContain('CD2/CD3'); expect(MUSIC_IDENTIFICATION_RULES).toContain('not proof of their contents');
  });
  test('deployable policy is identical; credentials and Numista routing remain server-only', () => {
    expect(read('shared/identificationPolicy.ts')).toBe(read('supabase/functions/_shared/identificationPolicy.ts'));
    const server = read('supabase/functions/swish-identify/index.ts');
    expect(server).toContain('coinMode && !vehicleMode && !clothingMode && shouldRunNumista(objectType)');
    expect(server).toContain('guardMusicIdentification(identification'); expect(server).toContain('IDENTIFICATION_LIMITS.musicProviderMs');
    expect(server).toContain("response_format: { type: 'json_object' }"); expect(server).toContain("'AI_RESPONSE_TRUNCATED'");
    expect(server).toContain('requestId, durationMs:'); expect(server).toContain('return requirePaidNiche(');
  });
});

describe('Single invocation deadline', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  test('successful invocation clears the deadline', async () => {
    const operation = jest.fn().mockResolvedValue({ data: 'real-response' });
    await expect(invokeWithIdentificationDeadline(operation, 1000)).resolves.toEqual({ data: 'real-response' });
    expect(operation).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
  });
  test('timeout aborts a stalled request without retrying or losing retained photos', async () => {
    let signal: AbortSignal | null = null;
    const operation = jest.fn((input: AbortSignal) => { signal = input; return new Promise(() => {}); });
    const pending = invokeWithIdentificationDeadline(operation, 1000);
    const caught = pending.catch(error => error);
    await Promise.resolve(); jest.advanceTimersByTime(1000);
    const error = await caught;
    expect(error).toBeInstanceOf(IdentificationTimeoutError); expect(error.message).toContain('retained');
    expect((signal as unknown as AbortSignal).aborted).toBe(true); expect(operation).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
  });
  test('rejected transport is not replayed', async () => {
    const operation = jest.fn().mockRejectedValue(new Error('Network request failed'));
    await expect(invokeWithIdentificationDeadline(operation, 1000)).rejects.toThrow('Network request failed');
    expect(operation).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
  });
});
