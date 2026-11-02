import { aggregateActualEbayFees, withActualEbayFeeNote } from '../../supabase/functions/_shared/ebayFinance';

describe('eBay actual fee aggregation', () => {
  test('adds percentage and fixed-per-order fee components', () => {
    expect(aggregateActualEbayFees([
      { transaction_type: 'FINAL_VALUE_FEE', amount: '-2.35' },
      { transaction_type: 'FINAL_VALUE_FEE_FIXED_PER_ORDER', amount: '-0.30' },
    ])).toBe(2.65);
  });

  test('ignores credits, unrelated debits, zero and invalid amounts', () => {
    expect(aggregateActualEbayFees([
      { transaction_type: 'FINAL_VALUE_FEE', amount: '-1.20' },
      { transaction_type: 'FINAL_VALUE_FEE', amount: '0.10' },
      { transaction_type: 'SHIPPING_LABEL', amount: '-4.00' },
      { transaction_type: 'FINAL_VALUE_FEE_FIXED_PER_ORDER', amount: 'invalid' },
    ])).toBe(1.2);
  });

  test('rounds the aggregated total to currency precision', () => {
    expect(aggregateActualEbayFees([
      { transaction_type: 'FINAL_VALUE_FEE', amount: '-0.105' },
      { transaction_type: 'FINAL_VALUE_FEE_FIXED_PER_ORDER', amount: '-0.105' },
    ])).toBe(0.21);
  });

  test('preserves operator notes while replacing the fee estimate marker', () => {
    expect(withActualEbayFeeNote('Fragile item | fee_note:ESTIMATE_12.8pct | buyer requested gift wrap'))
      .toBe('Fragile item | buyer requested gift wrap | fee_note:ACTUAL_EBAY');
  });

  test('does not duplicate an existing actual-fee marker', () => {
    expect(withActualEbayFeeNote('fee_note:ACTUAL_EBAY | Handle with care'))
      .toBe('Handle with care | fee_note:ACTUAL_EBAY');
  });
});