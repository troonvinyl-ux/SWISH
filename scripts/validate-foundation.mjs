#!/usr/bin/env node
// Read-only canonical SWISH foundation check. This is not production certification.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const errors = [];
const fail = message => errors.push(message);
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
let canonical;
let mirror;
try {
  canonical = read('niche-modules.json');
  mirror = read('supabase/functions/_shared/niche-modules.json');
} catch (error) {
  console.error('SWISH foundation validation FAILED: registry could not be read.');
  process.exit(1);
}
if (JSON.stringify(canonical) !== JSON.stringify(mirror)) fail('shared Edge Function niche registry must exactly match the canonical registry');
if (canonical.version !== 1 || canonical.contractVersion !== 1) fail('unsupported or missing registry contract version');
if (!Array.isArray(canonical.coreServices) || canonical.coreServices.length === 0) fail('coreServices must be a non-empty array');
const products = canonical.products && typeof canonical.products === 'object' ? canonical.products : {};
const ids = Object.keys(products);
if (ids.length !== 10) fail('exactly ten niche products must be registered');
const packages = new Set();
const iosBundles = new Set();
const schemes = new Set();
const specialistOwners = new Map();
for (const [id, product] of Object.entries(products)) {
  if (!product || product.id !== id || !product.name || !product.entry || !product.androidPackage || !product.iosBundleIdentifier || !product.scheme) {
    fail('invalid canonical identity for niche ' + id);
    continue;
  }
  for (const [label, value, seen] of [
    ['Android package', product.androidPackage, packages],
    ['iOS bundle identifier', product.iosBundleIdentifier, iosBundles],
    ['deep-link scheme', product.scheme, schemes],
  ]) {
    if (seen.has(value)) fail('duplicate ' + label + ': ' + value);
    seen.add(value);
  }
  if (!fs.existsSync(path.join(root, 'app', product.entry))) fail(id + ' entry file is missing: ' + product.entry);
  if (product.home && !fs.existsSync(path.join(root, 'app', product.home))) fail(id + ' home route is missing: ' + product.home);
  if (typeof product.scannerRoute !== 'string' || !product.scannerRoute.startsWith('/') || product.scannerRoute.startsWith('//')) fail(id + ' scannerRoute must be an absolute app route');
  else {
    const routePath = product.scannerRoute.split('?')[0].replace(/^\\//, '');
    const routeFile = routePath + (routePath.endsWith('.tsx') ? '' : '.tsx');
    if (!fs.existsSync(path.join(root, 'app', routeFile))) fail(id + ' scanner route is missing: ' + routeFile);
  }
  if (!Array.isArray(product.specialists) || product.specialists.length === 0) fail(id + ' requires canonical specialists');
  if (!product.defaultSpecialist || !product.specialists?.includes(product.defaultSpecialist)) fail(id + ' defaultSpecialist must belong to its canonical specialists');
  for (const specialist of [...(product.specialists ?? []), ...(product.legacySpecialists ?? [])]) {
    if (specialistOwners.has(specialist) && specialistOwners.get(specialist) !== id) fail('specialist ' + specialist + ' has multiple niche owners');
    specialistOwners.set(specialist, id);
  }
  if (product.legacySpecialists && !Array.isArray(product.legacySpecialists)) fail(id + ' legacySpecialists must be an array when present');
  for (const route of product.dedicatedRoutes ?? []) {
    if (!fs.existsSync(path.join(root, 'app', route))) fail(id + ' dedicated route is missing: ' + route);
  }
}
if (packages.size !== ids.length) fail('every registered niche must have a unique Android package');
if (iosBundles.size !== ids.length) fail('every registered niche must have a unique iOS bundle identifier');
if (schemes.size !== ids.length) fail('every registered niche must have a unique deep-link scheme');
if (errors.length) {
  console.error('SWISH foundation validation FAILED:');
  for (const error of errors) console.error('- ' + error);
  process.exit(1);
}
console.log('SWISH foundation checks passed; not production certification.');
