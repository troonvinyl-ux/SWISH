#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const registry = require('../niche-modules.json');

function prepareNicheRoutes(niche, root = path.resolve(__dirname, '..')) {
  const product = registry.products[niche];
  if (!product) throw new Error('Unknown SWISH_NICHE: ' + niche);
  if (!Array.isArray(registry.sharedRoutes) || !Array.isArray(registry.adminOnlyRoutes)) {
    throw new Error('The canonical niche registry must classify shared and admin-only routes.');
  }

  // Fail closed: every route in app/ must be explicitly shared, admin-only,
  // or owned by exactly one niche. New routes cannot silently enter every APK.
  const routeOwners = new Map();
  for (const [id, config] of Object.entries(registry.products)) {
    for (const route of [config.entry, config.home, ...config.dedicatedRoutes].filter(Boolean)) {
      const existingOwner = routeOwners.get(route);
      if (existingOwner && existingOwner !== id) throw new Error('Route has multiple niche owners: ' + route);
      routeOwners.set(route, id);
    }
  }
  const ownedRoutes = new Set(routeOwners.keys());
  const adminRoutes = new Set(registry.adminOnlyRoutes);
  const sharedRoutes = new Set(registry.sharedRoutes);
  for (const route of sharedRoutes) {
    if (adminRoutes.has(route) || ownedRoutes.has(route)) throw new Error('Route has conflicting build ownership: ' + route);
  }
  for (const route of adminRoutes) {
    if (ownedRoutes.has(route) || sharedRoutes.has(route)) throw new Error('Route has conflicting build ownership: ' + route);
  }

  const allowed = new Set([
    ...registry.sharedRoutes,
    product.entry,
    ...(product.dedicatedRoutes || []),
    ...(product.home ? [product.home] : []),
  ]);
  const classified = new Set([...sharedRoutes, ...adminRoutes, ...ownedRoutes]);
  const source = path.join(root, 'app');
  const output = path.join(root, '.swish-build', niche, 'app');
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
      if (!classified.has(relative)) throw new Error('Unclassified app route; assign it in niche-modules.json: ' + relative);
      if (!allowed.has(relative)) {
        removed.add(relative.replace(/\.tsx$/, ''));
        continue;
      }
      save(relative, fs.readFileSync(full, 'utf8'));
    }
  }

  walk(source);
  for (const route of allowed) {
    if (!kept.has(route)) throw new Error('Declared route is missing from app/: ' + route);
  }
  if (!kept.has(product.entry)) throw new Error('Missing entry route: ' + product.entry);

  const homeImport = product.home
    ? "import ProductHome from '@/app/" + product.home.replace(/\.tsx$/, '') + "';"
    : "import { NicheOverview as ProductHome } from '@/components/feature/NicheOverview';";
  const props = product.home ? ' isHomeTab' : '';
  save('(tabs)/index.tsx', homeImport + '\nexport default function NicheHomeScreen() { return <ProductHome' + props + ' />; }\n');

  // Remove navigator declarations for routes not present in this product's
  // generated tree. Handles multi-line Stack.Screen and Tabs.Screen elements.
  function pruneLayout(relative) {
    const target = path.join(output, relative);
    if (!fs.existsSync(target)) return;
    const layout = fs.readFileSync(target, 'utf8').replace(/<(Stack|Tabs)\.Screen\b[\s\S]*?\/>/g, block => {
      const match = block.match(/\bname=["']([^"']+)["']/);
      if (!match) return block;
      const name = match[1];
      const directory = path.posix.dirname(relative);
      if (name.startsWith('(') && !name.includes('/')) return block;
      const route = (directory === '.' ? name : path.posix.join(directory, name)).replace(/\.tsx$/, '');
      return removed.has(route) ? '' : block;
    });
    save(relative, layout);
  }
  for (const relative of [...kept].filter(file => file.endsWith('_layout.tsx'))) pruneLayout(relative);

  // Delete stale generated output only; never touch the canonical app tree.
  function clean(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) { clean(full); if (fs.readdirSync(full).length === 0) fs.rmdirSync(full); continue; }
      const relative = path.relative(output, full).split(path.sep).join('/');
      if (!kept.has(relative)) fs.unlinkSync(full);
    }
  }
  clean(output);
  return path.relative(root, output).split(path.sep).join('/');
}
module.exports = { prepareNicheRoutes };
if (require.main === module) {
  const niche = process.env['SWISH_NICHE'] || process.env['NICHE'];
  if (!niche) throw new Error('Set SWISH_NICHE to the branded app being built.');
  console.log('Prepared isolated route root: ' + prepareNicheRoutes(niche));
}
