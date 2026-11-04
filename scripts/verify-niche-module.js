#!/usr/bin/env node
'use strict';
// Fail-closed route, local-import, specialist and asset boundary verifier.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const registry = require('../niche-modules.json');
const root = path.resolve(__dirname, '..');
const niche = process.env.SWISH_NICHE || process.env.NICHE;
const product = registry.products[niche];
if (!product) throw new Error('A registered SWISH_NICHE is required.');
if (!Array.isArray(registry.sharedRoutes) || !Array.isArray(registry.adminOnlyRoutes)) {
  throw new Error('The canonical niche registry must classify shared and admin-only routes.');
}
if (!Array.isArray(product.specialists) || !product.specialists.length || !product.specialists.includes(product.defaultSpecialist)) {
  throw new Error('The selected niche has an invalid specialist scope.');
}
if (new Set(product.specialists).size !== product.specialists.length) throw new Error('Duplicate specialist IDs in selected niche.');

const routeOwners = new Map();
for (const [id, config] of Object.entries(registry.products)) {
  if (config.id !== id || !Array.isArray(config.specialists) || !config.specialists.includes(config.defaultSpecialist)) {
    throw new Error('Invalid product contract: ' + id);
  }
  for (const route of [config.entry, config.home, ...(config.dedicatedRoutes || [])].filter(Boolean)) {
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
const allowed = new Set([...shared, product.entry, product.home, ...(product.dedicatedRoutes || [])].filter(Boolean));
const actual = new Set();
function walk(directory) {
  if (!fs.existsSync(directory)) throw new Error('Generated niche route tree is missing: ' + directory);
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
  for (const route of [config.entry, config.home, ...(config.dedicatedRoutes || [])].filter(Boolean)) {
    if (actual.has(route)) throw new Error('Foreign niche route packaged: ' + route + ' (' + id + ')');
  }
}
for (const required of ['(tabs)/index.tsx','(tabs)/scan.tsx','(tabs)/inventory.tsx','(tabs)/listings.tsx','(tabs)/account.tsx']) {
  if (!actual.has(required)) throw new Error('Required HOME · SCAN · INVENTORY · LISTINGS · MORE route missing: ' + required);
}
const home = fs.readFileSync(path.join(generated, '(tabs)/index.tsx'), 'utf8');
if (product.home) {
  const expectedImport = '../' + product.home.replace(/\.tsx$/, '');
  if (!home.includes(expectedImport)) throw new Error('Selected niche home is not the only home imported.');
} else if (!home.includes('NicheOverview as ProductHome')) {
  throw new Error('Generic registered niche home is missing.');
}
for (const [id, config] of Object.entries(registry.products)) {
  if (id !== niche && config.home && home.includes('../' + config.home.replace(/\.tsx$/, ''))) {
    throw new Error('Foreign home import: ' + id);
  }
}

const assetScopePath = path.join(root, '.swish-build', niche, 'asset-scope.json');
if (!fs.existsSync(assetScopePath)) throw new Error('Niche-only asset preparation has not run.');
const assetScope = JSON.parse(fs.readFileSync(assetScopePath, 'utf8'));
const expectedBrandAsset = assetScope.selectedBrandArtwork;
const sharedBrandAsset = assetScope.sharedBrandArtwork;
const codeExtensions = ['.native.tsx', '.native.ts', '.ios.tsx', '.ios.ts', '.android.tsx', '.android.ts', '.web.tsx', '.web.ts', '.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs', '.json', '.d.ts'];
const assetExtensions = new Set(['.png','.jpg','.jpeg','.webp','.svg','.gif','.ttf','.otf','.mp4','.mov','.wav','.mp3']);
const dataFiles = new Set();
const assetFiles = new Set();
const visited = new Set();
const pending = [...actual].map(route => path.join(generated, route));
const canonicalApp = path.join(root, 'app') + path.sep;

function resolveLocalImport(fromFile, specifier) {
  let base;
  if (specifier.startsWith('@/')) base = path.join(root, specifier.slice(2));
  else if (specifier.startsWith('.')) base = path.resolve(path.dirname(fromFile), specifier);
  else return null;
  const candidates = [base, ...codeExtensions.map(ext => base + ext), ...[...assetExtensions].map(ext => base + ext)];
  for (const ext of codeExtensions) candidates.push(path.join(base, 'index' + ext));
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return path.resolve(candidate);
  }
  if (fromFile.startsWith(generated + path.sep) && specifier.startsWith('.')) {
    const relative = path.relative(generated, fromFile);
    const canonicalFrom = path.join(root, 'app', relative);
    const fallback = path.resolve(path.dirname(canonicalFrom), specifier);
    const fallbackCandidates = [fallback, ...codeExtensions.map(ext => fallback + ext), ...[...assetExtensions].map(ext => fallback + ext)];
    for (const ext of codeExtensions) fallbackCandidates.push(path.join(fallback, 'index' + ext));
    for (const candidate of fallbackCandidates) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return path.resolve(candidate);
    }
  }
  return null;
}
function isLocalSpecifier(specifier) {
  return specifier.startsWith('@/') || specifier.startsWith('.');
}
function collectImports(file, source) {
  const kind = /\.tsx$/.test(file) ? ts.ScriptKind.TSX : /\.jsx$/.test(file) ? ts.ScriptKind.JSX : /\.js$|\.mjs$|\.cjs$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const result = [];
  function add(node, syntax) {
    if (node && ts.isStringLiteralLike(node)) result.push({ specifier: node.text, syntax });
    else throw new Error('Non-literal local dependency cannot be isolated safely: ' + file + ' (' + syntax + ')');
  }
  function visit(node) {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier) add(node.moduleSpecifier, 'import');
    if (ts.isExportDeclaration(node) && node.moduleSpecifier) add(node.moduleSpecifier, 'export');
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) add(node.arguments[0], 'dynamic import');
      else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') add(node.arguments[0], 'require');
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  return result;
}

