#!/usr/bin/env node
// Produce auditable metadata for one signed niche APK. This is not device certification.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const niche = process.env.SWISH_NICHE;
const registry = require('../niche-modules.json');
const product = registry.products[niche];
if (!product) throw new Error('Unknown SWISH_NICHE.');
const config = JSON.parse(fs.readFileSync('/tmp/swish-expo-config.json', 'utf8'));
const apkPath = path.resolve('dist', niche + '.apk');
if (!fs.existsSync(apkPath)) throw new Error('Verified APK file is missing.');
if (config.extra?.swishNicheId !== niche || config.android?.package !== product.androidPackage ||
    config.name !== product.name || config.scheme !== product.scheme ||
    config.ios?.bundleIdentifier !== product.iosBundleIdentifier) {
  throw new Error('APK package, scheme, branding or bundle identity does not match the canonical niche registry.');
}
const splashPlugin = (config.plugins || []).find(plugin => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen');
if (!config.icon || config.android?.adaptiveIcon?.foregroundImage !== config.icon || splashPlugin?.[1]?.image !== config.icon) {
  throw new Error('Launcher icon, adaptive icon and splash artwork are not the selected niche artwork.');
}
const expectedRuntime = (config.version || '1.0.0') + '-' + niche + '-isolated-api36-v1';
if (config.runtimeVersion !== expectedRuntime) throw new Error('Runtime version is not isolated to this niche and app version.');
const otaChannel = config.updates?.requestHeaders?.['expo-channel-name'];
if (otaChannel !== 'production-' + niche) throw new Error('OTA channel does not match the niche identity.');

const closurePath = path.resolve('.swish-build', niche, 'import-closure.json');
if (!fs.existsSync(closurePath)) throw new Error('Verified niche import-closure report is missing.');
const closure = JSON.parse(fs.readFileSync(closurePath, 'utf8'));
if (closure.nicheId !== niche || closure.androidPackage !== product.androidPackage || closure.scheme !== product.scheme ||
    JSON.stringify(closure.selectedSpecialists) !== JSON.stringify(product.specialists) || closure.boundaries?.verified !== true) {
  throw new Error('Import-closure identity or specialist-scope evidence does not match the canonical registry.');
}
if (path.normalize(config.icon.replace(/^\.\//, '')) !== closure.brandArtwork?.selected) {
  throw new Error('APK launcher artwork does not match the selected asset in the import closure.');
}

const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (!sdk) throw new Error('Android SDK path is unavailable.');
const buildToolsRoot = path.join(sdk, 'build-tools');
const versions = fs.readdirSync(buildToolsRoot).sort(new Intl.Collator(undefined, { numeric: true }).compare);
if (!versions.length) throw new Error('Android Build Tools are unavailable.');
const apksigner = path.join(buildToolsRoot, versions[versions.length - 1], 'apksigner');
const signerOutput = execFileSync(apksigner, ['verify', '--print-certs', apkPath], { encoding: 'utf8' });
const match = signerOutput.match(/Signer #1 certificate SHA-256 digest:\s*([0-9a-f:]+)/i);
if (!match) throw new Error('APK signer SHA-256 fingerprint could not be read.');
const signingFingerprintSha256 = match[1].replace(/:/g, '').toLowerCase();
const expectedFingerprint = (process.env.SWISH_RELEASE_CERT_SHA256 || '').replace(/[^0-9a-f]/gi, '').toLowerCase();
if (!expectedFingerprint || signingFingerprintSha256 !== expectedFingerprint) {
  throw new Error('APK signer does not match the approved persistent release certificate.');
}
const badgingPath = '/tmp/swish-apk-badging.txt';
if (!fs.existsSync(badgingPath)) throw new Error('APK verification report is missing.');
const badging = fs.readFileSync(badgingPath, 'utf8');
const packageMatch = badging.match(/package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'/);
if (!packageMatch || packageMatch[1] !== product.androidPackage) throw new Error('APK badging package/version metadata could not be verified.');
if (packageMatch[3] !== (config.version || '1.0.0')) throw new Error('APK versionName differs from Expo configuration.');
const apkSha256 = crypto.createHash('sha256').update(fs.readFileSync(apkPath)).digest('hex');
const sourceSha = process.env.GITHUB_SHA;
if (!sourceSha || !/^[0-9a-f]{40}$/i.test(sourceSha)) throw new Error('Pinned source SHA is missing or invalid.');
const runId = process.env.GITHUB_RUN_ID || '';
const repoName = process.env.GITHUB_REPOSITORY || '';
const server = process.env.GITHUB_SERVER_URL || 'https://github.com';
const metadata = {
  nicheId: niche,
  productName: product.name,
  androidPackage: product.androidPackage,
  iosBundleIdentifier: product.iosBundleIdentifier,
  appScheme: config.scheme,
  appVersion: packageMatch[3],
  androidVersionCode: packageMatch[2],
  launcherIcon: config.icon,
  splashImage: splashPlugin[1].image,
  selectedSpecialists: closure.selectedSpecialists,
  defaultSpecialist: closure.defaultSpecialist,
  routeCount: closure.routeCount,
  moduleCount: closure.localModuleCount,
  assetCount: closure.assetCount,
  assetBoundaryVerified: closure.boundaries.verified,
  importedAssets: closure.assets,
  nativePlugins: (config.plugins || []).map(plugin => Array.isArray(plugin) ? plugin[0] : plugin),
  sourceSha,
  buildRunId: runId,
  buildRunUrl: runId && repoName ? server + '/' + repoName + '/actions/runs/' + runId : null,
  runtimeVersion: config.runtimeVersion,
  otaChannel,
  signingFingerprintSha256,
  apkFile: niche + '.apk',
  apkSha256,
  artifactName: 'swish-' + niche + '-apk',
  buildStatus: 'PASS',
  automatedTestStatus: 'PASS: typecheck, regression suite and niche route/import/asset isolation gates',
  deviceTestStatus: 'NOT PERFORMED',
  productionStatus: 'NOT CERTIFIED'
};
fs.writeFileSync(path.resolve('dist', niche + '-metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
fs.writeFileSync(path.resolve('dist', niche + '-signing.txt'), 'Approved persistent signing certificate SHA-256: ' + signingFingerprintSha256 + '\n');
console.log('Verified APK metadata written for ' + niche + '; app identity, route/assets, signing fingerprint and source SHA recorded.');
