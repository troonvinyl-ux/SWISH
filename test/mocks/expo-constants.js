// Node-only default for service tests. The public values are deliberately
// non-routable fixtures: they let mocked service tests construct the shared
// client without depending on a developer .env file. Individual suites can
// still override this with a focused jest.mock factory when they need a
// particular build identity or an absent configuration.
const expoConfig = {
  extra: {
    supabase: {
      url: 'https://unit-test.invalid',
      anonKey: 'unit-test-public-anon-key',
    },
  },
};

module.exports = {
  __esModule: true,
  default: { expoConfig, executionEnvironment: 'storeClient', nativeAppVersion: null, nativeBuildVersion: null },
  expoConfig,
  executionEnvironment: 'storeClient',
  nativeAppVersion: null,
  nativeBuildVersion: null,
};