while (pending.length) {
  const file = path.resolve(pending.pop());
  if (visited.has(file)) continue;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error('Import graph references a missing local file: ' + file);
  visited.add(file);
  if (file.startsWith(canonicalApp)) {
    const relativeRoute = path.relative(path.join(root, 'app'), file).split(path.sep).join('/');
    if (!allowed.has(relativeRoute)) throw new Error('Foreign niche route reached through a local import: ' + relativeRoute);
  }
  if (!/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(file)) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    if (assetExtensions.has(path.extname(file).toLowerCase())) assetFiles.add(relative);
    else dataFiles.add(relative);
    continue;
  }
  const source = fs.readFileSync(file, 'utf8');
  for (const { specifier, syntax } of collectImports(file, source)) {
    if (!isLocalSpecifier(specifier)) continue;
    const resolved = resolveLocalImport(file, specifier);
    if (!resolved) throw new Error('Unresolved local ' + syntax + ' in ' + path.relative(root, file) + ': ' + specifier);
    const relative = path.relative(root, resolved).split(path.sep).join('/');
    if (relative.startsWith('..')) throw new Error('Local dependency escapes repository root: ' + specifier);
    if (relative.startsWith('niches/')) {
      const foreignNiche = relative.split('/')[1];
      if (foreignNiche !== niche) throw new Error('Foreign niche module imported: ' + relative);
    }
    if (assetExtensions.has(path.extname(resolved).toLowerCase())) {
      assetFiles.add(relative);
      continue;
    }
    if (path.extname(resolved).toLowerCase() === '.json') {
      dataFiles.add(relative);
      continue;
    }
    pending.push(resolved);
  }
}

const brandAssets = [...assetFiles].filter(file => file.startsWith('assets/images/brands/')).sort();
for (const file of brandAssets) {
  if (file !== expectedBrandAsset && file !== sharedBrandAsset) throw new Error('Foreign niche brand artwork included in ' + niche + ' import graph: ' + file);
}
if (!brandAssets.includes(expectedBrandAsset)) throw new Error('Selected niche brand artwork is not in the import graph: ' + expectedBrandAsset);
if (!brandAssets.includes(sharedBrandAsset)) throw new Error('Shared tool artwork is not in the import graph: ' + sharedBrandAsset);

const routeFiles = [...actual].sort();
const localModules = [...visited].filter(file => /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(file)).map(file => path.relative(root, file).split(path.sep).join('/')).sort();
const closure = {
  schemaVersion: 1,
  nicheId: niche,
  productName: product.name,
  androidPackage: product.androidPackage,
  scheme: product.scheme,
  defaultSpecialist: product.defaultSpecialist,
  selectedSpecialists: product.specialists,
  routeCount: routeFiles.length,
  routes: routeFiles,
  localModuleCount: localModules.length,
  localModules,
  assetCount: assetFiles.size,
  assets: [...assetFiles].sort(),
  dataFiles: [...dataFiles].sort(),
  brandArtwork: {
    selected: expectedBrandAsset,
    shared: sharedBrandAsset,
    bundled: brandAssets,
    excluded: assetScope.excludedBrandArtwork
  },
  boundaries: {
    foreignRoutes: 0,
    unresolvedLocalImports: 0,
    foreignBrandArtwork: 0,
    dynamicLocalImports: 0,
    verified: true
  }
};
const outputPath = path.join(root, '.swish-build', niche, 'import-closure.json');
fs.writeFileSync(outputPath, JSON.stringify(closure, null, 2) + '\n');
console.log('Strict route, local import/require and brand-asset boundaries verified for ' + niche + ' (' + routeFiles.length + ' routes, ' + localModules.length + ' local modules, ' + assetFiles.size + ' assets).');
console.log('Import closure: ' + path.relative(root, outputPath));
