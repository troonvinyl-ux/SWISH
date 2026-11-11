// Shared workflow policy, not an entitlement or an accuracy certificate.
// Identification prompts, taxonomy, valuation and references stay in existing specialist profiles.
export interface NicheWorkflowPolicy {
  barcode: 'start' | 'optional' | 'disabled';
  quickReviewMinimum: number;
  publicationMinimum: number; // Zero: model confidence is advisory, not a marketplace permission.
  inventoryReviewMinimum: number;
}
const standard = (barcode: NicheWorkflowPolicy['barcode']): NicheWorkflowPolicy => ({ barcode, quickReviewMinimum: 0.7, publicationMinimum: 0, inventoryReviewMinimum: 0.8 });
export const NICHE_WORKFLOW_POLICIES: Readonly<Record<string, NicheWorkflowPolicy>> = {
  coins: { ...standard('optional'), quickReviewMinimum: 0.95, publicationMinimum: 0 },
  motocross: standard('optional'), bicycles: standard('optional'), clothing: standard('optional'),
  trading_cards: standard('optional'), antiques: standard('optional'), fossils: standard('optional'),
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
