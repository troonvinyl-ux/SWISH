#!/usr/bin/env node
// The backend mirror is a generated deployment asset, NEVER an independently edited registry.
import fs from 'node:fs';
import path from 'node:path';
export function syncBackendRegistry(root = process.cwd(), check = false) {
  const canonical = JSON.parse(fs.readFileSync(path.join(root, 'niche-modules.json'), 'utf8'));
  const target = path.join(root, 'supabase/functions/_shared/niche-modules.json');
  if (check) {
    const deployed = JSON.parse(fs.readFileSync(target, 'utf8'));
    if (JSON.stringify(deployed) !== JSON.stringify(canonical)) throw new Error('Backend niche registry is stale. Run node scripts/sync-backend-registry.mjs and commit the generated asset.');
  } else {
    fs.writeFileSync(target, JSON.stringify(canonical, null, 2) + '\n');
  }
}
// These byte-identical deployment assets are generated from shared/; never edit
// them as independent rules. OnSpace deploys supabase/functions, not the repo root.
export const BACKEND_SHARED_ASSETS = ['nicheAuthorization.ts', 'specialistIntelligence.ts', 'ebayMessagePagination.ts'];
export function syncBackendSharedAssets(root = process.cwd(), check = false) {
  for (const name of BACKEND_SHARED_ASSETS) {
    const source = fs.readFileSync(path.join(root, 'shared', name), 'utf8');
    const target = path.join(root, 'supabase/functions/_shared', name);
    if (check) {
      if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== source) {
        throw new Error('Backend shared asset is stale: ' + name + '. Run node scripts/sync-backend-registry.mjs and commit generated assets.');
      }
    } else fs.writeFileSync(target, source);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  try {
    const check = process.argv.includes('--check');
    syncBackendRegistry(process.cwd(), check);
    syncBackendSharedAssets(process.cwd(), check);
    console.log('Canonical/backend registry and shared-asset parity confirmed.');
  }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
