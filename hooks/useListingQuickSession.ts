// Connect the single seller editor to the original scanner session without starting a new timer.
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { QuickListContext } from '@/contexts/QuickListContext';
import { useAuth } from '@/template';
import { useApp } from './useApp';
import { recordQuickTiming, retainQuickTiming } from '@/services/quickListTelemetryService';
import { confirmQuickLive, type QuickDraft } from '@/services/quickListService';
import { getItem } from '@/services/itemService';
import { inventoryIdentification } from '@/services/listingAutofillService';
import { quickCaptureSlots, quickReviewIssue } from '@/services/quickListPolicyService';
import { resolveProductionNiche } from '@/services/nicheRouting';
import type { QuickStage, QuickTiming, QuickListNiche } from '@/shared/quickList';
import type { QuickListState } from '@/contexts/QuickListContext';
export interface ListingQuickTicket { scope: string; sessionId: string; epoch: number; tenantId: string; nicheId: QuickListNiche; listingId: string; itemId: string; draft: QuickDraft; images: QuickListState['images']; mode: string; specialistId: string; measurements: Record<string, string> }
export function useListingQuickSession(listingId: string) {
  const context = useContext(QuickListContext), app = useApp(), { user } = useAuth();
  const nicheId = resolveProductionNiche(app.fixedNicheId ?? app.activeNicheId);
  const scope = user && app.tenant && nicheId && app.accessReady ? `${user.id}:${app.tenant.id}:${nicheId}` : '';
  const stateRef = useRef(context?.state); stateRef.current = context?.state;
  const identity = useRef({ scope, epoch: app.moduleEpoch, listingId }); identity.current = { scope, epoch: app.moduleEpoch, listingId };
  const mounted = useRef(true), [clock, setClock] = useState(Date.now());
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const state = context?.state;
  const linked = Boolean(scope && state?.scope === scope && state.draft?.listing.id === listingId);
  const scannerOpenedAt = linked ? state?.timing?.timestamps.T1 : undefined;
  const confirmedAt = linked ? state?.timing?.timestamps.T7 : undefined;
  useEffect(() => {
    if (scannerOpenedAt == null || confirmedAt != null) return;
    setClock(Date.now()); const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [scannerOpenedAt, confirmedAt]);
  const capture = useCallback((): ListingQuickTicket | null => {
    const value = stateRef.current;
    if (!scope || !app.tenant || !nicheId || value?.scope !== scope || value.draft?.listing.id !== listingId) return null;
    return { scope, sessionId: value.sessionId, epoch: app.moduleEpoch, tenantId: app.tenant.id, nicheId, listingId, itemId: value.draft.itemId, draft: value.draft, images: value.images, mode: value.mode, specialistId: value.specialistId, measurements: value.measurements };
  }, [scope, app.tenant?.id, app.moduleEpoch, nicheId, listingId]);
  const isCurrent = useCallback((ticket: ListingQuickTicket) => {
    const value = stateRef.current, active = identity.current;
    return mounted.current && active.scope === ticket.scope && active.epoch === ticket.epoch && active.listingId === ticket.listingId && value?.scope === ticket.scope && value.sessionId === ticket.sessionId && value.draft?.listing.id === ticket.listingId;
  }, []);
  const mark = useCallback((ticket: ListingQuickTicket | null, stage?: QuickStage, extra: Partial<QuickTiming> = {}) => {
    if (!ticket || !isCurrent(ticket) || !context) return;
    const before = stateRef.current!, row = before.timing;
    if (!row) return; // Recovery without a measured session is not an invented sample.
    const timing: QuickTiming = { ...row, ...extra, timestamps: { ...row.timestamps, ...(stage && row.timestamps[stage] == null ? { [stage]: Date.now() } : {}) } };
    const next = { ...before, timing, ...(extra.outcome === 'live' ? { liveId: extra.externalListingId ?? '', unconfirmed: false } : {}) };
    stateRef.current = next;
    context.setState(previous => previous.scope === ticket.scope && previous.sessionId === ticket.sessionId && previous.draft?.listing.id === ticket.listingId ? { ...previous, timing, ...(extra.outcome === 'live' ? { liveId: extra.externalListingId ?? '', unconfirmed: false } : {}) } : previous);
    void retainQuickTiming(ticket.scope, timing).catch(() => {});
    void recordQuickTiming(ticket.tenantId, timing);
  }, [context?.setState, isCurrent]);
  const approvalIssue = useCallback(async (ticket: ListingQuickTicket | null): Promise<string | null> => {
    if (!ticket) return null;
    if (!isCurrent(ticket)) return 'The scanner workspace changed. Reopen the saved draft.';
    const read = await getItem(ticket.itemId);
    if (!isCurrent(ticket)) return 'The scanner workspace changed. Reopen the saved draft.';
    if (read.error || !read.item || read.item.tenantId !== ticket.tenantId || resolveProductionNiche(read.item.specialistId) !== ticket.nicheId) return read.error ?? 'The captured item could not be verified.';
    return quickReviewIssue(ticket.nicheId, inventoryIdentification(read.item), quickCaptureSlots(ticket.nicheId, ticket.specialistId, ticket.mode, ticket.measurements.observed_disc_count), ticket.images);
  }, [isCurrent]);
  const confirm = useCallback(async (ticket: ListingQuickTicket | null, externalListingId: string, photos: string[], quantity: number) => {
    if (!ticket) return { live: true, error: null }; // Ordinary drafts use the canonical publication pipeline.
    if (!isCurrent(ticket)) return { live: false, error: 'Workspace changed. Check the saved listing; do not submit again.' };
    const result = await confirmQuickLive(ticket.tenantId, { ...ticket.draft, photos, quantity }, ticket.sessionId, externalListingId);
    if (!isCurrent(ticket)) return { live: false, error: 'Workspace changed. Check the saved listing; do not submit again.' };
    if (result.live) mark(ticket, 'T7', { outcome: 'live', externalListingId, endedAt: Date.now() });
    else mark(ticket, undefined, { outcome: 'unconfirmed' });
    return result;
  }, [isCurrent, mark]);
  return { capture, mark, approvalIssue, confirm, elapsedMs: scannerOpenedAt == null ? null : Math.max(0, (confirmedAt ?? clock) - scannerOpenedAt) };
}
