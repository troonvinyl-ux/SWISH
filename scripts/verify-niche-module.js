#!/usr/bin/env node
'use strict';

// Validate the canonical niche-module registry before a branded native build.
// This guards product identity and specialist ownership; it does not by itself
// prove that Expo Router's generated bundle excludes other niche source files.
const fs = require('node:fs');
const path = require('node:path');

const registryPath = path.join(process.cwd(), 'niche-modules.json');
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
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

const appConfigPath = path.join(process.cwd(), 'app.config.js');
const appConfigText = fs.readFileSync(appConfigPath, 'utf8');
const packageMatch = appConfigText.match(new RegExp('(?:' + requested.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')\\s*:\\s*\\{[\\s\\S]*?androidPackage:\\s*["\\']([^"\\']+)["\\']'));
const expectedPackage = products[requested].package;
if (!expectedPackage) throw new Error(`Missing package identifier in niche-modules.json for ${requested}`);
if (!packageMatch || packageMatch[1] !== expectedPackage) {
  throw new Error(`Package mismatch for ${requested}: manifest=${expectedPackage}, app.config.js=${packageMatch?.[1] || 'not found'}`);
}

console.log(`Niche registry valid: ${requested} -> ${expectedPackage}`);
console.log('NOTE: registry validation is not bundle-level proof of source isolation.');
