#!/usr/bin/env node
// Validate the generated Android Gradle properties before any APK/AAB release build.
import fs from 'node:fs';

const file = 'android/gradle.properties';
if (!fs.existsSync(file)) {
  console.error('Android SDK validation FAILED: generated android/gradle.properties is missing.');
  process.exit(1);
}
const properties = new Map();
for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([^#!=:\s]+)=(.*)$/);
  if (match) properties.set(match[1], match[2].trim());
}
const expected = {
  'android.compileSdkVersion': '36',
  'android.targetSdkVersion': '36',
  'android.buildToolsVersion': '36.0.0',
};
const errors = [];
for (const [key, value] of Object.entries(expected)) {
  if (properties.get(key) !== value) errors.push(key + ' must be ' + value + ' (found ' + (properties.get(key) ?? 'missing') + ')');
}
if (errors.length) {
  console.error('Android SDK validation FAILED:');
  for (const error of errors) console.error('- ' + error);
  process.exit(1);
}
console.log('Android compile SDK 36, target SDK 36 and Build Tools 36.0.0 verified.');
