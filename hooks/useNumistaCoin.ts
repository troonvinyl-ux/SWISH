import { useCallback, useEffect, useMemo, useRef, useState, useContext } from 'react';
import { Linking } from 'react-native';
import { QuickListContext } from '@/contexts/QuickListContext';
import { useApp } from './useApp';
import { lookupNumistaCoin } from '@/services/numistaCoinService';
import { withScannerDeadline, scannerDeadlines } from '@/services/scannerLifecycleService';
import { readNumistaCoinReference, compareCoinMeasurements, coinConfirmationKey, coinIdentityConfirmationIssue, numistaCoinEntryIssue, coinPublicationIssue, type CoinMeasurementReview } from '@/shared/numistaCoin';
export interface NumistaCoinInput { answers: Record<string, string>; onChange: (key: string, value: string) => void; sessionId: string; disabled: boolean; photoCount: number; photos?: Array<{ slotId: string; uri: string }> }
export function useNumistaCoin({ answers, onChange, sessionId, disabled, photoCount, photos }: NumistaCoinInput) {
  const { tenant, activeNiche, accessReady } = useApp();
  const quick = useContext(QuickListContext);
  const savedState = quick && quick.state.sessionId === sessionId && quick.state.itemId && !quick.state.draft && quick.state.result?.attributes._coin_measurement_review ? quick.state : null;
  const savedReview: CoinMeasurementReview | null = savedState?.result && !coinPublicationIssue(savedState.result.attributes) ? savedState.result.attributes._coin_measurement_review as CoinMeasurementReview : null;
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const revision = useRef(0), recoveryAttempt = useRef('');
  const scope = `${tenant?.id ?? ''}:${activeNiche.id}:${sessionId}`;
  const current = useRef(scope); current.current = scope;
  const numberRef = useRef(answers.catalogue_number ?? ''); numberRef.current = answers.catalogue_number ?? '';
  useEffect(() => {
    revision.current++; setBusy(false); setError(''); recoveryAttempt.current = '';
    return () => { revision.current++; };
  }, [scope]);
  const reference = useMemo(() => readNumistaCoinReference(answers), [answers]);
  const comparison = useMemo(() => reference ? compareCoinMeasurements(reference, answers.weight_g, answers.diameter_mm) : null, [reference, answers.weight_g, answers.diameter_mm]);
  const key = reference ? coinConfirmationKey(reference, answers) : '';
  const numistaMode = answers._coin_entry !== 'photo';
  const update = useCallback((name: string, value: string) => {
    if (disabled) return;
    revision.current++; setBusy(false); setError(''); onChange(name, value);
  }, [disabled, onChange]);
  const cancel = useCallback(() => {
    revision.current++; setBusy(false); setError('Numista lookup stopped. Your number, photos and measurements are retained.');
  }, []);
  const lookup = useCallback(async () => {
    if ((disabled && !savedReview) || busy) return;
    if (!tenant || activeNiche.id !== 'coins' || !accessReady || !sessionId) {
      setError('Coins workspace access is not ready. Reopen Coins and retry; your number and photos are retained.');
      return;
    }
    const capturedScope = scope, capturedInput = numberRef.current, generation = ++revision.current;
    const requestedNumber = capturedInput || (savedReview ? `N#${savedReview.referenceId}` : '');
    setBusy(true); setError('');
    if (!savedState) onChange('_numista_record', '');
    try {
      const result = await withScannerDeadline(lookupNumistaCoin(tenant.id, requestedNumber), scannerDeadlines.camera, 'Numista lookup timed out. Retry the same number.');
      if (current.current !== capturedScope || revision.current !== generation || numberRef.current !== capturedInput) return;
      if (result.error || !result.reference) { setError(result.error ?? 'No matching Numista record returned.'); return; }
      if (savedState && savedReview && quick) {
        if (result.reference.id !== savedReview.referenceId || result.reference.weightGrams !== savedReview.catalogueWeightGrams || result.reference.diameterMm !== savedReview.catalogueDiameterMm) {
          setError('The catalogue reference changed. Open this saved coin in inventory for physical review; do not create another copy.'); return;
        }
        // Restore the already-reviewed physical facts, never the catalogue standard as actual measurements.
        const restored: Record<string, string> = { ...answers, catalogue_number: `N#${savedReview.referenceId}`, weight_g: String(savedReview.actualWeightGrams), diameter_mm: String(savedReview.actualDiameterMm), _numista_record: JSON.stringify(result.reference), _coin_mismatch_notes: savedReview.mismatchNotes, year: savedReview.confirmedDate ?? answers.year ?? '' };
        const confirmedKey = coinConfirmationKey(result.reference, restored);
        restored._coin_measured_confirmed = confirmedKey; restored._numista_identity_confirmed = confirmedKey;
        restored._coin_mismatch_ack = savedReview.mismatchAcknowledged ? confirmedKey : '';
        quick.setState(previous => previous.sessionId === sessionId && previous.scope === savedState.scope && previous.itemId === savedState.itemId ? { ...previous, measurements: restored, error: '' } : previous);
      } else onChange('_numista_record', JSON.stringify(result.reference));
    } catch (cause) {
      if (current.current === capturedScope && revision.current === generation) setError(cause instanceof Error ? cause.message : 'Numista lookup unavailable.');
    } finally { if (current.current === capturedScope && revision.current === generation) setBusy(false); }
  }, [scope, tenant?.id, activeNiche.id, accessReady, sessionId, disabled, busy, onChange, savedState, savedReview, quick, answers]);
  useEffect(() => {
    const ticket = savedState ? `${scope}:${savedState.itemId}` : '';
    if (!ticket || !savedReview || reference || !accessReady || recoveryAttempt.current === ticket) return;
    // At most one automatic read per resumed saved item; explicit Retry remains available.
    recoveryAttempt.current = ticket; void lookup();
  }, [scope, savedState?.itemId, savedReview, reference, accessReady, lookup]);
  const openSource = useCallback(async () => {
    if (!reference) return;
    try { await Linking.openURL(reference.url); } catch { setError('Numista reference could not be opened. Try again.'); }
  }, [reference]);
  const facePhotos = photos ?? (photoCount >= 2 ? [{slotId:'obverse',uri:'legacy-front'},{slotId:'reverse',uri:'legacy-back'}] : []);
  const identityIssue = coinIdentityConfirmationIssue(reference, answers, facePhotos);
  const confirmIdentity = useCallback(() => {
    if (disabled || busy) return;
    if (key && answers._numista_identity_confirmed === key) { update('_numista_identity_confirmed', ''); return; }
    if (identityIssue) { setError(identityIssue); return; }
    update('_numista_identity_confirmed', key);
  }, [disabled, busy, key, answers._numista_identity_confirmed, identityIssue, update]);
  const confirmMeasurements = useCallback(() => {
    if (disabled || busy) return;
    if (!key || !comparison?.actualWeight || !comparison.actualDiameter) { setError('Load the Numista reference and enter your physically measured weight and diameter before ticking this box.'); return; }
    update('_coin_measured_confirmed', answers._coin_measured_confirmed === key ? '' : key);
  }, [disabled, busy, key, comparison?.actualWeight, comparison?.actualDiameter, answers._coin_measured_confirmed, update]);
  return { savedReview, busy, error, reference, comparison, key, numistaMode, update, cancel, lookup, openSource, identityIssue, confirmIdentity, confirmMeasurements,
    measured: Boolean(key && answers._coin_measured_confirmed === key), identity: Boolean(key && answers._numista_identity_confirmed === key), acknowledged: Boolean(key && answers._coin_mismatch_ack === key),
    issue: numistaMode ? numistaCoinEntryIssue(answers) : null, canConfirmIdentity: !identityIssue };
}
