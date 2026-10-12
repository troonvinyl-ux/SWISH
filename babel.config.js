// babel.config.js — SWISH
// NOTE: We do NOT delete .pnpm stubs here.
//
// Previous strategy (delete .pnpm stubs when top-level exists) caused
// runtime failures: the top-level node_modules/metro-*/index.js stubs
// forward require() calls to their .pnpm counterparts at runtime.
// Deleting those .pnpm directories broke internal relative requires
// (e.g. metro-transform-plugins/src/index.js → ./constant-folding-plugin)
// because the real source files live inside .pnpm, not in the stub.
//
// The duplicate-package validator problem is solved entirely in
// metro.config.js via blockList, which prevents Metro from scanning
// .pnpm/metro-* paths at all — so the validator counts exactly 1 copy
// of each metro package (the top-level stub) without us deleting anything.

module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
