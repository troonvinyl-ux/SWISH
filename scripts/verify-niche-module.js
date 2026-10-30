#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const registry = require('../niche-modules.json');
const root = path.resolve(__dirname, '..');
const niche = process.env.SWISH_NICHE || process.env.NICHE;
const product = registry.products[niche];
if (!product) throw new Error('A registered SWISH_NICHE is required.');
const owners = new Map();
for (const [id, config] of Object.entries(registry.products)) {
  if (config.id !== id || !config.specialists.includes(config.defaultSpecialist)) throw new Error('Invalid product contract: ' + id);
  for (const specialist of [...config.specialists, ...config.legacySpecialists]) {
    if (specialist === 'curiosities_collectibles' || (owners.has(specialist) && owners.get(specialist) !== id)) throw new Error('Specialist overlap: ' + specialist);
    owners.set(specialist, id);
  }
}
const generated = path.join(root, '.swish-build', niche, 'app');
for (const [id, config] of Object.entries(registry.products)) {
  for (const relative of [config.entry, ...config.dedicatedRoutes]) {
    if (id !== niche && fs.existsSync(path.join(generated, relative))) throw new Error('Foreign route packaged: ' + relative);
  }
}
if (!fs.existsSync(path.join(generated, product.entry))) throw new Error('Expected entry is missing.');
for (const relative of ['niche-select.tsx', 'master-admin.tsx']) if (fs.existsSync(path.join(generated, relative))) throw new Error('Global route packaged: ' + relative);
const home = fs.readFileSync(path.join(generated, '(tabs)/index.tsx'), 'utf8');
for (const [id, config] of Object.entries(registry.products)) if (id !== niche && config.home && home.includes('@/app/' + config.home.replace(/\.tsx$/, ''))) throw new Error('Foreign home import: ' + id);
console.log('Registry and generated route boundary verified for ' + niche);
