// One registry drives native identities, runtime aliases and route packaging.
const { products: NICHE_BUILDS } = require('./niche-modules.json');
const { prepareNicheRoutes } = require('./scripts/prepare-niche-routes');

module.exports = ({ config }) => {
  const selected = process.env.SWISH_NICHE;
  const masterAdminBuild = process.env.SWISH_MASTER_ADMIN === '1';
  if (masterAdminBuild && selected) throw new Error('SWISH_MASTER_ADMIN cannot be combined with SWISH_NICHE.');
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
  if (masterAdminBuild) {
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
      // EAS updates share the existing SWISH project slug; native package and scheme remain dedicated.
      slug: process.env.SWISH_OTA_PUBLISH === '1' ? 'swish' : 'swish-master-admin',
      scheme: 'swishmasteradmin',
      ios: { ...baseConfig.ios, bundleIdentifier: baseConfig.ios?.bundleIdentifier ?? 'com.swish.inventory' },
      // Preserve the existing Master Admin package so this release upgrades
      // the installed control-centre APK instead of creating a duplicate app.
      android: { ...baseConfig.android, package: baseConfig.android?.package ?? 'com.swish.inventory' },
      extra: { ...(baseConfig.extra || {}), swishMasterAdminBuild: true },
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
