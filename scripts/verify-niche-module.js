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

// Check every retained route's static app-route imports. A shared screen must
// never pull another product's route module back into this bundle indirectly.
const foreignRouteModules = new Set();
for (const [id, config] of Object.entries(registry.products)) {
  if (id === niche) continue;
  for (const route of [config.entry, config.home, ...config.dedicatedRoutes].filter(Boolean)) {
    foreignRouteModules.add(route.replace(/\.tsx$/, ''));
  }
}
for (const route of actual) {
  const source = fs.readFileSync(path.join(generated, route), 'utf8');
  for (const match of source.matchAll(/from\s+['"]@\/app\/([^'"]+)['"]/g)) {
    const imported = match[1].replace(/\.tsx$/, '');
    if (foreignRouteModules.has(imported)) throw new Error('Foreign niche module imported by ' + route + ': ' + imported);
  }
}
console.log('Strict route and static app-module boundary verified for ' + niche + ' (' + actual.size + ' routes).');
