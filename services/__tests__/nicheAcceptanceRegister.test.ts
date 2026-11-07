// The acceptance register must never turn source/mock coverage into device certification.
import fs from 'node:fs';
import { PRODUCTION_NICHE_IDS } from '@/constants/niches';
import { getNicheWorkflowPolicy } from '@/shared/nichePolicy';
const evidence = JSON.parse(fs.readFileSync('docs/SWISH_NICHE_STANDARDISATION_EVIDENCE.json', 'utf8'));
test('every registered niche has an independent, explicitly untested device/subscriber case', () => {
  expect(evidence.niches.map((row: any) => row.id).sort()).toEqual([...PRODUCTION_NICHE_IDS].sort());
  for (const row of evidence.niches) {
    expect(row.deviceAcceptance).toBe('NOT_TESTED');
    expect(row.subscriberIsolation).toBe('NOT_TESTED');
    expect(row.barcode).toBe(getNicheWorkflowPolicy(row.id)?.barcode);
  }
});
test('observed counts reconcile without modifying historical records or inventing new pipeline tests', () => {
  const totals = evidence.backendObservations;
  expect(evidence.niches.reduce((sum: number, row: any) => sum + row.items, 0) + totals.unclassifiedItems).toBe(totals.after.items);
  expect(totals.linkedOriginals + totals.unlinkedOriginals).toBe(totals.storedOriginals);
  expect(totals.before).toEqual(totals.after);
  expect(totals.userDataModified).toBe(false);
  expect(totals.newPhotoPipelineRecords).toBe(0);
  expect(evidence.checks.jest).toBe('NOT_RUN');
  expect(evidence.checks.liveEbayPublication).toBe('NOT_TESTED');
});
