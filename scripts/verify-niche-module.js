#!/usr/bin/env node
'use strict';

// Validate the canonical niche-module registry before a branded native build.
// This guards product identity and specialist ownership; it does not by itself
// prove that Expo Router's generated bundle excludes other niche source files.
const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const registry = JSON.parse(fs.readFileSync(path.join(root, 'niche-modules.json'), 'utf8'));
const requested = process.env.SWISH_NICHE || process.env.NICHE;

if (!requested) {
  console.error('Set SWISH_NICHE (or NICHE) to the product being built.');
  process.exit(1);
}

const products = registry.products || {};
if (!Object.prototype.hasOwnProperty.call(products, requested)) {
  console.error(`Unknown SWISH niche "${requested}". Registered: ${Object.keys(products).join(', ')}`);
  process.exit(1);
}

const ownerBySpecialist = new Map();
for (const [productId, product] of Object.entries(products)) {
  if (product.id !== productId) throw new Error(`Manifest key/id mismatch for ${productId}`);
  if (!Array.isArray(product.specialistIds) || product.specialistIds.length === 0) {
    throw new Error(`No specialist IDs registered for ${productId}`);
  }
  for (const specialistId of product.specialistIds) {
    const previous = ownerBySpecialist.get(specialistId);
    if (previous && previous !== productId) {
      throw new Error(`Specialist ID "${specialistId}" belongs to both ${previous} and ${productId}`);
    }
    ownerBySpecialist.set(specialistId, productId);
  }
}

// Evaluate the real Expo dynamic config, rather than parsing source text with a
// regular expression. This ensures the check follows the same config path used
// by prebuild and catches future changes to app.config.js behaviour.
process.env.SWISH_NICHE = requested;
const appConfigFactory = require(path.join(root, 'app.config.js'));
const expoConfig = appConfigFactory({
  config: { name: 'SWISH', slug: 'swish', extra: {}, android: {}, ios: {} },
});
const expectedPackage = products[requested].package;
if (!expectedPackage) throw new Error(`Missing package identifier in niche-modules.json for ${requested}`);
if (expoConfig.extra?.swishNicheId !== requested) {
  throw new Error(`Niche mismatch: manifest=${requested}, Expo config=${expoConfig.extra?.swishNicheId || 'not set'}`);
}
if (expoConfig.android?.package !== expectedPackage) {
  throw new Error(`Package mismatch for ${requested}: manifest=${expectedPackage}, Expo config=${expoConfig.android?.package || 'not set'}`);
}

console.log(`Niche registry valid: ${requested} -> ${expectedPackage}`);
console.log('NOTE: registry validation is not bundle-level proof of source isolation.');
