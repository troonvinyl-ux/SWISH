// Shared workflow policy, not an entitlement or an accuracy certificate.
// Identification prompts, taxonomy, valuation and references stay in existing specialist profiles.
export interface NicheWorkflowPolicy {
  barcode: 'start' | 'optional' | 'disabled';
  quickReviewMinimum: number;
  publicationMinimum: number;
  inventoryReviewMinimum: number;
}
const standard = (barcode: NicheWorkflowPolicy['barcode']): NicheWorkflowPolicy => ({ barcode, quickReviewMinimum: 0.7, publicationMinimum: 0.3, inventoryReviewMinimum: 0.8 });
export const NICHE_WORKFLOW_POLICIES: Readonly<Record<string, NicheWorkflowPolicy>> = {
  coins: { ...standard('disabled'), quickReviewMinimum: 0.95, publicationMinimum: 0.95 },
  motocross: standard('disabled'), bicycles: standard('disabled'), clothing: standard('optional'),
  trading_cards: standard('disabled'), antiques: standard('disabled'), fossils: standard('disabled'),
  beauty: standard('optional'), tech: standard('optional'), surplus_flip: standard('optional'),
  tunes_flip: standard('optional'), collectibles: standard('start'),
};
export function getNicheWorkflowPolicy(nicheId: string): NicheWorkflowPolicy | null {
  return Object.prototype.hasOwnProperty.call(NICHE_WORKFLOW_POLICIES, nicheId) ? { ...NICHE_WORKFLOW_POLICIES[nicheId] } : null;
}
export function nicheBarcodeAllowed(nicheId: string): boolean {
  const policy = getNicheWorkflowPolicy(nicheId);
  return policy !== null && policy.barcode !== 'disabled';
}
