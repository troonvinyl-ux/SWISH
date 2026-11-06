import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { canAcceptPhotoWarnings, photoReviewEvidenceKey, type PhotoReviewAction, type PhotoReviewSource, type PhotoWarningReview } from '@/services/reidentificationPhotoReviewService';
interface ReviewState { key: string; photos: PhotoWarningReview[]; action: PhotoReviewAction }

export function useReidentificationPhotoReview(scope: string, enabled: boolean, photos: PhotoReviewSource[]) {
  const evidenceKey = useMemo(() => photoReviewEvidenceKey(`${scope}:${enabled}`, photos), [scope, enabled, photos]);
  const current = useRef(evidenceKey); current.current = evidenceKey;
  const mounted = useRef(true);
  const approved = useRef('');
  const [review, setReview] = useState<ReviewState | null>(null);
  const [approvedKey, setApprovedKey] = useState('');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; approved.current = ''; }; }, []);
  useEffect(() => { approved.current = ''; setApprovedKey(''); setReview(null); }, [evidenceKey]);
  const isCurrent = useCallback(() => mounted.current && enabled && current.current === evidenceKey, [enabled, evidenceKey]);
  const recordReview = useCallback((warnings: PhotoWarningReview[] | undefined, action: PhotoReviewAction) => {
    if (!isCurrent() || !warnings?.length) return false;
    approved.current = ''; setApprovedKey('');
    setReview({ key: evidenceKey, photos: warnings, action });
    return true;
  }, [evidenceKey, isCurrent]);
  const acknowledge = useCallback(() => {
    if (!isCurrent() || !review || !canAcceptPhotoWarnings(review.key, evidenceKey, review.photos)) return false;
    // Set the ref synchronously so the explicitly requested retry uses this consent.
    approved.current = evidenceKey; setApprovedKey(evidenceKey);
    return true;
  }, [evidenceKey, review, isCurrent]);
  const allowWarnings = useCallback(() => isCurrent() && approved.current === evidenceKey, [evidenceKey, isCurrent]);
  const reset = useCallback(() => { approved.current = ''; setApprovedKey(''); setReview(null); }, []);
  return {
    evidenceKey, isCurrent, recordReview, acknowledge, allowWarnings, reset,
    review: enabled && review?.key === evidenceKey ? review : null,
    acknowledged: enabled && approvedKey === evidenceKey,
  };
}
