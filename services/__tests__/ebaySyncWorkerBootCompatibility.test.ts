// New-only regression fixture: do not alter existing acceptance assertions.
// OnSpace may load a newer worker entrypoint against an older _shared policy file.
import fs from 'node:fs';

test('swish-ebay-sync boots when the OnSpace shared policy has no safeReconciliationIssue export', () => {
  const worker = fs.readFileSync('supabase/functions/swish-ebay-sync/index.ts', 'utf8');
  const policy = fs.readFileSync('supabase/functions/_shared/ebaySyncPolicy.ts', 'utf8');
  // ESM named imports are checked before worker code executes, causing the
  // observed InvalidWorkerCreation when older deployed policy files omit one.
  expect(worker).toContain("import * as ebaySyncPolicy from '../_shared/ebaySyncPolicy.ts'");
  expect(worker).toContain("typeof ebaySyncPolicy.safeReconciliationIssue === 'function'");
  expect(worker).not.toMatch(/import\s*\{[^}]*\bsafeReconciliationIssue\b[^}]*\}\s*from\s*['"]\.\.\/_shared\/ebaySyncPolicy\.ts/);
  expect(policy).toContain('export function safeReconciliationIssue(');
  expect(worker).toContain("code: 'SWISH_RECONCILIATION_UNCONFIRMED'");
  expect(worker).toContain('No new eBay listing was created.');
  // Existing provider restrictions and bounded canonical stock handling remain.
  expect(worker).toContain('issues.push(issue)');
  expect(worker).toContain('if(!observations.has(String(listing.external_listing_id)))continue;');
});
