// Existing item, photo writer and identification endpoint only. Never creates/publishes a listing.
import { getSupabaseClient } from '@/template';
import { loadListingEditor } from './listingEditorService';
import { mapItem, type Item } from './itemService';
import { existingOriginalPhotos } from './existingImageStudioService';
import { identifyItemWithAI, captureFromCamera, pickFromLibrary, type CapturedImage, type AIIdentificationResult } from './aiIdentificationService';
import { persistCapturedItemPhotos } from './photoPersistenceService';
import { DRAFT_REID_LIMITS, draftClueContext, isPrivateIdentificationDraft, isLiveIdentificationListing, type ReidentificationMode } from '@/shared/draftReidentification';
import { resolveProductionNiche } from './nicheRouting';
export interface DraftEvidenceSnapshot { item: Item; listingVersion: string; originalUrls: string[]; savedClues: string; listingTitle: string; mode: ReidentificationMode; externalListingId: string }
export interface DraftReidScope { tenantId: string; nicheId: string; listingId: string; userId: string; mode?: ReidentificationMode }
export async function readDraftEvidence(scope: DraftReidScope): Promise<DraftEvidenceSnapshot> {
  const result = await loadListingEditor(scope.tenantId, scope.listingId, scope.nicheId);
  const row = result.data as any;
  const mode = scope.mode ?? 'draft';
  if (mode === 'live') {
    if (result.error || !row || !isLiveIdentificationListing(row) || !row.updated_at || !row.items?.updated_at) throw new Error(result.error ?? 'Open an active, linked eBay listing. Ended, sold or pending submissions cannot use live re-identification.');
    const item = mapItem(row.items);
    if (item.tenantId !== scope.tenantId || resolveProductionNiche(item.specialistId) !== scope.nicheId || ['sold','archived','disposed'].includes(item.status) || item.soldAt) throw new Error('This item is sold, archived or outside the active workspace. Nothing was applied.');
    return { item, listingVersion: row.updated_at, originalUrls: existingOriginalPhotos(item), savedClues: String(item.attributes?._live_reidentification?.clues ?? '').slice(0, DRAFT_REID_LIMITS.clues), listingTitle: row.title, mode, externalListingId: row.external_listing_id };
  }
  if (result.error || !row || !isPrivateIdentificationDraft(row) || !row.updated_at || !row.items?.updated_at) throw new Error(result.error ?? 'Re-identification is only available for an unpublished draft. Check any pending publication first.');
  const item = mapItem(row.items);
  if (item.tenantId !== scope.tenantId || resolveProductionNiche(item.specialistId) !== scope.nicheId || ['listed','active','live','sold','archived','disposed'].includes(item.status) || item.soldAt) throw new Error('This item is no longer an unpublished draft in this workspace.');
  // A sibling listing may already be published, even when the selected row is a draft.
  const siblings = await getSupabaseClient().from('listings').select('status,external_listing_id,published_at,ended_at,publish_claim_id').eq('tenant_id', scope.tenantId).eq('item_id', item.id);
  if (siblings.error) throw new Error(siblings.error.message);
  if ((siblings.data ?? []).some(entry => !isPrivateIdentificationDraft(entry) && (entry.external_listing_id || entry.published_at || entry.publish_claim_id || ['active','live','publishing','published','sold'].includes(entry.status)))) throw new Error('A linked listing has publication history or a pending publish. Draft re-identification is blocked.');
  return { item, listingVersion: row.updated_at, originalUrls: existingOriginalPhotos(item), savedClues: String(item.attributes?._draft_reidentification?.clues ?? '').slice(0, DRAFT_REID_LIMITS.clues), listingTitle: row.title, mode, externalListingId: '' };
}
async function assertCaller(scope: DraftReidScope, isCurrent: () => boolean) {
  if (!isCurrent()) throw new Error('Workspace changed. Reopen the listing.');
  const session = await getSupabaseClient().auth.getSession();
  if (!isCurrent() || session.error || session.data.session?.user.id !== scope.userId) throw new Error('The signed-in account changed. Reopen the listing.');
}
export async function pickDraftEvidencePhoto(source: 'camera' | 'library', role: string): Promise<CapturedImage | null> {
  const image = source === 'camera' ? await captureFromCamera() : await pickFromLibrary(role, 'Additional identifying detail');
  return image ? { ...image, slotId: role, slotLabel: 'Additional identifying detail' } : null;
}
export async function analyseDraftEvidence(scope: DraftReidScope, snapshot: DraftEvidenceSnapshot, images: CapturedImage[], stored: string[], clues: string, allowWarnings: boolean, isCurrent: () => boolean) {
  await assertCaller(scope, isCurrent);
  const fresh = await readDraftEvidence(scope);
  if (fresh.mode !== snapshot.mode || fresh.item.id !== snapshot.item.id || fresh.externalListingId !== snapshot.externalListingId) throw new Error('The linked item or listing changed. Reopen before analysing.');
  if (!isCurrent() || (fresh.item.updatedAt !== snapshot.item.updatedAt && nonPhotoIdentity(fresh.item) !== nonPhotoIdentity(snapshot.item)) || fresh.listingVersion !== snapshot.listingVersion) throw new Error('This listing changed. Close and reopen re-identification before analysing it.');
  if (!images.length && !stored.length) throw new Error('Choose at least one photo of this item.');
  if (images.length + stored.length > DRAFT_REID_LIMITS.photos || clues.length > DRAFT_REID_LIMITS.clues || stored.some(url => !snapshot.originalUrls.includes(url))) throw new Error('Choose up to eight original views and at most 2,000 characters of clues.');
  const item = fresh.item;
  return identifyItemWithAI(images, item.specialistId, undefined, {
    existingTitle: item.canonicalTitle, existingAttributes: item.attributes, condition: item.condition,
    weight: item.weightGrams, diameter: item.diameterMm, material: item.material, manufacturer: item.manufacturer,
    yearMade: item.yearMade, countryOfOrigin: item.countryOfOrigin, ruler: item.ruler, denomination: item.denomination,
    period: item.period, mint: item.mint, catalogueNumber: item.catalogueNumber,
    customNotes: draftClueContext(clues, item.customNotes),
  }, { tenantId: scope.tenantId, existingImageUrls: stored, allowPhotoWarnings: allowWarnings, presentationInParallel: true });
}
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([,entry]) => entry !== undefined).sort(([a],[b]) => a.localeCompare(b)).map(([key,entry]) => [key,ordered(entry)]));
  return value;
}
function nonPhotoIdentity(item: Item): string {
  const { _photo_assets, _photo_pipeline, _smart_studio_images, ...attributes } = item.attributes ?? {};
  void _photo_assets; void _photo_pipeline; void _smart_studio_images;
  const { media, updatedAt, ...fields } = item;
  void media; void updatedAt;
  return JSON.stringify(ordered({ ...fields, attributes }));
}
export async function saveDraftEvidence(scope: DraftReidScope, snapshot: DraftEvidenceSnapshot, images: CapturedImage[], clues: string, result: AIIdentificationResult | null, title: string | null, isCurrent: () => boolean): Promise<Item> {
  await assertCaller(scope, isCurrent);
  if (images.length > DRAFT_REID_LIMITS.photos) throw new Error('Attach at most eight additional views.');
  if (result === null && title !== null) throw new Error('Analyse and review an identification before preparing a title.');
  if (clues.length > DRAFT_REID_LIMITS.clues || (title !== null && (!title.trim() || title.length > 80))) throw new Error('Clues support 2,000 characters. A reviewed title must contain 1–80 characters.');
  if (result && resolveProductionNiche(result.specialistId) !== scope.nicheId) throw new Error('The suggestion belongs to a different specialist. Nothing was applied.');
  let fresh = await readDraftEvidence(scope);
  if (fresh.mode !== snapshot.mode || fresh.item.id !== snapshot.item.id || fresh.externalListingId !== snapshot.externalListingId) throw new Error('The linked item or listing changed. Reopen before saving.');
  if (fresh.listingVersion !== snapshot.listingVersion || (fresh.item.updatedAt !== snapshot.item.updatedAt && nonPhotoIdentity(fresh.item) !== nonPhotoIdentity(snapshot.item))) throw new Error('This listing changed during review. Reopen it before saving; no identification was applied.');
  if (images.length) {
    await assertCaller(scope, isCurrent);
    const saved = await persistCapturedItemPhotos(scope.tenantId, fresh.item.id, images);
    if (!saved.complete || saved.errors.length || saved.urls.length !== images.length) throw new Error(saved.errors.join(' ') || 'Some added photos were not saved. Retry this same draft; identification was not applied.');
    fresh = await readDraftEvidence(scope);
    if (fresh.listingVersion !== snapshot.listingVersion || nonPhotoIdentity(fresh.item) !== nonPhotoIdentity(snapshot.item)) throw new Error('Item details changed while saving photos. Photos are retained; reopen before applying identification.');
  }
  await assertCaller(scope, isCurrent);
  const proposal = result ? {
    canonicalTitle: result.canonicalTitle, confidence: result.confidence, identificationState: result.identificationState ?? 'candidate',
    objectType: result.objectType ?? 'unknown', specialistAnalysis: result.specialistAnalysis ?? null,
    supporting: result.evidenceSupporting, contradictory: result.evidenceContradictory, missing: result.missingInformation,
    candidates: result.candidateIdentification ?? null, warnings: result.warnings,
    attributesConfirmed: result.attributesConfirmed, attributesInferred: result.attributesInferred,
  } : null;
  if (JSON.stringify(proposal).length * 4 > DRAFT_REID_LIMITS.proposalBytes) throw new Error('Identification evidence is too large to save safely. Shorten the clues and retry.');
  const live = snapshot.mode === 'live';
  const receipt = `${live ? 'live' : 'draft'}-reid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const saved = await getSupabaseClient().rpc(live ? 'swish_apply_live_reidentification' : 'swish_apply_draft_reidentification', {
    p_tenant_id: scope.tenantId, p_listing_id: scope.listingId, p_niche_id: scope.nicheId,
    p_item_version: fresh.item.updatedAt, p_listing_version: snapshot.listingVersion,
    p_clues: clues.trim(), p_proposal: proposal,
    ...(live ? { p_reviewed_title: title?.trim() ?? null } : { p_draft_title: title?.trim() ?? null }), p_receipt: receipt,
  });
  if (saved.error || !saved.data) throw new Error(saved.error?.message ?? 'Draft save was not confirmed. Reload before retrying.');
  const readback = await readDraftEvidence(scope);
  const evidence = readback.item.attributes?.[live ? '_live_reidentification' : '_draft_reidentification'];
  if (evidence?.receipt !== receipt || readback.savedClues !== clues.trim() || (result && readback.item.canonicalTitle !== result.canonicalTitle) || (title !== null && (live ? evidence?.reviewedTitle : readback.listingTitle) !== title.trim()) || (live && (readback.listingVersion !== snapshot.listingVersion || readback.listingTitle !== snapshot.listingTitle || readback.externalListingId !== snapshot.externalListingId))) throw new Error('Save returned but readback did not match. Reload the existing listing; do not recreate it.');
  return readback.item;
}
