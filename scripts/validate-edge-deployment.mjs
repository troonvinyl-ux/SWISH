#!/usr/bin/env node
// Read-only deployment dependency and generated-asset parity gate.
// Does not execute Edge handlers, contact providers, or certify deployed revisions.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function validateEdgeDeployment(root = process.cwd()) {
  const boundary = path.resolve(root, 'supabase/functions');
  const errors = [];
  const files = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && /\.(?:ts|json)$/.test(file)) files.push(file);
    }
  }
  try {
    walk(boundary);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Deployment assets unavailable');
  }

  const mirrors = [
    ['shared/photoPersistence.ts', 'supabase/functions/_shared/photoPersistence.ts'],
    ['shared/smartStudio.ts', 'supabase/functions/_shared/smartStudio.ts'],
    ['shared/identificationPolicy.ts', 'supabase/functions/_shared/identificationPolicy.ts'],
    ['shared/musicRelease.ts', 'supabase/functions/_shared/musicRelease.ts'],
    ['niche-modules.json', 'supabase/functions/_shared/niche-modules.json'],
    ['shared/nicheAuthorization.ts', 'supabase/functions/_shared/nicheAuthorization.ts'],
    ['shared/specialistIntelligence.ts', 'supabase/functions/_shared/specialistIntelligence.ts'],
    ['shared/ebayMessagePagination.ts', 'supabase/functions/_shared/ebayMessagePagination.ts'],
    ['shared/ebayRevisionContract.ts', 'supabase/functions/_shared/ebayRevisionContract.ts'],
    ['shared/ebayImportScope.ts', 'supabase/functions/_shared/ebayImportScope.ts'],
    ['shared/nichePolicy.ts', 'supabase/functions/_shared/nichePolicy.ts'],
    ['shared/moduleRequestContract.ts', 'supabase/functions/_shared/moduleRequestContract.ts'],
  ];
  for (const [canonical, deployed] of mirrors) {
    const sourcePath = path.resolve(root, canonical);
    const deployedPath = path.resolve(root, deployed);
    if (!fs.existsSync(sourcePath) || !fs.existsSync(deployedPath)) {
      errors.push('missing canonical/deployable asset pair: ' + canonical + ' -> ' + deployed);
    } else if (canonical.endsWith('.json')
      ? JSON.stringify(JSON.parse(fs.readFileSync(sourcePath,'utf8'))) !== JSON.stringify(JSON.parse(fs.readFileSync(deployedPath,'utf8')))
      : !fs.readFileSync(sourcePath).equals(fs.readFileSync(deployedPath))) {
      errors.push('stale deployment asset mirror: ' + deployed);
    }
  }

  for (const file of files.filter(name => name.endsWith('.ts'))) {
    const source = fs.readFileSync(file, 'utf8');
    const imports = source.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["'](\.[^"']+)["']/g);
    for (const match of imports) {
      const target = path.resolve(path.dirname(file), match[1]);
      const relative = path.relative(boundary, target);
      const label = path.relative(root, file);
      if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) {
        errors.push(label + ': dependency escapes the deployable functions directory: ' + match[1]);
      } else if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
        errors.push(label + ': missing deployment dependency: ' + match[1]);
      }
    }
  }
  return {
    errors,
    functionCount: files.filter(file => path.basename(file) === 'index.ts' && path.dirname(file) !== path.join(boundary, '_shared')).length,
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = validateEdgeDeployment();
  if (result.errors.length) {
    console.error('SWISH Edge deployment validation FAILED:\n' + result.errors.join('\n'));
    process.exitCode = 1;
  } else console.log('SWISH Edge dependency boundary passed for ' + result.functionCount + ' functions; not deployed-version or live acceptance certification.');
}
