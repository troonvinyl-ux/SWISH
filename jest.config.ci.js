// Lightweight Node-only Jest config for pure service/config regression tests.
// Avoids jest-expo's React Native setup because these suites do not render native UI.
module.exports = {
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^expo-crypto$': '<rootDir>/test/mocks/expo-crypto.js',
    '^expo-constants$': '<rootDir>/test/mocks/expo-constants.js',
    '^expo/virtual/env$': '<rootDir>/test/mocks/expo-virtual-env.js',
    '^react-native$': '<rootDir>/test/mocks/react-native.js',
    '^react-native-url-polyfill/auto$': '<rootDir>/test/mocks/react-native-url-polyfill-auto.js',
  },
  setupFilesAfterEnv: ['<rootDir>/test/jest-postgrest-shim.js'],
  transform: {
    '^.+\\.[jt]sx?$': 'babel-jest',
  },
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/__tests__/**/*.test.tsx',
    '**/*.spec.ts',
    '**/*.spec.tsx',
  ],
};
