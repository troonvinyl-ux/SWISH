import { DEFAULT_LOT_ASSUMPTIONS, type LotLine, type LotAssumptions } from './lotEconomicsService';

export interface ManifestSession {
  name: string; key: string; auctionUrl: string; lines: LotLine[]; assumptions: LotAssumptions; warnings: string[];
  strategy: 'individual' | 'grouped' | 'whole'; paidHammer: string; acquisitionId: string | null;
  itemIds: string[]; listingIds: string[];
  restoredWatchAt: string | null; watchedBidNeedsRefresh: boolean;
}
export const emptyManifestSession = (): ManifestSession => ({
  name: '', key: '', auctionUrl: '', lines: [], assumptions: { ...DEFAULT_LOT_ASSUMPTIONS }, warnings: [],
  strategy: 'grouped', paidHammer: '', acquisitionId: null, itemIds: [], listingIds: [],
  restoredWatchAt: null, watchedBidNeedsRefresh: false,
});
