// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
    rules: {
      // These presentation-only rules are warnings while the legacy screens are cleaned up.
      // Keep actual correctness, type, hook and security rules blocking CI.
      'react/no-unescaped-entities': 'warn',
      'react/display-name': 'warn',
    },
  },
]);
