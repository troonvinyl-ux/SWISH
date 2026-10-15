// SWISH — Jest configuration for Expo + TypeScript
// Uses jest-expo preset which handles React Native transforms,
// asset mocks, and Expo-specific module resolution.

const { resolve } = require('path');

/** @type {import('@jest/types').Config.InitialOptions} */
module.exports = {
  preset: 'jest-expo',
  // Resolve @/ path alias to project root (mirrors tsconfig paths)
  moduleNameMapper: {
    '^@/(.*)$': resolve(__dirname, '$1'),
  },
  // Transform all source files including TypeScript
  transformIgnorePatterns: [
    'node_modules/(?!(' +
      '(jest-)?react-native' +
      '|@react-native(-community)?' +
      '|expo(nent)?' +
      '|@expo(nent)?/.*' +
      '|@expo-google-fonts/.*' +
      '|react-navigation' +
      '|@react-navigation/.*' +
      '|@unimodules/.*' +
      '|unimodules' +
      '|sentry-expo' +
      '|native-base' +
      '|react-native-svg' +
      ')/)',
  ],
  // File extensions to consider
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  // Collect coverage from source files (exclude tests and generated files)
  collectCoverageFrom: [
    'services/**/*.ts',
    'constants/**/*.ts',
    '!services/__tests__/**',
    '!services/__mocks__/**',
    '!**/*.d.ts',
  ],
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/__tests__/**/*.test.tsx',
    '**/*.spec.ts',
    '**/*.spec.tsx',
  ],
};
