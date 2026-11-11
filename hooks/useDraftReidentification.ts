import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/template';
import { useApp } from './useApp';
import { useReidentificationPhotoReview } from './useReidentificationPhotoReview';
import { readDraftEvidence, analyseDraftEvidence, saveDraftEvidence, pickDraftEvidencePhoto, type DraftEvidenceSnapshot } from '@/services/draftReidentificationService';
import type { AIIdentificationResult, CapturedImage } from '@/services/aiIdentificationService';
import { DRAFT_REID_LIMITS, type ReidentificationMode } from '@/shared/draftReidentification';
import { studioForOriginal } from '@/shared/smartStudio';
export function useDraftReidentification(listingId: string, onSaved: () => void, mode: ReidentificationMode = 'draft') {
  const { user } = useAuth();
  const app = useApp();
  const nicheId = app.fixedNicheId ?? app.activeNicheId;
  const scope = useMemo(() => ({ listingId, tenantId: app.tenant?.id ?? '', nicheId, userId: user?.id ?? '', mode }), [listingId, app.tenant?.id, nicheId, user?.id, mode]);
  const key = `${scope.userId}:${scope.tenantId}:${scope.nicheId}:${app.moduleEpoch}:${listingId}:${mode}`;
  const ready = Boolean(user && app.tenant && app.accessReady && !app.moduleLoading && !app.subscriptionLoading);
  const current = useRef(''); current.current = ready ? key : '';
  const mounted = useRef(false), locked = useRef(false);
  const [snapshot, setSnapshot] = useState<DraftEvidenceSnapshot | null>(null);
  const [loadedKey, setLoadedKey] = useState('');
  const [busy, setBusy] = useState<'loading' | 'picking' | 'analysing' | 'saving' | null>('loading');
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<CapturedImage[]>([]);
  const [stored, setStored] = useState<string[]>([]);
  const [clues, setClues] = useState('');
  const [result, setResult] = useState<AIIdentificationResult | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [replaceTitle, setReplaceTitle] = useState(mode === 'draft');
  const isCurrent = useCallback(() => mounted.current && current.current === key, [key]);
  const photos = useMemo(() => [...images, ...stored.map((uri, index) => ({ uri, slotLabel: `Stored photo ${index + 1}`, studio: snapshot ? studioForOriginal(uri, snapshot.item.attributes) : undefined }))], [images, stored, snapshot]);
  const review = useReidentificationPhotoReview(`${key}:${clues}`, Boolean(snapshot && ready), photos);
  useEffect(() => {
    mounted.current = true; setLoadedKey(''); setSnapshot(null); setImages([]); setStored([]); setClues(''); setResult(null); setDraftTitle(''); setReplaceTitle(mode === 'draft'); setError(null); setBusy('loading');
    if (!ready) { setError('Waiting for a verified listing workspace.'); setBusy(null); return () => { mounted.current = false; }; }
    void readDraftEvidence(scope).then(value => {
      if (!isCurrent()) return;
      setSnapshot(value); setLoadedKey(key); setStored(value.originalUrls.slice(0, DRAFT_REID_LIMITS.photos)); setClues(value.savedClues); setBusy(null);
    }).catch(cause => { if (isCurrent()) { setError(cause instanceof Error ? cause.message : 'Listing evidence could not load.'); setBusy(null); } });
    return () => { mounted.current = false; };
  }, [key, ready, scope, isCurrent, mode]);
  const invalidate = useCallback(() => { setResult(null); setDraftTitle(''); setError(null); }, []);
  const addPhoto = useCallback(async (source: 'camera' | 'library') => {
    if (locked.current || busy || !snapshot || !isCurrent()) return;
    if (images.length + stored.length >= DRAFT_REID_LIMITS.photos) { setError('Eight views are selected. Deselect a stored view or remove a new photo to add another. Originals are kept.'); return; }
    locked.current = true; setBusy('picking'); setError(null);
    try {
      const image = await pickDraftEvidencePhoto(source, `reid_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`);
      if (isCurrent() && image) { setImages(previous => [...previous, image]); invalidate(); }
    } catch (cause) { if (isCurrent()) setError(cause instanceof Error ? cause.message : 'Could not add photo.'); }
    finally { locked.current = false; if (isCurrent()) setBusy(null); }
  }, [busy, snapshot, images.length, stored.length, isCurrent, invalidate]);
  const toggleStored = useCallback((uri: string) => {
    if (busy || locked.current || !isCurrent() || !snapshot?.originalUrls.includes(uri)) return;
    if (!stored.includes(uri) && stored.length + images.length >= DRAFT_REID_LIMITS.photos) { setError('Select at most eight identifying views.'); return; }
    setStored(previous => previous.includes(uri) ? previous.filter(value => value !== uri) : [...previous, uri]); invalidate();
  }, [busy, snapshot, stored, images.length, invalidate, isCurrent]);
  const removePhoto = useCallback((uri: string) => { if (!busy && !locked.current && isCurrent()) { setImages(previous => previous.filter(image => image.uri !== uri)); invalidate(); } }, [busy, invalidate, isCurrent]);
  const changeClues = useCallback((value: string) => { if (!busy && !locked.current && isCurrent()) { setClues(value); invalidate(); } }, [busy, invalidate, isCurrent]);
  const identify = useCallback(async () => {
    if (locked.current || busy || !snapshot || !isCurrent()) return;
    locked.current = true; setBusy('analysing'); setError(null); setResult(null);
    try {
      const response = await analyseDraftEvidence(scope, snapshot, images, stored, clues, review.allowWarnings(), isCurrent);
      if (!isCurrent() || !review.isCurrent()) return;
      if (response.error || !response.result) { if (!review.recordReview(response.photoReview, 'identify')) setError(response.error ?? 'No identification returned.'); return; }
      setResult(response.result); setDraftTitle(response.result.canonicalTitle);
    } catch (cause) { if (isCurrent()) setError(cause instanceof Error ? cause.message : 'Identification failed. Saved listing unchanged.'); }
    finally { locked.current = false; if (isCurrent()) { setImages([...images]); setBusy(null); } }
  }, [busy, snapshot, scope, images, stored, clues, review.allowWarnings, review.recordReview, review.isCurrent, isCurrent]);
  const accept = useCallback(async (evidenceOnly = false) => {
    if (locked.current || busy || !snapshot || !isCurrent() || (!evidenceOnly && !result)) return;
    locked.current = true; setBusy('saving'); setError(null);
    try {
      await saveDraftEvidence(scope, snapshot, images, clues, evidenceOnly ? null : result, !evidenceOnly && replaceTitle ? draftTitle : null, isCurrent);
      if (!isCurrent()) return;
      app.triggerInventoryReload(); onSaved();
    } catch (cause) { if (isCurrent()) { app.triggerInventoryReload(); setError(cause instanceof Error ? cause.message : 'Identification save was not confirmed.'); } }
    finally { locked.current = false; if (isCurrent()) { setImages([...images]); setBusy(null); } }
  }, [busy, snapshot, scope, images, clues, result, replaceTitle, draftTitle, isCurrent, app.triggerInventoryReload, onSaved]);
  return { snapshot: ready && loadedKey === key ? snapshot : null, busy, error, images, stored, clues, result, draftTitle, replaceTitle, photos, review,
    addPhoto, toggleStored, removePhoto, changeClues, identify, accept, setDraftTitle, setReplaceTitle };
}
