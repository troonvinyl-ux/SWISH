#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const registry = require('../niche-modules.json');
const root = path.resolve(__dirname, '..');
const niche = process.env.SWISH_NICHE || process.env.NICHE;
const product = registry.products[niche];
if (!product) throw new Error('A registered SWISH_NICHE is required.');
if (!Array.isArray(registry.sharedRoutes) || !Array.isArray(registry.adminOnlyRoutes)) {
  throw new Error('The canonical niche registry must classify shared and admin-only routes.');
}

const routeOwners = new Map();
for (const [id, config] of Object.entries(registry.products)) {
  if (config.id !== id || !config.specialists.includes(config.defaultSpecialist)) throw new Error('Invalid product contract: ' + id);
  for (const route of [config.entry, config.home, ...config.dedicatedRoutes].filter(Boolean)) {
    const existingOwner = routeOwners.get(route);
    if (existingOwner && existingOwner !== id) throw new Error('Route has multiple niche owners: ' + route);
    routeOwners.set(route, id);
  }
}
const shared = new Set(registry.sharedRoutes);
const admin = new Set(registry.adminOnlyRoutes);
for (const route of [...shared, ...admin]) {
  if (routeOwners.has(route) || (shared.has(route) && admin.has(route))) throw new Error('Conflicting route ownership: ' + route);
}
const generated = path.join(root, '.swish-build', niche, 'app');
const allowed = new Set([...shared, product.entry, product.home, ...product.dedicatedRoutes].filter(Boolean));
const actual = new Set();
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else {
      const relative = path.relative(generated, full).split(path.sep).join('/');
      if (!relative.endsWith('.tsx')) continue;
      actual.add(relative);
      if (!allowed.has(relative)) throw new Error('Unexpected route packaged in ' + niche + ': ' + relative);
    }
  }
}
walk(generated);
for (const route of allowed) if (!actual.has(route)) throw new Error('Expected route missing from ' + niche + ' build: ' + route);
for (const route of admin) if (actual.has(route)) throw new Error('Admin-only route packaged in niche APK: ' + route);
for (const [id, config] of Object.entries(registry.products)) {
  if (id === niche) continue;
  for (const route of [config.entry, config.home, ...config.dedicatedRoutes].filter(Boolean)) {
    if (actual.has(route)) throw new Error('Foreign niche route packaged: ' + route + ' (' + id + ')');
  }
}
const home = fs.readFileSync(path.join(generated, '(tabs)/index.tsx'), 'utf8');
if (product.home) {
  const expectedImport = "@/app/" + product.home.replace(/\.tsx$/, '');
  if (!home.includes(expectedImport)) throw new Error('Selected niche home is not the only home imported.');
} else if (!home.includes("NicheOverview as ProductHome")) {
  throw new Error('Generic registered niche home is missing.');
}
for (const [id, config] of Object.entries(registry.products)) {
  if (id !== niche && config.home && home.includes('@/app/' + config.home.replace(/\.tsx$/, ''))) {
    throw new Error('Foreign home import: ' + id);
  }
}

// Traverse the complete local static dependency graph from the generated route
// tree. A shared screen cannot pull a foreign niche route back into the bundle
// indirectly through a component, hook, or service import.
const extensions = ['.ts', '.tsx', '.js', '.jsx', '.json'];
function resolveLocalImport(fromFile, specifier) {
  let base;
  if (specifier.startsWith('@/')) base = path.join(root, specifier.slice(2));
  else if (specifier.startsWith('.')) base = path.resolve(path.dirname(fromFile), specifier);
  else return null;
  const candidates = [];
  for (const candidate of [base, ...extensions.map(ext => base + ext)]) candidates.push(candidate);
  for (const ext of extensions) candidates.push(path.join(base, 'index' + ext));
  for (const candidate of candidates) if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return path.resolve(candidate);

  // Generated route files are copied under .swish-build; relative imports
  // which target a canonical app sibling can be resolved against app/ too.
  if (fromFile.startsWith(generated + path.sep)) {
    const relative = path.relative(generated, fromFile);
    const canonicalFrom = path.join(root, 'app', relative);
    const fallback = path.resolve(path.dirname(canonicalFrom), specifier);
    const fallbackCandidates = [fallback, ...extensions.map(ext => fallback + ext)];
    for (const ext of extensions) fallbackCandidates.push(path.join(fallback, 'index' + ext));
    for (const candidate of fallbackCandidates) if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return path.resolve(candidate);
  }
  return null;
}
const visited = new Set();
const pending = [...actual].map(route => path.join(generated, route));
const canonicalApp = path.join(root, 'app') + path.sep;
while (pending.length) {
  const file = pending.pop();
  if (visited.has(file) || !fs.existsSync(file)) continue;
  visited.add(file);
  if (file.startsWith(canonicalApp)) {
    const relativeRoute = path.relative(path.join(root, 'app'), file).split(path.sep).join('/');
    if (!allowed.has(relativeRoute)) throw new Error('Foreign niche route reached through a local import: ' + relativeRoute);
  }
  if (!/\.(?:ts|tsx|js|jsx)$/.test(file)) continue;
  const source = fs.readFileSync(file, 'utf8');
  const imports = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(imports)) {
    const resolved = resolveLocalImport(file, match[1]);
    if (resolved) pending.push(resolved);
  }
}
console.log('Strict route and transitive app-module boundary verified for ' + niche + ' (' + actual.size + ' routes, ' + visited.size + ' local modules).');
