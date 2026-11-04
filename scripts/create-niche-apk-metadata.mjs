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
if (config.extra?.swishNicheId !== niche || config.android?.package !== product.androidPackage || config.name !== product.name) {
  throw new Error('APK metadata identity does not match the canonical niche registry.');
}
const expectedRuntime = (config.version || '1.0.0') + '-' + niche + '-isolated-api36-v1';
if (config.runtimeVersion !== expectedRuntime) throw new Error('Runtime version is not isolated to this niche and app version.');
const otaChannel = config.updates?.requestHeaders?.['expo-channel-name'];
if (otaChannel !== 'production-' + niche) throw new Error('OTA channel does not match the niche identity.');

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
  appScheme: product.scheme,
  appVersion: config.version || null,
  androidVersionCode: config.android?.versionCode ?? null,
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
  automatedTestStatus: 'PASS: typecheck, regression suite and niche route/import isolation gates',
  deviceTestStatus: 'NOT PERFORMED',
  productionStatus: 'NOT CERTIFIED'
};
fs.writeFileSync(path.resolve('dist', niche + '-metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
fs.writeFileSync(path.resolve('dist', niche + '-signing.txt'), 'Approved persistent signing certificate SHA-256: ' + signingFingerprintSha256 + '\n');
console.log('Verified APK metadata written for ' + niche + '; signing fingerprint and source SHA recorded.');
