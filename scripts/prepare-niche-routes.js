#!/usr/bin/env node
'use strict';
// Fail-closed physical route packaging, reconciled with main a8eee534 / PR #167.
const fs = require('node:fs');
const path = require('node:path');
const registry = require('../niche-modules.json');
function prepareNicheRoutes(niche, root = path.resolve(__dirname, '..')) {
  const product = registry.products[niche];
  if (!product) throw new Error('Unknown SWISH_NICHE: ' + niche);
  const shared = new Set(registry.sharedRoutes);
  const admin = new Set(registry.adminOnlyRoutes);
  const owners = new Map();
  for (const [id, config] of Object.entries(registry.products)) {
    for (const route of [config.entry, config.home, ...config.dedicatedRoutes].filter(Boolean)) {
      if (owners.has(route) && owners.get(route) !== id) throw new Error('Conflicting route owner: ' + route);
      owners.set(route, id);
    }
  }
  for (const route of shared) if (admin.has(route) || owners.has(route)) throw new Error('Conflicting route classification: ' + route);
  const selectedShared = product.buildSharedRoutes ?? registry.sharedRoutes;
  if (selectedShared.some(route => !shared.has(route))) throw new Error('Invalid shared subset for ' + niche);
  const allowed = new Set([...selectedShared, product.entry, product.home, ...product.dedicatedRoutes].filter(Boolean));
  for (const route of ['(tabs)/index.tsx','(tabs)/scan.tsx','(tabs)/inventory.tsx','(tabs)/listings.tsx','(tabs)/account.tsx']) {
    if (!allowed.has(route)) throw new Error('The five-area footer requires ' + route);
  }
  const source = path.join(root, 'app');
  const output = path.join(root, '.swish-build', niche, 'app');
  const kept = new Set(); const removed = new Set();
  function save(relative, content) {
    const target = path.join(output, relative); kept.add(relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      const relative = path.relative(source, full).split(path.sep).join('/');
      if (!shared.has(relative) && !admin.has(relative) && !owners.has(relative)) throw new Error('Unclassified route: ' + relative);
      if (!allowed.has(relative)) { removed.add(relative.replace(/\.tsx$/, '')); continue; }
      save(relative, fs.readFileSync(full, 'utf8'));
    }
  }
  walk(source);
  for (const route of allowed) if (!kept.has(route)) throw new Error('Declared route missing: ' + route);
  // All isolated APKs use the same home template. Bespoke pages remain in allowed routes.
  const homeImport = "import { SharedNicheDashboard } from '@/components/feature/SharedNicheDashboard';";
  save('(tabs)/index.tsx', homeImport + '\nexport default function NicheHomeScreen() { return <SharedNicheDashboard nicheId="' + niche + '" />; }\n');
  // TypeScript parses JSX; avoid regex accidentally consuming nested JSX options.
  const ts = require('typescript');
  for (const relative of [...kept].filter(file => file.endsWith('_layout.tsx'))) {
    const text = fs.readFileSync(path.join(output, relative), 'utf8');
    const file = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const deletions = [];
    function visit(node) {
      if (ts.isJsxSelfClosingElement(node) && /^(Stack|Tabs)\.Screen$/.test(node.tagName.getText(file))) {
        const attr = node.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.getText(file) === 'name');
        if (attr?.initializer && ts.isStringLiteral(attr.initializer)) {
          const directory = path.posix.dirname(relative);
          const route = directory === '.' ? attr.initializer.text : path.posix.join(directory, attr.initializer.text);
          if (removed.has(route)) deletions.push([node.getStart(file), node.getEnd()]);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
    let result = text;
    for (const [start,end] of deletions.sort((a,b) => b[0]-a[0])) result = result.slice(0,start)+result.slice(end);
    save(relative, result);
  }
  function clean(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) { clean(full); continue; }
      if (!kept.has(path.relative(output,full).split(path.sep).join('/'))) fs.unlinkSync(full);
    }
  }
  clean(output);
  return path.relative(root, output).split(path.sep).join('/');
}
module.exports = { prepareNicheRoutes };
if (require.main === module) console.log('Prepared isolated route root: ' + prepareNicheRoutes(process.env.SWISH_NICHE || process.env.NICHE));
