// metro.config.js — SWISH
// Problem: pnpm stores metro-* packages in two places:
//   A) .pnpm/metro-file-map@0.82.4/node_modules/metro-file-map/  ← real package
//   B) .pnpm/@expo+cli@x/node_modules/metro-file-map/             ← nested copy
// Metro's duplicate-package validator counts both → "found 2" error.
//
// Fix: blockList only covers the NESTED copies (B), leaving the direct
// pnpm entries (A) fully accessible for require() and SHA-1 hashing.
// We do NOT block A because metro-runtime/src/polyfills/require.js and
// other source files live there and must be hashable by Metro.
//
// Top-level node_modules/metro-* stubs have been removed — they caused a
// separate problem: after app.config.js / babel.config.js deleted the .pnpm
// stubs the top-level forwarding code returned {}, making resolveConfig
// undefined. Without the stubs, node resolution goes directly to .pnpm (A).
//
// REGEX FIX: the previous lookahead (?!metro[/\\@]) incorrectly allowed
// "metro-runtime@0.82.4" through because "-" ≠ "/" or "@". The corrected
// lookahead (?!metro) excludes ANY .pnpm entry whose name starts with "metro".
'use strict';
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);
config.resolver = config.resolver ?? {};

const pnpmDir = path.join(__dirname, 'node_modules', '.pnpm');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Block ONLY nested copies: .pnpm/SOME-PKG@x/node_modules/metro-ANYTHING/
// where the outer pnpm entry does NOT itself start with "metro".
//
// Matches (blocked — nested copy inside non-metro package):
//   .pnpm/@expo+cli@0.24.15_.../node_modules/metro-config/
//   .pnpm/jest-worker@29.7.0/node_modules/metro-runtime/
//
// Does NOT match (allowed — real package):
//   .pnpm/metro-config@0.82.4/node_modules/metro-config/
//   .pnpm/metro-runtime@0.82.4/node_modules/metro-runtime/
const blockNested = new RegExp(
  esc(pnpmDir) +
  // path separator, then a negative lookahead: do NOT match if next chars start with "metro"
  '[/\\\\](?!metro)' +
  // the outer pnpm entry name (any chars except path separator)
  '[^/\\\\]+' +
  // /node_modules/ separator
  '[/\\\\]node_modules[/\\\\]' +
  // then a metro-* package directory
  'metro[^/\\\\]*[/\\\\]'
);

const existing = config.resolver.blockList;
if (existing instanceof RegExp) {
  config.resolver.blockList = new RegExp(`(?:${existing.source})|(?:${blockNested.source})`);
} else if (Array.isArray(existing)) {
  config.resolver.blockList = [...existing, blockNested];
} else {
  config.resolver.blockList = blockNested;
}

// sourceExts — ensure standard extensions are covered
config.resolver.sourceExts = [
  ...(config.resolver.sourceExts ?? ['js', 'jsx', 'json', 'ts', 'tsx']),
];

module.exports = config;
