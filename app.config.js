// app.config.js — SWISH
// The Metro duplicate-package validator scans all node_modules paths.
// We DO NOT delete .pnpm stubs here — instead metro.config.js blockList
// prevents Metro from traversing .pnpm/metro-* at all, so the validator
// only ever sees the top-level stubs and counts exactly 1 of each.
// Deleting .pnpm stubs caused a race: the top-level stubs forward to .pnpm
// at require() time, but if .pnpm was already deleted, forwarding fails
// and metro-config returns {}, making resolveConfig undefined → TypeError.

// Export using the Expo dynamic config function signature.
module.exports = ({ config }) => config;
