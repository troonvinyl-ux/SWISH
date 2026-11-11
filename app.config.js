// One registry drives native identities, runtime aliases and route packaging.
const { products: NICHE_BUILDS } = require('./niche-modules.json');
const { prepareNicheRoutes } = require('./scripts/prepare-niche-routes');

module.exports = ({ config }) => {
  const selected = process.env['SWISH_NICHE'];
  const masterAdminBuild = process.env['SWISH_MASTER_ADMIN'] === '1';
  const testLabBuild = process.env['SWISH_TEST_LAB'] === '1';
  if ([masterAdminBuild, testLabBuild].filter(Boolean).length > 1) throw new Error('Only one SWISH build flavour may be selected.');
  if (masterAdminBuild && selected) throw new Error('SWISH_MASTER_ADMIN cannot be combined with SWISH_NICHE.');
  const niche = selected ? NICHE_BUILDS[selected] : null;
  if (selected && !niche) throw new Error(`Unsupported SWISH_NICHE "${selected}".`);
  // Supabase URL and anon key are public client configuration. Copy them into
  // Expo's runtime manifest so native/OTA bundles do not depend on runtime
  // process.env availability. Never place service-role or provider secrets here.
  const publicSupabase = process.env['EXPO_PUBLIC_SUPABASE_URL'] && process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY']
    ? { url: process.env['EXPO_PUBLIC_SUPABASE_URL'], anonKey: process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'] }
    : config.extra?.supabase;
  const easProjectId = process.env['EXPO_PROJECT_ID'] || process.env['EAS_PROJECT_ID'] || config.extra?.eas?.projectId;
  if (!selected && !masterAdminBuild && !testLabBuild && !easProjectId && !publicSupabase) return { ...config, name: 'SWISH', extra: { ...(config.extra || {}), swishUnifiedBuild: true } };
  const otaConfig = easProjectId ? {
    runtimeVersion: niche ? `${config.version || '1.0.0'}-${selected}-isolated-api36-v1` : { policy: 'appVersion' },
    updates: { ...config.updates, url: `https://u.expo.dev/${easProjectId}`, checkAutomatically: 'ON_LOAD', fallbackToCacheTimeout: 0,
      requestHeaders: { 'expo-channel-name': `production-${selected || 'default'}` } },
    extra: { ...(config.extra || {}), eas: { ...(config.extra?.eas || {}), projectId: easProjectId } },
  } : {};
  const configuredExtra = { ...(config.extra || {}), ...(publicSupabase ? { supabase: publicSupabase } : {}) };
  const withPublicSupabase = { ...config, extra: configuredExtra };
  const baseConfig = Object.keys(otaConfig).length ? { ...withPublicSupabase, ...otaConfig, extra: { ...configuredExtra, ...(otaConfig.extra || {}) } } : withPublicSupabase;
  // Independent diagnostic APK: separate Android identity, isolated route tree,
  // and OTA disabled so update delivery cannot contaminate lifecycle testing.
  if (testLabBuild) {
    const plugins = (baseConfig.plugins || []).map(plugin => {
      const name = Array.isArray(plugin) ? plugin[0] : plugin;
      return name === 'expo-router'
        ? ['expo-router', { ...(Array.isArray(plugin) ? plugin[1] : {}), root: 'test-lab-app' }]
        : plugin;
    });
    if (!plugins.some(plugin => (Array.isArray(plugin) ? plugin[0] : plugin) === 'expo-router')) {
      plugins.push(['expo-router', { root: 'test-lab-app' }]);
    }
    return {
      ...baseConfig,
      name: 'SWISH Test Lab',
      slug: 'swish-test-lab',
      scheme: 'swishtestlab',
      runtimeVersion: `${config.version || '1.0.0'}-test-lab-v1`,
      updates: { ...(baseConfig.updates || {}), enabled: false, checkAutomatically: 'NEVER' },
      plugins,
      android: { ...baseConfig.android, package: 'com.swish.testlab' },
      ios: { ...baseConfig.ios, bundleIdentifier: 'com.swish.testlab' },
      extra: { ...(baseConfig.extra || {}), swishTestLabBuild: true },
    };
  }

  if (masterAdminBuild && process.env['SWISH_LEGACY_BUILD'] === '1') {
    // The Master Admin is a launcher shell, not a bundled copy of all ten
    // niche products. Its route tree contains only auth, owner console and
    // diagnostics; each niche opens from its own installed APK via deep link.
    const masterPlugins = (baseConfig.plugins || []).map(plugin => {
      const name = Array.isArray(plugin) ? plugin[0] : plugin;
      return name === 'expo-router'
        ? ['expo-router', { ...(Array.isArray(plugin) ? plugin[1] : {}), root: 'master-admin-app' }]
        : plugin;
    });
    if (!masterPlugins.some(plugin => (Array.isArray(plugin) ? plugin[0] : plugin) === 'expo-router')) {
      masterPlugins.push(['expo-router', { root: 'master-admin-app' }]);
    }
    return {
      ...baseConfig,
      plugins: masterPlugins,
      name: 'SWISH Master Admin',
      slug: process.env['SWISH_OTA_PUBLISH'] === '1' ? 'swish' : 'swish-master-admin',
      scheme: 'swishmasteradmin',
      runtimeVersion: `${config.version || '1.0.0'}-master-admin-api36-v1`,
      ios: { ...baseConfig.ios, bundleIdentifier: baseConfig.ios?.bundleIdentifier ?? 'com.swish.inventory' },
      // Preserve the existing Master Admin package so this release upgrades
      // the installed control-centre APK instead of creating a duplicate app.
      android: { ...baseConfig.android, package: baseConfig.android?.package ?? 'com.swish.inventory' },
      extra: { ...(baseConfig.extra || {}), swishMasterAdminBuild: true },
    };
  }
  if (!niche) {
    const channel = process.env['SWISH_RELEASE_CHANNEL'] || 'preview-unified';
    return { ...baseConfig, name: 'SWISH',
      // Preserve original package, bundle ID and URI scheme. Never infer a new iOS identity.
      runtimeVersion: { policy: 'fingerprint' },
      updates: { ...(baseConfig.updates || {}), enabled: !!easProjectId, disableAntiBrickingMeasures: false, useEmbeddedUpdate: true, checkAutomatically: 'ON_LOAD', fallbackToCacheTimeout: 0,
        requestHeaders: { ...(baseConfig.updates?.requestHeaders || {}), 'expo-channel-name': channel } },
      extra: { ...(baseConfig.extra || {}), swishUnifiedBuild: true, swishReleaseChannel: channel },
    };
  }
  // Prepare for every Expo consumer (prebuild, EAS, export, OTA), not just one workflow.
  const routeRoot = prepareNicheRoutes(selected);
  const plugins = (config.plugins || []).map(plugin => {
    const name = Array.isArray(plugin) ? plugin[0] : plugin;
    return name === 'expo-router' ? ['expo-router', { ...(Array.isArray(plugin) ? plugin[1] : {}), root: routeRoot }] : plugin;
  });
  if (!plugins.some(plugin => (Array.isArray(plugin) ? plugin[0] : plugin) === 'expo-router')) plugins.push(['expo-router', { root: routeRoot }]);
  const webBaseUrl = process.env['SWISH_WEB_BASE_URL'];
  const artworkFiles = { coins: 'coin-flipper.jpeg', motocross: 'mx-flipper.jpeg', bicycles: 'bike-flipper.jpeg', clothing: 'threads-flip.jpeg', trading_cards: 'card-flipper.jpeg', antiques: 'antique-flipper.jpeg', fossils: 'fossil-flipper.jpeg', beauty: 'beauty-flipper.jpeg', tech: 'tech-flipper.jpeg', surplus_flip: 'surplus-flip.png', collectibles: 'collectibles-flipper.png' };
  const productArtwork = './assets/images/brands/' + artworkFiles[selected];
  if (!artworkFiles[selected]) throw new Error('Missing product launcher artwork: ' + selected);
  const brandedPlugins = plugins.map(plugin => {
    const name = Array.isArray(plugin) ? plugin[0] : plugin;
    if (name === 'expo-splash-screen') return [name, { ...(Array.isArray(plugin) ? plugin[1] : {}), image: productArtwork }];
    if (name === 'expo-camera') return [name, { ...(Array.isArray(plugin) ? plugin[1] : {}), cameraPermission: 'Allow ' + niche.name + ' to photograph items for specialist identification.' }];
    return plugin;
  });
  return {
    ...baseConfig,
    ...(webBaseUrl ? { experiments: { ...(baseConfig.experiments || {}), baseUrl: webBaseUrl } } : {}),
    plugins: brandedPlugins, name: niche.name, icon: productArtwork,
    slug: process.env['SWISH_OTA_PUBLISH'] === '1' ? 'swish' : niche.slug,
    scheme: niche.scheme,
    ios: { ...config.ios, bundleIdentifier: niche.iosBundleIdentifier },
    android: { ...config.android, package: niche.androidPackage, adaptiveIcon: { ...(config.android?.adaptiveIcon || {}), foregroundImage: productArtwork } },
    extra: { ...(baseConfig.extra || {}), swishUnifiedBuild: false, swishNicheId: niche.id, swishAppScheme: niche.scheme },
  };
};
