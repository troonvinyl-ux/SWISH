// Draft evidence is private. A published or in-flight listing is never eligible.
export const DRAFT_REID_LIMITS = { photos: 8, clues: 2000, proposalBytes: 80000 } as const;
export interface DraftIdentityState { status?: string | null; external_listing_id?: string | null; published_at?: string | null; ended_at?: string | null; publish_claim_id?: string | null }
export function isPrivateIdentificationDraft(row: DraftIdentityState): boolean {
  return ['draft', 'pending'].includes(String(row.status ?? '').trim().toLowerCase()) && !row.external_listing_id?.trim() && !row.published_at && !row.ended_at && !row.publish_claim_id;
}
export function draftClueContext(clues: string, privateNotes = ''): string {
  return [privateNotes, clues.trim() ? `Seller-supplied clues and hypotheses (NOT verified facts). Cross-check against the photographs; disclose contradictions and uncertainty, do not assume authenticity, maker, age or provenance:\n${clues.trim()}` : ''].filter(Boolean).join('\n\n');
}
