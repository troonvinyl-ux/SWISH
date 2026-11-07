// Advisory pixel warnings do not certify identity or change inventory/listing evidence.
import type { PhotoQuality } from './imageQualityMetrics';
import type { CapturedPresentationPhoto } from '@/shared/smartStudio';
export interface PhotoReviewSource extends CapturedPresentationPhoto { slotLabel: string }
export interface PhotoWarningReview extends PhotoReviewSource { photoQuality: PhotoQuality }
export type PhotoReviewAction = 'identify' | 'refine';

export function photoReviewEvidenceKey(scope: string, photos: PhotoReviewSource[]): string {
  // Order matters: Stored photo 4 must still refer to the fourth selected original.
  return JSON.stringify([scope, photos.map(photo => [photo.uri, photo.slotLabel])]);
}
export function buildPhotoWarningReview(photos: PhotoReviewSource[], checks: PhotoQuality[]): PhotoWarningReview[] {
  return photos.flatMap((photo, index) => checks[index]?.warnings.length ? [{ ...photo, photoQuality: checks[index] }] : []);
}
export function canAcceptPhotoWarnings(reviewKey: string, currentKey: string, review: PhotoWarningReview[]): boolean {
  return Boolean(reviewKey && reviewKey === currentKey && review.length);
}
