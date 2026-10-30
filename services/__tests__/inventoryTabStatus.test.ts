jest.mock('@/template', () => ({ getSupabaseClient: jest.fn() }));
jest.mock('@/services/itemService', () => ({
  ...jest.requireActual('@/services/itemService'),
  listItems: jest.fn(),
}));
jest.mock('@/services/listingService', () => ({
  ...jest.requireActual('@/services/listingService'),
  getAllListings: jest.fn(),
}));

import { listItems } from '@/services/itemService';
import { getAllListings } from '@/services/listingService';
import { loadInventoryView, buildInventoryViews } from '@/services/inventoryViewService';
import { getProductionNicheSpecialistIds } from '@/services/nicheRouting';
import { PRODUCTION_NICHE_IDS } from '@/constants/niches';
import { isLiveListing, isDraftListing } from '@/services/listingLifecycle';
import { parseEbayListingStatus } from '../../supabase/functions/_shared/listingStatus';

const xml = (state: string, quantity = 1, sold = 1, id = '800434360561') =>
  `<GetItemResponse><Ack>Success</Ack><Item><ItemID>${id}</ItemID><Quantity>${quantity}</Quantity><SellingStatus><ListingStatus>${state}</ListingStatus><QuantitySold>${sold}</QuantitySold></SellingStatus><ListingDetails><EndTime>2026-10-05T18:27:00.000Z</EndTime></ListingDetails></Item></GetItemResponse>`;

describe('Actual eBay status evidence', () => {
  test('reported sold coin is sold even with a stale Active label', () => {
    expect(parseEbayListingStatus(xml('Active'), '800434360561').status).toBe('sold');
  });
  test('completed sold item is not Live', () => {
    expect(parseEbayListingStatus(xml('Completed'), '800434360561').status).toBe('sold');
  });
  test('unsold ended listing is stock, not sold', () => {
    expect(parseEbayListingStatus(xml('Completed', 1, 0), '800434360561').status).toBe('ended');
  });
  test('partial sale leaves real available multi-quantity stock Live', () => {
    expect(parseEbayListingStatus(xml('Active', 5, 2), '800434360561').status).toBe('active');
  });
  test('a different external ID is rejected', () => {
    expect(() => parseEbayListingStatus(xml('Completed'), '999')).toThrow('different listing identity');
  });
  test('failed/missing responses never default to live', () => {
    expect(() => parseEbayListingStatus('<Ack>Failure</Ack>', '1')).toThrow();
    expect(() => parseEbayListingStatus(xml('Unknown'), '800434360561')).toThrow();
    expect(() => parseEbayListingStatus(xml('Active').replace('<QuantitySold>1</QuantitySold>', ''), '800434360561')).toThrow();
  });
});

describe('Shared inventory lifecycle guards', () => {
  test('sold date, listing status and ledger evidence beat old active labels', () => {
    const active = { status: 'active', itemStatus: 'listed', externalListingId: '123' };
    expect(isLiveListing({ ...active, itemSoldAt: '2026-10-05' } as any)).toBe(false);
    expect(isLiveListing({ ...active, hasSaleEvidence: true, itemQuantity: 1 } as any)).toBe(false);
    expect(isLiveListing({ ...active, hasSaleEvidence: true, itemQuantity: 5 } as any)).toBe(true);
    expect(isDraftListing({ status: 'draft', externalListingId: '123' } as any)).toBe(false);
  });

  test('sold listing evidence overrides stale item status and removes it from Stock/Live/Draft', () => {
    const item = { id: 'coin', status: 'listed', canonicalTitle: 'Ephesos', specialistId: 'coins', media: [], attributes: {} } as any;
    const listing = { id: 'listing', itemId: 'coin', status: 'sold', itemStatus: 'listed', externalListingId: '123', itemTitle: 'Ephesos', itemSpecialistId: 'coins', itemMedia: [] } as any;
    const result = buildInventoryViews([item], [listing]);
    expect(result.stock).toHaveLength(0);
    expect(result.draft).toHaveLength(0);
    expect(result.live).toHaveLength(0);
    expect(result.sold).toHaveLength(1);
  });
});

describe('Niche inventory reads remain isolated', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (listItems as jest.Mock).mockResolvedValue({ items: [], error: null });
    (getAllListings as jest.Mock).mockResolvedValue({ listings: [], error: null });
  });

  test.each(PRODUCTION_NICHE_IDS)('%s loads only its registered specialist IDs', async niche => {
    const allowed = getProductionNicheSpecialistIds(niche);
    await loadInventoryView('tenant-1', niche);
    expect(listItems).toHaveBeenCalledWith('tenant-1', { specialistIds: allowed });
    expect(getAllListings).toHaveBeenCalledWith('tenant-1', undefined, allowed);
  });

  test('unknown niche fails closed with no inventory reads', async () => {
    await loadInventoryView('tenant-1', 'unknown');
    expect(listItems).toHaveBeenCalledWith('tenant-1', { specialistIds: [] });
    expect(getAllListings).toHaveBeenCalledWith('tenant-1', undefined, []);
  });
});
