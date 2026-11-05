import fs from 'node:fs';
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const original = JSON.parse(fs.readFileSync('app.json', 'utf8')).expo;
if (config.extra?.swishUnifiedBuild !== true || config.extra?.swishNicheId || config.extra?.swishMasterAdminBuild) throw Error('Expected one unified shell, not a niche or admin launcher');
if (config.android?.package !== original.android?.package || config.scheme !== original.scheme) throw Error('Original application identity changed');
const router = (config.plugins ?? []).find(p => (Array.isArray(p) ? p[0] : p) === 'expo-router');
if (Array.isArray(router) && router[1]?.root && router[1].root !== 'app') throw Error('Unified shell must retain the complete canonical route tree');
if (config.runtimeVersion?.policy !== 'fingerprint' || !config.updates?.enabled || !config.updates?.url?.includes(process.env.EXPO_PROJECT_ID ?? 'missing-project')) throw Error('Fingerprint-compatible OTA project must be configured');
if (!['preview-unified','production-unified'].includes(config.updates.requestHeaders?.['expo-channel-name'])) throw Error('Unified release channel required');
if (process.argv[3] === 'ios') {
  if (!original.ios?.bundleIdentifier || !process.env.SWISH_APPROVED_IOS_BUNDLE_ID) throw Error('Existing iOS bundle identity has not been supplied/approved. Do not invent one.');
  if (config.ios?.bundleIdentifier !== original.ios.bundleIdentifier || config.ios.bundleIdentifier !== process.env.SWISH_APPROVED_IOS_BUNDLE_ID) throw Error('iOS identity does not match the approved original');
  if (!process.env.SWISH_APPROVED_IOS_TEAM_ID) throw Error('Original iOS team identity is required for artifact verification');
}
console.log('Unified source identity/configuration validated; this is not binary or device acceptance.');
