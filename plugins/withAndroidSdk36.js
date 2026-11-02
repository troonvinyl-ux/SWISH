// Enforce current Google Play Android API requirements without adding a
// duplicate build-properties dependency. Expo SDK already provides config plugins.
const { withGradleProperties } = require('@expo/config-plugins');

module.exports = function withAndroidSdk36(config) {
  return withGradleProperties(config, (modConfig) => {
    const values = {
      'android.compileSdkVersion': '36',
      'android.targetSdkVersion': '36',
      'android.buildToolsVersion': '36.0.0',
    };
    const properties = modConfig.modResults;
    for (const [key, value] of Object.entries(values)) {
      const existing = properties.find((entry) => entry.type === 'property' && entry.key === key);
      if (existing) existing.value = value;
      else properties.push({ type: 'property', key, value });
    }
    return modConfig;
  });
};
