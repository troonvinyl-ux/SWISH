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

// The registry must match the canonical specialist ownership in constants/niches.ts.
// This prevents aliases and guessed IDs from silently becoming product ownership.
const nicheSource = fs.readFileSync(path.join(root, 'constants/niches.ts'), 'utf8');
for (const [productId, product] of Object.entries(products)) {
  const start = nicheSource.indexOf(`  ${productId}: {`);
  if (start < 0) throw new Error(`Niche ${productId} is missing from constants/niches.ts`);
  const next = nicheSource.indexOf('\\n  },', start);
  const block = nicheSource.slice(start, next < 0 ? start + 5000 : next);
  const match = block.match(/specialists:\\s*\\[([^\\]]*)\\]/);
  if (!match) throw new Error(`Cannot read canonical specialists for ${productId}`);
  const canonicalIds = match[1].split(',').map(value => value.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean).sort();
  const registeredIds = [...product.specialistIds].sort();
  if (JSON.stringify(canonicalIds) !== JSON.stringify(registeredIds)) {
    throw new Error(`Specialist registry mismatch for ${productId}: constants/niches.ts=[${canonicalIds.join(', ')}], niche-modules.json=[${registeredIds.join(', ')}]`);
  }
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
// Where a physical module manifest exists, require it to match the central registry.
const moduleManifestPath = path.join(root, registry.nicheRoot || 'niches', requested, 'module.json');
if (fs.existsSync(moduleManifestPath)) {
  const moduleManifest = JSON.parse(fs.readFileSync(moduleManifestPath, 'utf8'));
  const registered = products[requested];
  if (moduleManifest.id !== requested) throw new Error(`Module manifest ID mismatch for ${requested}`);
  if (moduleManifest.androidPackage !== registered.package) throw new Error(`Module package mismatch for ${requested}`);
  if (JSON.stringify([...moduleManifest.specialistIds].sort()) !== JSON.stringify([...registered.specialistIds].sort())) {
    throw new Error(`Module specialist IDs do not match niche-modules.json for ${requested}`);
  }
}

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
