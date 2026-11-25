/** Seller intent shared by all SWISH listing flows. Values are in GBP pence. */
export interface DeliveryRate {
  destinationGroup: string;
  countries: string[];
  amountMinor: number;
}

export interface DeliveryPreferences {
  profileName: string;
  marketplace: 'EBAY_GB';
  currency: 'GBP';
  domestic: {
    mode: 'simple_delivery' | 'custom' | 'none';
    payer: 'buyer' | 'seller';
    serviceId?: string;
    amountMinor?: number;
  };
  international: {
    mode: 'off' | 'ebay_managed' | 'seller_managed';
    servicePreference?: 'tracked';
    serviceId?: string;
    rates: DeliveryRate[];
    exclusions: string[];
  };
  collection: { enabled: boolean; only: boolean };
  handlingDays?: number;
}

// Candidate destinations for the template. Each shipment still requires current
// marketplace, carrier and item eligibility checks.
const europe = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE',
  'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'NO', 'PL',
  'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'CH', 'IS', 'LI',
];

export function coinsInternationalTemplate(): DeliveryPreferences {
  return {
    profileName: 'Coins – International',
    marketplace: 'EBAY_GB',
    currency: 'GBP',
    domestic: { mode: 'simple_delivery', payer: 'buyer' },
    international: {
      mode: 'seller_managed',
      servicePreference: 'tracked',
      rates: [
        { destinationGroup: 'Europe', countries: [...europe], amountMinor: 1295 },
        { destinationGroup: 'US', countries: ['US'], amountMinor: 1595 },
        { destinationGroup: 'CA', countries: ['CA'], amountMinor: 1595 },
        { destinationGroup: 'AU', countries: ['AU'], amountMinor: 1795 },
        { destinationGroup: 'NZ', countries: ['NZ'], amountMinor: 1795 },
      ],
      exclusions: [],
    },
    collection: { enabled: false, only: false },
  };
}

export interface DeliveryCapabilityEvidence {
  simpleDelivery: boolean;
  simpleWithSellerManagedInternational: boolean;
  customDomestic: boolean;
  ebayManagedInternational: boolean;
  collection: boolean;
  collectionWithPostage: boolean;
  buyerPaidSimpleDelivery: boolean;
  sellerPaidSimpleDelivery: boolean;
  eligibleDomesticServices: ReadonlySet<string>;
  eligibleTrackedCountriesByService: ReadonlyMap<string, ReadonlySet<string>>;
}

const isMinorAmount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Checks seller intent against listing-specific evidence supplied by the caller. */
export function deliveryPublicationIssue(
  profile: DeliveryPreferences,
  evidence: DeliveryCapabilityEvidence,
): string | undefined {
  const { domestic, international, collection } = profile;
  if (collection.only) {
    if (!collection.enabled || domestic.mode !== 'none' || international.mode !== 'off') {
      return 'Collection-only delivery requires collection to be enabled and postage to be off.';
    }
    return evidence.collection ? undefined : 'eBay collection eligibility could not be confirmed.';
  }
  if (collection.enabled && (!evidence.collection || !evidence.collectionWithPostage)) {
    return 'eBay could not confirm collection alongside postage for this listing.';
  }
  if (domestic.mode === 'simple_delivery') {
    if (!evidence.simpleDelivery) return 'eBay Simple Delivery eligibility could not be confirmed.';
    const payerSupported = domestic.payer === 'buyer' ? evidence.buyerPaidSimpleDelivery : evidence.sellerPaidSimpleDelivery;
    if (!payerSupported) return 'eBay could not confirm the selected Simple Delivery postage payer.';
    if (international.mode === 'seller_managed' && !evidence.simpleWithSellerManagedInternational) {
      return 'eBay could not confirm Simple Delivery with your fixed international rates. Choose eBay-managed international delivery, custom domestic and international postage where eligible, or UK-only Simple Delivery.';
    }
  }
  if (domestic.mode === 'custom' && (
    !evidence.customDomestic || !domestic.serviceId ||
    !evidence.eligibleDomesticServices.has(domestic.serviceId) ||
    !isMinorAmount(domestic.amountMinor) ||
    (domestic.payer === 'seller' && domestic.amountMinor !== 0)
  )) {
    return 'Select an eligible UK postage service and a valid buyer charge.';
  }
  if (international.mode === 'ebay_managed' && !evidence.ebayManagedInternational) {
    return 'eBay-managed international delivery eligibility could not be confirmed.';
  }
  if (international.mode !== 'seller_managed') {
    return domestic.mode === 'none' && international.mode === 'off'
      ? 'Select postage or collection for this listing.'
      : undefined;
  }

  const eligibleCountries = international.serviceId
    ? evidence.eligibleTrackedCountriesByService.get(international.serviceId)
    : undefined;
  if (!eligibleCountries) return 'Select an eligible tracked international postage service.';
  if (international.rates.length === 0) return 'Add at least one international destination rate.';
  const usedCountries = new Set<string>();
  const exclusions = new Set(international.exclusions);
  for (const rate of international.rates) {
    if (!isMinorAmount(rate.amountMinor) || rate.countries.length === 0) {
      return 'Every international rate needs a price in whole pence and at least one destination.';
    }
    for (const country of rate.countries) {
      if (!/^[A-Z]{2}$/.test(country) || country === 'GB' || !eligibleCountries.has(country) || exclusions.has(country)) {
        return `The chosen tracked service cannot be confirmed for ${country}.`;
      }
      if (usedCountries.has(country)) return `Set a single postage rate for ${country}.`;
      usedCountries.add(country);
    }
  }
  return undefined;
}

