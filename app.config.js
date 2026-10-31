// One registry drives native identities, runtime aliases and route packaging.
const { products: NICHE_BUILDS } = require('./niche-modules.json');
const { prepareNicheRoutes } = require('./scripts/prepare-niche-routes');

module.exports = ({ config }) => {
  const selected = process.env.SWISH_NICHE;
  const niche = selected ? NICHE_BUILDS[selected] : null;
  const masterAdminBuild = process.env.SWISH_MASTER_ADMIN === '1';
  if (selected && !niche) throw new Error(`Unsupported SWISH_NICHE "${selected}".`);
  if (selected && masterAdminBuild) throw new Error('A build cannot be both a niche app and the Master Admin app.');
  const easProjectId = process.env.EXPO_PROJECT_ID || process.env.EAS_PROJECT_ID || config.extra?.eas?.projectId;
  const otaConfig = easProjectId ? {
    runtimeVersion: niche ? `${config.version || '1.0.0'}-${selected}-isolated-v1` : { policy: 'appVersion' },
    updates: { ...config.updates, url: `https://u.expo.dev/${easProjectId}`, checkAutomatically: 'ON_LOAD', fallbackToCacheTimeout: 0,
      requestHeaders: { 'expo-channel-name': `production-${selected || 'default'}` } },
    extra: { ...(config.extra || {}), eas: { ...(config.extra?.eas || {}), projectId: easProjectId } },
  } : {};
  const baseConfig = Object.keys(otaConfig).length ? { ...config, ...otaConfig } : config;

  // The owner APK has its own native identity and is deliberately not a Coins build.
  // This also prevents Android from treating it as an update/replacement for Coin Flipper.
  if (masterAdminBuild) {
    return {
      ...baseConfig,
      name: 'SWISH Master Admin',
      slug: 'swish-master-admin',
      scheme: 'swishmaster',
      ios: { ...config.ios, bundleIdentifier: 'com.swish.masteradmin' },
      android: { ...config.android, package: 'com.swish.masteradmin' },
      extra: { ...(otaConfig.extra || config.extra || {}), swishMasterAdminBuild: true },
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
  const webBaseUrl = process.env.SWISH_WEB_BASE_URL;
  return {
    ...baseConfig,
    ...(webBaseUrl ? { experiments: { ...(baseConfig.experiments || {}), baseUrl: webBaseUrl } } : {}),
    plugins, name: niche.name,
    slug: process.env.SWISH_OTA_PUBLISH === '1' ? 'swish' : niche.slug,
    scheme: niche.scheme,
    ios: { ...config.ios, bundleIdentifier: niche.iosBundleIdentifier },
    android: { ...config.android, package: niche.androidPackage },
    extra: { ...(otaConfig.extra || config.extra || {}), swishNicheId: niche.id, swishAppScheme: niche.scheme },
  };
};
