#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const registry = require('../niche-modules.json');

function prepareNicheRoutes(niche, root = path.resolve(__dirname, '..')) {
  const product = registry.products[niche];
  if (!product) throw new Error('Unknown SWISH_NICHE: ' + niche);
  const source = path.join(root, 'app');
  const output = path.join(root, '.swish-build', niche, 'app');
  const excluded = new Set(['niche-select.tsx', 'master-admin.tsx']);
  for (const [id, config] of Object.entries(registry.products)) {
    if (id !== niche) for (const route of [config.entry, ...config.dedicatedRoutes]) excluded.add(route);
  }
  const kept = new Set();
  const removed = new Set();
  function save(relative, content) {
    const target = path.join(output, relative);
    kept.add(relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== content) fs.writeFileSync(target, content);
  }
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      const relative = path.relative(source, full).split(path.sep).join('/');
      if (entry.isDirectory()) { walk(full); continue; }
      if (excluded.has(relative) || (relative.startsWith('entry/') && relative !== product.entry)) { removed.add(relative.replace(/\.tsx$/, '')); continue; }
      save(relative, fs.readFileSync(full, 'utf8'));
    }
  }
  walk(source);
  if (!kept.has(product.entry)) throw new Error('Missing entry route: ' + product.entry);
  const homeImport = product.home
    ? `import ProductHome from '@/app/${product.home.replace(/\.tsx$/, '')}';`
    : "import { NicheOverview as ProductHome } from '@/components/feature/NicheOverview';";
  const props = product.home === 'surplus-flip.tsx' || !product.home ? '' : ' isHomeTab';
  save('(tabs)/index.tsx', `${homeImport}\nexport default function NicheHomeScreen() { return <ProductHome${props} />; }\n`);
  // Only remove Stack declarations for routes actually absent from this artifact.
  const layoutPath = path.join(output, '_layout.tsx');
  const layout = fs.readFileSync(layoutPath, 'utf8').split('\n').filter(line => {
    const match = line.match(/<Stack\.Screen\s+name=["']([^"']+)["']/);
    return !match || !removed.has(match[1]);
  }).join('\n');
  save('_layout.tsx', layout);
  // Delete stale generated output only; never touch the canonical app tree.
  function clean(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) { clean(full); continue; }
      const relative = path.relative(output, full).split(path.sep).join('/');
      if (!kept.has(relative)) fs.unlinkSync(full);
    }
  }
  clean(output);
  return path.relative(root, output).split(path.sep).join('/');
}
module.exports = { prepareNicheRoutes };
if (require.main === module) {
  const niche = process.env.SWISH_NICHE || process.env.NICHE;
  if (!niche) throw new Error('Set SWISH_NICHE to the branded app being built.');
  console.log('Prepared isolated route root: ' + prepareNicheRoutes(niche));
}