const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const countryList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length <= 250 &&
  value.every(code => typeof code === 'string' && /^[A-Z]{2}$/.test(code) && code !== 'GB');
const serviceIdentifier = (value: unknown): value is string | undefined =>
  value === undefined || (typeof value === 'string' && /^[A-Za-z0-9_ -]{1,100}$/.test(value));

/** Validate and copy the request before storing it. Live eligibility is a separate check. */
export function parseDeliveryPreferences(value: unknown): DeliveryPreferences | null {
  const input = asObject(value);
  if (!input || typeof input.profileName !== 'string' || !input.profileName.trim() ||
    input.profileName.trim().length > 80 || input.marketplace !== 'EBAY_GB' || input.currency !== 'GBP') return null;

  const domestic = asObject(input.domestic);
  const international = asObject(input.international);
  const collection = asObject(input.collection);
  if (!domestic || !international || !collection) return null;
  const domesticMode = domestic.mode;
  const internationalMode = international.mode;
  const { payer } = domestic;
  if ((domesticMode !== 'simple_delivery' && domesticMode !== 'custom' && domesticMode !== 'none') ||
    (payer !== 'buyer' && payer !== 'seller') ||
    (internationalMode !== 'off' && internationalMode !== 'ebay_managed' && internationalMode !== 'seller_managed') ||
    typeof collection.enabled !== 'boolean' || typeof collection.only !== 'boolean' ||
    !serviceIdentifier(domestic.serviceId) || !serviceIdentifier(international.serviceId) ||
    (international.servicePreference !== undefined && international.servicePreference !== 'tracked') ||
    !countryList(international.exclusions) || !Array.isArray(international.rates) ||
    international.rates.length > 250) return null;

  if (domestic.amountMinor !== undefined && !isMinorAmount(domestic.amountMinor)) return null;
  if (input.handlingDays !== undefined && (typeof input.handlingDays !== 'number' ||
    !Number.isInteger(input.handlingDays) || input.handlingDays < 0 || input.handlingDays > 30)) return null;
  if (collection.only && (!collection.enabled || domesticMode !== 'none' || internationalMode !== 'off')) return null;

  const countries = new Set<string>();
  const exclusions = new Set(international.exclusions);
  const rates: DeliveryRate[] = [];
  for (const value of international.rates) {
    const rate = asObject(value);
    if (!rate || typeof rate.destinationGroup !== 'string' || !rate.destinationGroup.trim() ||
      rate.destinationGroup.length > 80 || !isMinorAmount(rate.amountMinor) ||
      !countryList(rate.countries) || !rate.countries.length ||
      rate.countries.some(country => countries.has(country) || exclusions.has(country)) ||
      new Set(rate.countries).size !== rate.countries.length) return null;
    for (const country of rate.countries) countries.add(country);
    rates.push({ destinationGroup: rate.destinationGroup.trim(), amountMinor: rate.amountMinor, countries: [...rate.countries] });
  }
  if (internationalMode === 'seller_managed' && !rates.length) return null;

  return {
    profileName: input.profileName.trim(),
    marketplace: 'EBAY_GB',
    currency: 'GBP',
    domestic: { mode: domesticMode, payer, serviceId: domestic.serviceId, amountMinor: domestic.amountMinor },
    international: {
      mode: internationalMode,
      servicePreference: international.servicePreference,
      serviceId: international.serviceId,
      rates,
      exclusions: [...exclusions],
    },
    collection: { enabled: collection.enabled, only: collection.only },
    handlingDays: input.handlingDays,
  };
}
