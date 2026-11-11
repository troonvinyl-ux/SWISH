// Evidence remains private. Draft and live eligibility are deliberately separate.
export type ReidentificationMode = 'draft' | 'live';
export const DRAFT_REID_LIMITS = { photos: 8, clues: 2000, proposalBytes: 80000 } as const;
export interface DraftIdentityState { status?: string | null; external_listing_id?: string | null; published_at?: string | null; ended_at?: string | null; publish_claim_id?: string | null }
export function isPrivateIdentificationDraft(row: DraftIdentityState): boolean {
  return ['draft', 'pending'].includes(String(row.status ?? '').trim().toLowerCase()) && !row.external_listing_id?.trim() && !row.published_at && !row.ended_at && !row.publish_claim_id;
}
/** Live research never sends a seller revision; ended/sold/in-flight rows are excluded. */
export function isLiveIdentificationListing(row: DraftIdentityState & { marketplace_id?: string | null }): boolean {
  return ['active', 'live'].includes(String(row.status ?? '').trim().toLowerCase()) && Boolean(row.external_listing_id?.trim()) && !row.ended_at && !row.publish_claim_id && String(row.marketplace_id ?? '').toLowerCase() === 'ebay';
}
export function draftClueContext(clues: string, privateNotes = ''): string {
  return [privateNotes, clues.trim() ? `Seller-supplied clues and hypotheses (NOT verified facts). Cross-check against the photographs; disclose contradictions and uncertainty, do not assume authenticity, maker, age or provenance:\n${clues.trim()}` : ''].filter(Boolean).join('\n\n');
}
