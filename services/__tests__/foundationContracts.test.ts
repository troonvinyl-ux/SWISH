import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import registry from '@/niche-modules.json';
import mirror from '../../supabase/functions/_shared/niche-modules.json';
import { REGISTERED_NICHE_IDS, REGISTERED_MODULES, registeredSpecialistOwner, isOperationScope } from '@/shared/moduleContracts';
import { NICHES, PRODUCTION_NICHE_IDS } from '@/constants/niches';
import { nicheToScannerRoute } from '@/services/nicheRouting';
const root = path.resolve(__dirname, '../..');

test('backend identity is generated from the canonical registry with no independent edits', () => { expect(mirror).toEqual(registry); });
test('public production types/list derive from the registry', () => { expect(PRODUCTION_NICHE_IDS).toEqual(REGISTERED_NICHE_IDS); });
test.each(REGISTERED_NICHE_IDS)('%s owns a concrete scanner and canonical specialist contract', id => {
  const product = REGISTERED_MODULES[id];
  expect(nicheToScannerRoute(id)).toBe(product.scannerRoute);
  expect(fs.existsSync(path.join(root, 'app', product.scannerRoute.split('?')[0].slice(1) + '.tsx'))).toBe(true);
  expect(NICHES[id].specialists).toEqual(product.specialists);
  for (const specialist of [...product.specialists, ...product.legacySpecialists]) expect(registeredSpecialistOwner(specialist)).toBe(id);
});
test('scope validation rejects unknown products and malformed UUIDs; it never grants entitlements', () => {
  const scope = { tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', nicheId: 'coins' };
  expect(isOperationScope(scope)).toBe(true);
  expect(isOperationScope({ ...scope, nicheId: 'coin_fake' })).toBe(false);
  expect(isOperationScope({ ...scope, tenantId: 'bad' })).toBe(false);
  expect(registeredSpecialistOwner('curiosities_collectibles')).toBeNull();
});
test('read-only foundation validator enforces the real repository contract', () => {
  const result = spawnSync(process.execPath, ['scripts/validate-foundation.mjs'], { cwd: root, encoding: 'utf8' });
  expect(result.stderr).toBe(''); expect(result.status).toBe(0);
  expect(result.stdout).toContain('not production certification');
});
