import { assessListingConfidence } from '@/supabase/functions/_shared/listingConfidencePolicy';

describe('server-side listing confidence policy', () => {
  test.each(['coins', 'coins_uk', 'coins_world', 'coins_currency', 'numismatic', 'islamic_silver', 'banknotes', 'gold', 'silver', 'jewellery_precious_metals', 'ancient_artefacts'])(
    '%s retains the advisory confidence disclosure below 95%',
    (specialistId) => {
      const result = assessListingConfidence(specialistId, 0.949, 'verified');
      expect(result.allowed).toBe(true);
      expect(result.threshold).toBe(0);
      expect(result.advisory).toContain('advisory only');
    },
  );

  test('coin listing at exactly 95% needs no advisory message', () => {
    expect(assessListingConfidence('coins', 0.95, 'verified')).toMatchObject({ allowed: true, advisory: undefined });
  });

  test('observation-only records retain a disclosure advisory in every niche', () => {
    for (const specialist of ['coins', 'clothing', 'motocross', 'antiques']) {
      expect(assessListingConfidence(specialist, 0.99, 'observation_only')).toMatchObject({ allowed: true, advisory: expect.stringContaining('advisory only') });
    }
  });

  test('non-coin items retain advisory disclosure rather than turning model confidence into a permission', () => {
    expect(assessListingConfidence('clothing', 0.29, 'candidate').allowed).toBe(true);
    expect(assessListingConfidence('clothing', 0.30, 'candidate').allowed).toBe(true);
    expect(assessListingConfidence('motocross', 0.55, 'candidate').allowed).toBe(true);
  });

  test('invalid or missing confidence is disclosed without creating an unregistered specialist bypass', () => {
    expect(assessListingConfidence('coins', undefined, 'candidate')).toMatchObject({ allowed: true, advisory: expect.any(String) });
    expect(assessListingConfidence('clothing', 'not-a-number', 'candidate')).toMatchObject({ allowed: true, advisory: expect.any(String) });
    expect(assessListingConfidence('unknown', 1, 'verified')).toMatchObject({ allowed: false, code: 'REGISTERED_SPECIALIST_REQUIRED' });
  });
});

test('eBay publish route enforces the server-side gate before requesting eBay credentials', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.resolve(__dirname, '../../supabase/functions/swish-ebay-list/index.ts'), 'utf8');
  expect(source).toContain('assessListingConfidence');
  expect(source).toContain('identification_confidence');
  const gateIndex = source.indexOf('if (!confidenceGate.allowed)');
  const publishCredentialsIndex = source.indexOf('getEbayCredentials(supabase, tenantId, true)', gateIndex);
  expect(gateIndex).toBeGreaterThan(-1);
  expect(publishCredentialsIndex).toBeGreaterThan(gateIndex);
});

test('listing UI explains the advisory confidence disclosure before a draft is generated', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.resolve(__dirname, '../../app/create-listing.tsx'), 'utf8');
  expect(source).toContain('identificationPublicationAdvice');
  expect(source).toContain('AI confidence is advisory');
});
