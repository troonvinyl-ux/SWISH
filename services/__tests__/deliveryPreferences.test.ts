import {
  coinsInternationalTemplate,
  deliveryPublicationIssue,
  type DeliveryCapabilityEvidence,
} from '../../supabase/functions/_shared/deliveryPreferences';

function eligibleEvidence(): DeliveryCapabilityEvidence {
  const countries = coinsInternationalTemplate().international.rates.flatMap(rate => rate.countries);
  return {
    simpleDelivery: true,
    simpleWithSellerManagedInternational: true,
    customDomestic: true,
    ebayManagedInternational: true,
    collection: true,
    collectionWithPostage: true,
    buyerPaidSimpleDelivery: true,
    sellerPaidSimpleDelivery: true,
    eligibleDomesticServices: new Set(),
    eligibleTrackedCountriesByService: new Map([['test-tracked', new Set(countries)]]),
  };
}

test('starts with exact rates and a fresh explicit European allowlist', () => {
  const profile = coinsInternationalTemplate();
  expect(profile.international.rates.map(rate => rate.amountMinor)).toEqual([1295, 1595, 1595, 1795, 1795]);
  expect(profile.collection).toEqual({ enabled: false, only: false });
  expect(profile.handlingDays).toBeUndefined();
  profile.international.rates[0].countries.push('GB');
  expect(coinsInternationalTemplate().international.rates[0].countries).not.toContain('GB');
});

test('requires combination-specific evidence and preserves the profile for correction', () => {
  const profile = coinsInternationalTemplate();
  profile.international.serviceId = 'test-tracked';
  const before = JSON.stringify(profile);
  expect(deliveryPublicationIssue(profile, { ...eligibleEvidence(), simpleWithSellerManagedInternational: false })).toMatch(/fixed international rates/);
  expect(JSON.stringify(profile)).toEqual(before);
  expect(deliveryPublicationIssue(profile, eligibleEvidence())).toBeUndefined();
});

test('requires a tracked service and blocks excluded or overlapping destinations', () => {
  const profile = coinsInternationalTemplate();
  const evidence = eligibleEvidence();
  expect(deliveryPublicationIssue(profile, evidence)).toMatch(/tracked international/);
  profile.international.serviceId = 'test-tracked';
  profile.international.exclusions = ['US'];
  expect(deliveryPublicationIssue(profile, evidence)).toMatch(/for US/);
  profile.international.exclusions = [];
  profile.international.rates[0].countries.push('US');
  expect(deliveryPublicationIssue(profile, evidence)).toMatch(/single postage rate for US/);
});

test('allows eligible collection only after both postage modes are disabled', () => {
  const profile = coinsInternationalTemplate();
  const evidence = eligibleEvidence();
  profile.collection = { enabled: true, only: true };
  expect(deliveryPublicationIssue(profile, evidence)).toMatch(/postage to be off/);
  profile.domestic.mode = 'none';
  profile.international.mode = 'off';
  expect(deliveryPublicationIssue(profile, evidence)).toBeUndefined();
});
