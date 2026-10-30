// One registry drives native identities, runtime aliases and route packaging.
const { products: NICHE_BUILDS } = require('./niche-modules.json');
const { prepareNicheRoutes } = require('./scripts/prepare-niche-routes');

module.exports = ({ config }) => {
  const selected = process.env.SWISH_NICHE;
  const niche = selected ? NICHE_BUILDS[selected] : null;
  if (selected && !niche) throw new Error(`Unsupported SWISH_NICHE "${selected}".`);
  const easProjectId = process.env.EXPO_PROJECT_ID || process.env.EAS_PROJECT_ID || config.extra?.eas?.projectId;
  const otaConfig = easProjectId ? {
    runtimeVersion: niche ? `${config.version || '1.0.0'}-${selected}-isolated-v1` : { policy: 'appVersion' },
    updates: { ...config.updates, url: `https://u.expo.dev/${easProjectId}`, checkAutomatically: 'ON_LOAD', fallbackToCacheTimeout: 0,
      requestHeaders: { 'expo-channel-name': `production-${selected || 'default'}` } },
    extra: { ...(config.extra || {}), eas: { ...(config.extra?.eas || {}), projectId: easProjectId } },
  } : {};
  const baseConfig = Object.keys(otaConfig).length ? { ...config, ...otaConfig } : config;

  // Standalone owner-only command centre build. This is a separate Android
  // application identity and a separate Expo Router root; it cannot open a
  // subscriber niche shell from its navigation tree.
  if (process.env.SWISH_MASTER_DASHBOARD === '1') {
    const plugins = (baseConfig.plugins || []).map(plugin => {
      const name = Array.isArray(plugin) ? plugin[0] : plugin;
      return name === 'expo-router'
        ? ['expo-router', { ...(Array.isArray(plugin) ? plugin[1] : {}), root: 'app/master-dashboard' }]
        : plugin;
    });
    if (!plugins.some(plugin => (Array.isArray(plugin) ? plugin[0] : plugin) === 'expo-router')) {
      plugins.push(['expo-router', { root: 'app/master-dashboard' }]);
    }
    return {
      ...baseConfig,
      name: 'SWISH Master',
      slug: 'swish-master-dashboard',
      scheme: 'swishmaster',
      orientation: 'default',
      userInterfaceStyle: 'dark',
      plugins,
      android: { ...baseConfig.android, package: 'com.swish.masterdashboard' },
      extra: {
        ...(baseConfig.extra || {}),
        swishMasterDashboard: true,
        swishAppScheme: 'swishmaster',
      },
      updates: baseConfig.updates ? {
        ...baseConfig.updates,
        requestHeaders: { ...(baseConfig.updates.requestHeaders || {}), 'expo-channel-name': 'production-master-dashboard' },
      } : baseConfig.updates,
    };
  }

  if (!niche) return baseConfig;
  // Prepare for every Expo consumer (prebuild, EAS, export, OTA), not just one workflow.
  const routeRoot = prepareNicheRoutes(selected);
  const plugins = (config.plugins || []).map(plugin => {
    const name = Array.isArray(plugin) ? plugin[0] : plugin;
    return name === 'expo-router' ? ['expo-router', { ...(Array.isArray(plugin) ? plugin[1] : {}), root: routeRoot }] : plugin;
  });
  if (!plugins.some(plugin => (Array.isArray(plugin) ? plugin[0] : plugin) === 'expo-router')) plugins.push(['expo-router', { root: routeRoot }]);
  return {
    ...baseConfig, plugins, name: niche.name,
    slug: process.env.SWISH_OTA_PUBLISH === '1' ? 'swish' : niche.slug,
    scheme: niche.scheme,
    ios: { ...config.ios, bundleIdentifier: niche.iosBundleIdentifier },
    android: { ...config.android, package: niche.androidPackage },
    extra: { ...(otaConfig.extra || config.extra || {}), swishNicheId: niche.id, swishAppScheme: niche.scheme },
  };
};
