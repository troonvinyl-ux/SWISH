#!/usr/bin/env node
'use strict';
// Build-time override: keep only the selected niche's static brand-art imports
// in the Metro graph. The original source is preserved under .swish-build.
const fs = require('node:fs');
const path = require('node:path');
const registry = require('../niche-modules.json');
const root = path.resolve(__dirname, '..');
const niche = process.env.SWISH_NICHE || process.env.NICHE;
const product = registry.products[niche];
if (!product) throw new Error('A registered SWISH_NICHE is required.');

const appConfig = fs.readFileSync(path.join(root, 'app.config.js'), 'utf8');
const mapMatch = appConfig.match(/const artworkFiles = \{([^}]+)\};/);
if (!mapMatch) throw new Error('Canonical app artwork map is missing.');
const artworkFiles = Object.fromEntries([...mapMatch[1].matchAll(/([a-z0-9_]+):\s*'([^']+)'/g)].map(match => [match[1], match[2]]));
const artworkFile = artworkFiles[niche];
if (!artworkFile) throw new Error('No launcher artwork is registered for ' + niche);
const selectedAsset = path.join(root, 'assets/images/brands', artworkFile);
const sharedToolAsset = path.join(root, 'assets/images/brands/tool-flipper.jpeg');
if (!fs.existsSync(selectedAsset) || !fs.existsSync(sharedToolAsset)) throw new Error('Selected or shared brand artwork file is missing.');

const buildRoot = path.join(root, '.swish-build', niche);
const backupRoot = path.join(root, '.swish-build', 'source-overrides');
const sourcePath = path.join(root, 'constants/brandArtwork.ts');
const backupPath = path.join(backupRoot, 'brandArtwork.original.ts');
fs.mkdirSync(backupRoot, { recursive: true });
if (!fs.existsSync(backupPath)) fs.copyFileSync(sourcePath, backupPath);

const generated = [
  "import type { ImageSource } from 'expo-image';",
  '',
  'const selectedNicheId = ' + JSON.stringify(niche) + ';',
  'export function getBrandArtwork(nicheId: string | null | undefined): ImageSource | null {',
  '  if (nicheId !== selectedNicheId) return null;',
  '  return require(' + JSON.stringify('@/assets/images/brands/' + artworkFile) + ');',
  '}',
  'export const TOOL_ARTWORK: ImageSource = require(' + JSON.stringify('@/assets/images/brands/tool-flipper.jpeg') + ');',
  'export const BRAND_NAMES: Record<string, string> = {',
  '  ' + JSON.stringify(niche) + ': ' + JSON.stringify(product.name) + ',',
  '};',
  ''
].join('\n');
fs.writeFileSync(sourcePath, generated);
fs.mkdirSync(buildRoot, { recursive: true });
const brandAssets = fs.readdirSync(path.join(root, 'assets/images/brands')).filter(name => /\.(?:png|jpe?g|webp)$/i.test(name));
fs.writeFileSync(path.join(buildRoot, 'asset-scope.json'), JSON.stringify({
  nicheId: niche,
  selectedBrandArtwork: 'assets/images/brands/' + artworkFile,
  sharedBrandArtwork: 'assets/images/brands/tool-flipper.jpeg',
  excludedBrandArtwork: brandAssets.filter(name => name !== artworkFile && name !== 'tool-flipper.jpeg').map(name => 'assets/images/brands/' + name),
  selectedSpecialists: product.specialists,
  defaultSpecialist: product.defaultSpecialist
}, null, 2) + '\n');
console.log('Prepared niche-only brand artwork for ' + niche + '; ' + (brandAssets.length - 1) + ' other product images are no longer statically imported.');
