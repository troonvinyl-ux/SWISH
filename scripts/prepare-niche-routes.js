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

  const selectedSharedRoutes = Array.isArray(product.buildSharedRoutes) ? product.buildSharedRoutes : registry.sharedRoutes;
  if (selectedSharedRoutes.some(route => !sharedRoutes.has(route))) throw new Error('Product buildSharedRoutes must be a subset of canonical sharedRoutes: ' + niche);
  const allowed = new Set([
    ...selectedSharedRoutes,
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
    ? "import ProductHome from '../" + product.home.replace(/\.tsx$/, '') + "';"
    : "import { NicheOverview as ProductHome } from '@/components/feature/NicheOverview';";
  const props = product.home ? ' isHomeTab' : '';
  save('(tabs)/index.tsx', homeImport + '\nexport default function NicheHomeScreen() { return <ProductHome' + props + ' />; }\n');

  // Remove navigator declarations for routes not present in this product's
  // generated tree. Handles multi-line Stack.Screen and Tabs.Screen elements.
  function pruneLayout(relative) {
    const target = path.join(output, relative);
    if (!fs.existsSync(target)) return;
    const sourceText = fs.readFileSync(target, 'utf8');
    const screenPattern = /<(Stack|Tabs)\.Screen\b/g;
    let cursor = 0;
    let result = '';
    let match;
    while ((match = screenPattern.exec(sourceText)) !== null) {
      const start = match.index;
      let index = start + match[0].length;
      let braceDepth = 0;
      let quote = null;
      let escaped = false;
      let end = -1;
      for (; index < sourceText.length; index++) {
        const char = sourceText[index];
        if (quote) {
          if (escaped) escaped = false;
          else if (char === '\\') escaped = true;
          else if (char === quote) quote = null;
          continue;
        }
        if (char === '"' || char === "'") { quote = char; continue; }
        if (char.charCodeAt(0) === 96) { quote = String.fromCharCode(96); continue; }
        if (char === '{') braceDepth++;
        else if (char === '}') braceDepth = Math.max(0, braceDepth - 1);
        else if (char === '/' && sourceText[index + 1] === '>' && braceDepth === 0) {
          end = index + 2;
          break;
        }
      }
      if (end < 0) throw new Error('Could not parse navigator screen declaration in ' + relative);
      const block = sourceText.slice(start, end);
      const nameMatch = block.match(/\bname=["']([^"']+)["']/);
      const directory = path.posix.dirname(relative);
      const name = nameMatch?.[1];
      const route = name
        ? (directory === '.' ? name : path.posix.join(directory, name)).replace(/\.tsx$/, '')
        : null;
      result += sourceText.slice(cursor, start);
      if (!route || !removed.has(route)) result += block;
      cursor = end;
      screenPattern.lastIndex = end;
    }
    result += sourceText.slice(cursor);
    save(relative, result);
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
