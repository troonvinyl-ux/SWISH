import * as fs from 'fs';
import * as path from 'path';

const source = fs.readFileSync(path.resolve(__dirname, '../../app/ebay-hub.tsx'), 'utf8');

describe('eBay Hub durable niche sales filtering', () => {
  test('uses the sale-time niche snapshot for niche revenue metrics', () => {
    expect(source).toContain(".select('sale_price, net_revenue, niche_id')");
    expect(source).toContain(".eq('niche_id', nicheId)");
    expect(source).toContain('loadEbayMetrics(tenant.id, specialistIds, nicheStyle.nicheId)');
  });

  test('falls back to the legacy specialist join only when the additive column is missing', () => {
    expect(source).toContain("error?.code === '42703'");
    expect(source).toContain("error?.code === 'PGRST204'");
    expect(source).toContain('isMissingNicheHistoryColumn(nicheResult.error)');
    expect(source).toContain(".in('items.specialist_id', specialistIds)");
  });

  test('does not broaden a niche query after an unrelated sales-query error', () => {
    expect(source).toContain('if (!nicheResult.error || !isMissingNicheHistoryColumn(nicheResult.error)) return nicheResult;');
    expect(source).toContain("if (specialistIds?.length) query = query.in('items.specialist_id', specialistIds)");
  });
});
