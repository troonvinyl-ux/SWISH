// babel.config.js — SWISH
// Keep Expo's Babel preset unchanged. Dependency installation is configured
// in .npmrc; Babel must not delete, rewrite, or mask installed Metro packages.

module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
