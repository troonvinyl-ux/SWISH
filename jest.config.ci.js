// Lightweight Node-only Jest config for pure service/config regression tests.
// Avoids jest-expo's React Native setup because these suites do not render native UI.
module.exports = {
  testEnvironment: 'node',
  moduleNameMapper: {
    '^expo/virtual/env(?:\\.js)?
  },
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
: '<rootDir>/__mocks__/expoVirtualEnv.js',
    '^@/(.*)
  },
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
: '<rootDir>/$1',
  },
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
