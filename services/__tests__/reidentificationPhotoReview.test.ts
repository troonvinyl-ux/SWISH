// Pure warning-consent and shared-screen contracts; no device or live AI requests.
import fs from 'node:fs';
import path from 'node:path';
import { buildPhotoWarningReview, canAcceptPhotoWarnings, photoReviewEvidenceKey } from '../reidentificationPhotoReviewService';
import type { PhotoQuality } from '../imageQualityMetrics';
const source = (file: string) => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
const good: PhotoQuality = { status: 'measured', version: 'roi-laplacian-v1', meanLuminance: 120, laplacianVariance: 200, darkFraction: 0, brightFraction: 0, measuredWidth: 256, measuredHeight: 256, warnings: [] };
const dark: PhotoQuality = { ...good, meanLuminance: 30, warnings: ['Low light or dark subject: inspect the original.'] };
const photos = Array.from({ length: 4 }, (_, index) => ({ uri: `https://storage.test/original-${index + 1}.jpg`, slotLabel: `Stored photo ${index + 1}` }));
describe('Re-identification advisory photo review', () => {
  test('the fourth stored-photo warning stays attached to the fourth original', () => {
    const review = buildPhotoWarningReview(photos, [good, good, good, dark]);
    expect(review).toEqual([{ ...photos[3], photoQuality: dark }]);
    expect(photos).toHaveLength(4);
  });
  test('unavailable measurements remain advisory rather than certified good', () => {
    const unavailable: PhotoQuality = { ...dark, status: 'unavailable', warnings: ['Pixel checks unavailable. Inspect this photo yourself.'] };
    expect(buildPhotoWarningReview([photos[0]], [unavailable])[0].photoQuality.status).toBe('unavailable');
    expect(buildPhotoWarningReview(photos, [good, good, good, good])).toEqual([]);
  });
  test('consent belongs only to this account, item, open modal and exact evidence order', () => {
    const key = photoReviewEvidenceKey('tenant:item:true', photos);
    const review = buildPhotoWarningReview(photos, [good, good, good, dark]);
    expect(canAcceptPhotoWarnings(key, key, review)).toBe(true);
    for (const other of [
      photoReviewEvidenceKey('other-tenant:item:true', photos),
      photoReviewEvidenceKey('tenant:other-item:true', photos),
      photoReviewEvidenceKey('tenant:item:false', photos),
      photoReviewEvidenceKey('tenant:item:true', [...photos].reverse()),
      photoReviewEvidenceKey('tenant:item:true', [{ ...photos[0], uri: 'file://replacement.jpg' }, ...photos.slice(1)]),
      photoReviewEvidenceKey('tenant:item:true', photos.slice(0, 3)),
    ]) expect(canAcceptPhotoWarnings(key, other, review)).toBe(false);
    expect(canAcceptPhotoWarnings('', key, review)).toBe(false);
    expect(canAcceptPhotoWarnings(key, key, [])).toBe(false);
  });
  test('every niche uses an actionable shared review for initial re-ID and refinement', () => {
    const screen = source('app/stock-listing/[id].tsx');
    expect(screen).toContain('<ReidentificationPhotoReview');
    expect(screen).toContain("photoReview.recordReview(response.photoReview, 'identify')");
    expect(screen).toContain("photoReview.recordReview(response.photoReview, 'refine')");
    expect(screen.match(/allowPhotoWarnings: photoReview.allowWarnings\(\)/g)).toHaveLength(2);
    expect(screen).toContain('if (!photoReview.acknowledge()) return;');
    expect(screen).toContain('identificationLock.current');
    expect(screen).toContain('key={`${scope}:${reIdVisible}`}');
    expect(screen).not.toContain('allowPhotoWarnings: true');
  });
  test('review controls show originals, explain false positives and never write or invoke AI directly', () => {
    const ui = source('components/feature/ReidentificationPhotoReview.tsx');
    expect(ui).toContain('Continue with these photos');
    expect(ui).toContain('Pixel checks are advisory');
    expect(ui).toContain('source={{ uri: photo.uri }}');
    expect(ui).toContain('contentFit="contain"');
    expect(ui).toContain('accessibilityLabel="Close original photo"');
    expect(ui).not.toMatch(/getSupabaseClient|functions\.invoke|from\(['"]items/);
    const hook = source('hooks/useReidentificationPhotoReview.ts');
    expect(hook).toContain('current.current === evidenceKey');
    expect(hook).toContain('approved.current === evidenceKey');
    expect(hook).toContain('canAcceptPhotoWarnings(review.key, evidenceKey, review.photos)');
    expect(hook).toContain("mounted.current = false; approved.current = ''");
  });
});
