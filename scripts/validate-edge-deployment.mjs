#!/usr/bin/env node
// Read-only dependency-boundary gate. Resolves local imports without executing handlers.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncBackendRegistry, syncBackendSharedAssets } from './sync-backend-registry.mjs';

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
    syncBackendRegistry(root, true);
    syncBackendSharedAssets(root, true);
    walk(boundary);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Deployment assets unavailable');
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
  return { errors, functionCount: files.filter(file => path.basename(file) === 'index.ts' && path.dirname(file) !== path.join(boundary, '_shared')).length };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = validateEdgeDeployment();
  if (result.errors.length) {
    console.error('SWISH Edge deployment validation FAILED:\n' + result.errors.join('\n'));
    process.exitCode = 1;
  } else console.log('SWISH Edge dependency boundary passed for ' + result.functionCount + ' functions; not deployed-version or live acceptance certification.');
}
