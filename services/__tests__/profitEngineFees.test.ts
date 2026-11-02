import { calculateProfit, getEbayFeeRate, PROFIT_ENGINE_VERSION } from '../profitEngine';

describe('UK eBay fee estimates and profit accounting', () => {
  test('uses the current general UK business rate, regulatory fee and order fee', () => {
    const result = calculateProfit({
      salePrice: 100, shippingRevenue: 5, acquisitionCost: 20,
      shippingCost: 3, packagingCost: 2,
    });
    expect(result.marketplaceFee).toBeCloseTo(105 * 0.129 + 105 * 0.0035 + 0.4, 6);
    expect(result.grossProfit).toBeCloseTo(105 - 20 - result.marketplaceFee - 3 - 2, 6);
    expect(result.netProfit).toBeCloseTo(result.grossProfit, 6);
    expect(result.shippingRevenue).toBe(5);
    expect(result.isEstimate).toBe(true);
    expect(result.modelVersion).toBe('v1.3');
  });

  test('uses the £0.30 fixed fee for orders up to and including £10', () => {
    const result = calculateProfit({ salePrice: 10, acquisitionCost: 2 });
    expect(result.marketplaceFee).toBeCloseTo(10 * 0.129 + 10 * 0.0035 + 0.3, 6);
  });

  test('applies the coin category 10.9% / 3% tier above £450', () => {
    const result = calculateProfit({ salePrice: 500, acquisitionCost: 100, specialistId: 'coins' });
    expect(result.marketplaceFee).toBeCloseTo(450 * 0.109 + 50 * 0.03 + 500 * 0.0035 + 0.4, 6);
  });

  test('uses documented category rates and the high-value trainer rate', () => {
    expect(getEbayFeeRate('antiques').finalValueFee).toBe(0.109);
    expect(getEbayFeeRate('clothing').finalValueFee).toBe(0.119);
    expect(getEbayFeeRate('tech').finalValueFee).toBe(0.099);
    expect(getEbayFeeRate('bicycles').finalValueFee).toBe(0.109);
    expect(getEbayFeeRate('surplus_flip').finalValueFee).toBe(0.129);
    const trainer = calculateProfit({ salePrice: 120, acquisitionCost: 20, specialistId: 'trainers_sneakers' });
    expect(trainer.marketplaceFee).toBeCloseTo(120 * 0.07 + 120 * 0.0035 + 0.4, 6);
  });

  test('UK private domestic sales have no final-value or regulatory operating fee', () => {
    const result = calculateProfit({ salePrice: 50, acquisitionCost: 10, ebaySellerType: 'private' });
    expect(result.marketplaceFee).toBe(0);
    expect(result.isEstimate).toBe(true);
  });

  test('UK private international sales apply the 3% international fee to item plus buyer postage', () => {
    const result = calculateProfit({
      salePrice: 20, shippingRevenue: 5, acquisitionCost: 5,
      ebaySellerType: 'private', isInternationalSale: true,
    });
    expect(result.marketplaceFee).toBeCloseTo(25 * 0.03, 6);
  });

  test('uses a conservative 2% international rate for UK business sales when destination is not supplied', () => {
    const result = calculateProfit({ salePrice: 100, acquisitionCost: 20, isInternationalSale: true });
    expect(result.marketplaceFee).toBeCloseTo(100 * (0.129 + 0.0035 + 0.02) + 0.4, 6);
  });

  test('an exact finance fee bypasses estimated rates and remains non-estimated when inputs are exact', () => {
    const result = calculateProfit({
      salePrice: 50, shippingRevenue: 5, acquisitionCost: 10,
      marketplaceFee: 3.22, ebaySellerType: 'private', isInternationalSale: true,
    });
    expect(result.marketplaceFee).toBe(3.22);
    expect(result.feeRateUsed).toBeCloseTo(3.22 / 55, 8);
    expect(result.isEstimate).toBe(false);
  });

  test('exposes a version bump for the changed fee model', () => {
    expect(PROFIT_ENGINE_VERSION).toBe('v1.3');
  });
});
