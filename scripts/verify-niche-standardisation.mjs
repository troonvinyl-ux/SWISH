#!/usr/bin/env node
// Read-only source parity check. Never executes providers or certifies device acceptance.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateEdgeDeployment } from './validate-edge-deployment.mjs';
export function verifyNicheStandardisation(root = process.cwd()) {
  const registry = JSON.parse(fs.readFileSync(path.join(root, 'niche-modules.json'), 'utf8'));
  const failures = []; const owners = new Map(); const packages = new Set();
  for (const [id, product] of Object.entries(registry.products)) {
    if (product.id !== id || !product.specialists.includes(product.defaultSpecialist)) failures.push(id + ': invalid canonical identity');
    if (packages.has(product.androidPackage)) failures.push(id + ': duplicate Android package'); packages.add(product.androidPackage);
    for (const specialist of new Set([...product.specialists, ...product.legacySpecialists])) {
      if (owners.has(specialist) && owners.get(specialist) !== id) failures.push(specialist + ': multiple niche owners');
      owners.set(specialist, id);
    }
    const descriptor = JSON.parse(fs.readFileSync(path.join(root, 'niches', id, 'module.json'), 'utf8'));
    for (const [field, expected] of [['specialistIds', product.specialists], ['legacySpecialistIds', product.legacySpecialists], ['defaultSpecialistId', product.defaultSpecialist], ['scannerRoute', product.scannerRoute]]) {
      if (JSON.stringify(descriptor[field]) !== JSON.stringify(expected)) failures.push(id + ': stale descriptor ' + field);
    }
    for (const file of [product.entry, product.home, ...product.dedicatedRoutes].filter(Boolean)) if (!fs.existsSync(path.join(root, 'app', file))) failures.push(id + ': missing preserved route ' + file);
  }
  if (owners.has('curiosities_collectibles')) failures.push('Generic catch-all must not own production inventory');
  failures.push(...validateEdgeDeployment(root).errors);
  return { registeredNiches: Object.keys(registry.products).length, failures, acceptance: 'CI/source checks only; device and separate subscriber sessions remain required' };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const result = verifyNicheStandardisation(); console.log(JSON.stringify(result, null, 2)); if (result.failures.length) process.exitCode = 1; }
  catch (cause) { console.error(cause instanceof Error ? cause.message : 'Source verification failed'); process.exitCode = 1; }
}
