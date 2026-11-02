import { assessListingConfidence } from '@/supabase/functions/_shared/listingConfidencePolicy';

describe('server-side listing confidence policy', () => {
  test.each(['coins', 'coins_uk', 'coins_world', 'coins_currency', 'numismatic', 'islamic_silver', 'banknotes', 'gold', 'silver', 'jewellery_precious_metals', 'ancient_artefacts'])(
    '%s cannot publish below 95% confidence',
    (specialistId) => {
      const result = assessListingConfidence(specialistId, 0.949, 'verified');
      expect(result.allowed).toBe(false);
      expect(result.code).toBe('COIN_CONFIDENCE_BELOW_THRESHOLD');
      expect(result.threshold).toBe(0.95);
    },
  );

  test('coin listing at exactly 95% can pass the confidence gate', () => {
    expect(assessListingConfidence('coins', 0.95, 'verified').allowed).toBe(true);
  });

  test('observation-only records cannot publish in any niche', () => {
    for (const specialist of ['coins', 'clothing', 'motocross', 'antiques']) {
      expect(assessListingConfidence(specialist, 0.99, 'observation_only').allowed).toBe(false);
    }
  });

  test('non-coin items below 30% require review, while disclosed provisional candidates can proceed', () => {
    expect(assessListingConfidence('clothing', 0.29, 'candidate').allowed).toBe(false);
    expect(assessListingConfidence('clothing', 0.30, 'candidate').allowed).toBe(true);
    expect(assessListingConfidence('motocross', 0.55, 'candidate').allowed).toBe(true);
  });

  test('invalid or missing confidence fails closed', () => {
    expect(assessListingConfidence('coins', undefined, 'candidate').allowed).toBe(false);
    expect(assessListingConfidence('clothing', 'not-a-number', 'candidate').allowed).toBe(false);
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

test('coin listing UI explains the 95% publication lock before a draft is generated', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.resolve(__dirname, '../../app/create-listing.tsx'), 'utf8');
  expect(source).toContain('coinPublishBlocked');
  expect(source).toContain('Coin eBay publication is locked below 95% identification confidence');
  expect(source).toContain('Prepare Review Draft · eBay Locked');
});
