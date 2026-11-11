import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import fs from 'node:fs';
const baseline = JSON.parse(fs.readFileSync(new URL('../release/android-installed-baseline.json', import.meta.url), 'utf8'));
export const testingCertificate = 'fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c';
export const approvedProject = baseline.expectedProjectId;
export function normalizeCertificate(value = '') { return value.replace(/[:\s]/g, '').toLowerCase(); }
export function approvedCertificate(channel, configured) {
  const certificate = normalizeCertificate(configured);
  if (!['preview-unified', 'production-unified'].includes(channel)) throw Error('Unknown release channel');
  if (!certificate && channel === 'preview-unified' && baseline.signingKind === 'expo-public-testing-only' && baseline.certificateSha256 === testingCertificate) return testingCertificate;
  if (!/^[a-f0-9]{64}$/.test(certificate)) throw Error('Missing approved signing certificate');
  if (channel === 'production-unified' && certificate === testingCertificate) throw Error('Public testing certificate is prohibited for production');
  if (certificate !== baseline.certificateSha256) throw Error('Certificate differs from inspected installed baseline; explicit owner migration decision and new original-APK evidence required');
  return certificate;
}
export function assertReleaseConfiguration(config, env, dependencies, bundled, installedUpdates) {
  if (env.SWISH_NICHE || env.SWISH_MASTER_ADMIN !== '0' || env.SWISH_TEST_LAB !== '0') throw Error('Unified build flags required');
  if (config.android?.package !== baseline.package || config.scheme !== baseline.scheme) throw Error('Original Android identity mismatch');
  const code = config.android?.versionCode;
  if (!Number.isInteger(code) || code <= baseline.versionCode || code > 2100000000) throw Error('versionCode must exceed the installed baseline and stay within Android limits');
  if ((env.EXPO_PROJECT_ID || env.EAS_PROJECT_ID) !== approvedProject || config.extra?.eas?.projectId !== approvedProject) throw Error('Approved existing Expo project required');
  if (config.updates?.url !== `https://u.expo.dev/${approvedProject}` || config.updates?.enabled !== true || config.runtimeVersion?.policy !== 'fingerprint') throw Error('Update-enabled fingerprint configuration required');
  if (config.updates?.disableAntiBrickingMeasures === true || config.updates?.useEmbeddedUpdate === false) throw Error('Embedded recovery and anti-bricking protections must remain enabled');
  if (config.updates?.requestHeaders?.['expo-channel-name'] !== env.SWISH_RELEASE_CHANNEL || !['preview-unified','production-unified'].includes(env.SWISH_RELEASE_CHANNEL)) throw Error('Channel mismatch');
  const semver = require('semver');
  if (!dependencies['expo-updates'] || !semver.satisfies(installedUpdates, bundled['expo-updates']) || !semver.satisfies(installedUpdates, dependencies['expo-updates'])) throw Error('expo-updates must match the installed Expo SDK supported version');
  for (const key of ['EXPO_PUBLIC_SUPABASE_URL','EXPO_PUBLIC_SUPABASE_ANON_KEY']) if (!env[key]) throw Error(`Missing GitHub setting: ${key}`);
  if (config.extra?.supabase?.url !== env.EXPO_PUBLIC_SUPABASE_URL || config.extra?.supabase?.anonKey !== env.EXPO_PUBLIC_SUPABASE_ANON_KEY) throw Error('Public backend build/publication environment mismatch');
}
