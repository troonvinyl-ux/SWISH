// Node-only default for service tests. Individual suites can still override it
// with a focused jest.mock factory when they need a particular build identity.
module.exports = {
  __esModule: true,
  default: { expoConfig: {}, executionEnvironment: 'storeClient', nativeAppVersion: null, nativeBuildVersion: null },
  expoConfig: {},
  executionEnvironment: 'storeClient',
  nativeAppVersion: null,
  nativeBuildVersion: null,
};
