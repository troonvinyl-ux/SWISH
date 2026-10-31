// Tests the dynamic Expo configuration without requiring a native build.
const configureApp = require('../../app.config.js');

const BASE_CONFIG = {
  name: 'onspace-app',
  slug: 'onspace-app',
  scheme: 'onspaceapp',
  ios: { supportsTablet: true },
  android: { package: 'com.swish.inventory' },
  extra: { preserveMe: true },
};

const BUILDS = {
  coins: ['Coin Flipper', 'swish-coin-flipper', 'coinflipper', 'com.swish.coinflipper'],
  motocross: ['Flipper MX', 'swish-flipper-mx', 'flippermx', 'com.swish.flippermx'],
  bicycles: ['Bike Flipper', 'swish-bike-flipper', 'bikeflipper', 'com.swish.bikeflipper'],
  clothing: ['Threads Flip', 'swish-threads-flip', 'threadsflip', 'com.swish.threadsflip'],
  surplus_flip: ['Surplus Flip', 'swish-surplus-flip', 'surplusflip', 'com.swish.surplusflip'],
};

describe('Branded Expo build configuration', () => {
  const originalNiche = process.env.SWISH_NICHE;
  const originalMasterAdmin = process.env.SWISH_MASTER_ADMIN;
  const originalExpoProjectId = process.env.EXPO_PROJECT_ID;
  const originalEasProjectId = process.env.EAS_PROJECT_ID;
  const originalOtaPublish = process.env.SWISH_OTA_PUBLISH;

  afterEach(() => {
    if (originalMasterAdmin === undefined) delete process.env.SWISH_MASTER_ADMIN;
    else process.env.SWISH_MASTER_ADMIN = originalMasterAdmin;
    if (originalNiche === undefined) delete process.env.SWISH_NICHE;
    else process.env.SWISH_NICHE = originalNiche;

    if (originalExpoProjectId === undefined) delete process.env.EXPO_PROJECT_ID;
    else process.env.EXPO_PROJECT_ID = originalExpoProjectId;

    if (originalEasProjectId === undefined) delete process.env.EAS_PROJECT_ID;
    else process.env.EAS_PROJECT_ID = originalEasProjectId;

    if (originalOtaPublish === undefined) delete process.env.SWISH_OTA_PUBLISH;
    else process.env.SWISH_OTA_PUBLISH = originalOtaPublish;
  });

  test('keeps the existing OnSpace app identity when no branded profile is selected', () => {
    delete process.env.SWISH_NICHE;
    delete process.env.SWISH_MASTER_ADMIN;
    // The OTA workflow injects these variables globally. Keep this identity test
    // independent of deployment configuration so it tests the true base case.
    delete process.env.EXPO_PROJECT_ID;
    delete process.env.EAS_PROJECT_ID;
    delete process.env.SWISH_OTA_PUBLISH;
    expect(configureApp({ config: BASE_CONFIG })).toBe(BASE_CONFIG);
  });

  test.each(Object.entries(BUILDS))(
    '%s has its own name, slug, deep link, and package ID',
    (nicheId, expected) => {
      delete process.env.SWISH_MASTER_ADMIN;
      // This assertion covers native branded build identity. OTA publishing
      // deliberately reuses the shared EAS project slug and is tested separately.
      delete process.env.SWISH_OTA_PUBLISH;
      process.env.SWISH_NICHE = nicheId;
      const config = configureApp({ config: BASE_CONFIG });
      expect(config.name).toBe(expected[0]);
      expect(config.slug).toBe(expected[1]);
      expect(config.scheme).toBe(expected[2]);
      expect(config.android.package).toBe(expected[3]);
      expect(config.ios.bundleIdentifier).toBe(expected[3]);
      expect(config.extra.swishNicheId).toBe(nicheId);
      expect(config.extra.swishAppScheme).toBe(expected[2]);
      expect(config.extra.preserveMe).toBe(true);
    },
  );

  test('creates a unique Master Admin native identity without a niche lock', () => {
    delete process.env.SWISH_NICHE;
    process.env.SWISH_MASTER_ADMIN = '1';
    const config = configureApp({ config: BASE_CONFIG });
    expect(config.name).toBe('SWISH Master Admin');
    expect(config.slug).toBe('swish-master-admin');
    expect(config.scheme).toBe('swishmasteradmin');
    expect(config.android.package).toBe('com.swish.inventory');
    expect(config.ios.bundleIdentifier).toBe('com.swish.inventory');
    expect(config.extra.swishMasterAdminBuild).toBe(true);
    expect(config.plugins).toEqual(expect.arrayContaining([expect.arrayContaining(['expo-router', expect.objectContaining({ root: 'master-admin-app' })])]));
  });

  test('rejects combining Master Admin identity with a niche lock', () => {
    process.env.SWISH_NICHE = 'coins';
    process.env.SWISH_MASTER_ADMIN = '1';
    expect(() => configureApp({ config: BASE_CONFIG })).toThrow(/cannot be combined/);
  });

  test('rejects an unsupported branded build ID', () => {
    delete process.env.SWISH_MASTER_ADMIN;
    process.env.SWISH_NICHE = 'unregistered_product';
    expect(() => configureApp({ config: BASE_CONFIG })).toThrow(/Unsupported SWISH_NICHE/);
  });
});
