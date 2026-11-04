#!/usr/bin/env node
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, readFileSync, rmSync, openSync, closeSync } from 'node:fs';
const require = createRequire(import.meta.url);
// Fail closed unless an ancestor run contains all eleven verified signed APKs
// built from that exact commit. A green workflow conclusion alone is not enough.
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const repo = process.env.GITHUB_REPOSITORY;
const currentSha = process.env.GITHUB_SHA;
if (!repo || !currentSha) throw new Error('GitHub repository and current commit SHA are required.');
if (process.env.GITHUB_REF !== 'refs/heads/main') {
  console.warn('OTA publishing is restricted to main; this ref is not eligible.');
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'should_publish=false\n');
  if (process.env.REQUIRE_OTA_SAFE === '1') process.exit(1);
  process.exit(0);
}
function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function writeOutput(value) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'should_publish=' + value + '\n');
}
function reject(reason, files = []) {
  console.warn('OTA publish blocked: ' + reason);
  if (files.length) console.warn('Native/runtime changes since last APK suite: ' + files.join(', '));
  writeOutput('false');
  if (process.env.REQUIRE_OTA_SAFE === '1') process.exit(1);
  process.exit(0);
}
function ghJson(endpoint) {
  return JSON.parse(execFileSync('gh', ['api', endpoint], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }));
}
function unzipText(zipPath, entry) {
  return execFileSync('unzip', ['-p', zipPath, entry], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).trim();
}
function artifactEntry(entries, basename) {
  return entries.find(entry => entry === basename || entry.endsWith('/' + basename));
}
function validateSuiteArtifacts(run) {
  const products = ['coins','motocross','bicycles','clothing','surplus_flip','trading_cards','antiques','fossils','beauty','tech','collectibles'];
  const payload = ghJson('repos/' + repo + '/actions/runs/' + run.id + '/artifacts?per_page=100');
  const artifacts = payload.artifacts ?? [];
  const temp = mkdtempSync(path.join(os.tmpdir(), 'swish-apk-baseline-'));
  try {
    for (const id of products) {
      const name = 'swish-' + id + '-apk';
      const artifact = artifacts.find(item => item.name === name && !item.expired && item.size_in_bytes > 0);
      if (!artifact) return false;
      const zipPath = path.join(temp, id + '.zip');
      const fd = openSync(zipPath, 'w');
      try {
        execFileSync('gh', ['api', 'repos/' + repo + '/actions/artifacts/' + artifact.id + '/zip'], { stdio: ['ignore', fd, 'pipe'], maxBuffer: 1024 * 1024 });
      } finally { closeSync(fd); }
      const entries = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
      const metaEntry = artifactEntry(entries, id + '-metadata.json');
      const shaEntry = artifactEntry(entries, id + '.sha256');
      const apkEntry = artifactEntry(entries, id + '.apk');
      if (!metaEntry || !shaEntry || !apkEntry) return false;
      const metadata = JSON.parse(unzipText(zipPath, metaEntry));
      const checksumText = unzipText(zipPath, shaEntry);
      const checksum = checksumText.match(/^([a-f0-9]{64})\s+/i)?.[1]?.toLowerCase();
      if (!checksum || metadata.sourceSha !== run.head_sha || metadata.apkSha256?.toLowerCase() !== checksum) return false;
      if (!metadata.signingFingerprintSha256 || metadata.schemeVerified !== true || metadata.assetBoundaryVerified !== true) return false;
      const apkPath = path.join(temp, id + '.apk');
      const apkFd = openSync(apkPath, 'w');
      try { execFileSync('unzip', ['-p', zipPath, apkEntry], { stdio: ['ignore', apkFd, 'pipe'], maxBuffer: 1024 * 1024 }); }
      finally { closeSync(apkFd); }
      const actual = createHash('sha256').update(readFileSync(apkPath)).digest('hex');
      if (actual !== checksum) return false;
    }
    return true;
  } catch (error) {
    console.warn('APK suite artifact verification failed: ' + (error?.message || String(error)));
    return false;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

let runs;
try {
  const raw = execFileSync('gh', ['api', 'repos/' + repo + '/actions/workflows/build-swish-suite.yml/runs?per_page=50'], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  runs = JSON.parse(raw).workflow_runs ?? [];
} catch {
  reject('could not read Android suite history; failing closed.');
}
let baseline = null;
for (const run of runs) {
  if (run.conclusion !== 'success' || !/^[0-9a-f]{40}$/i.test(run.head_sha || '')) continue;
  try { git(['cat-file', '-e', run.head_sha + '^{commit}']); }
  catch {
    try { git(['fetch', '--no-tags', '--depth=1', 'origin', run.head_sha]); }
    catch { continue; }
  }
  try { git(['merge-base', '--is-ancestor', run.head_sha, currentSha]); }
  catch { continue; }
  if (!validateSuiteArtifacts(run)) {
    console.warn('Ignoring successful workflow run ' + run.id + ': all eleven verified APK artifacts are not present for its exact source SHA.');
    continue;
  }
  baseline = run.head_sha;
  break;
}
if (!baseline) reject('no successful ancestor Android suite contains all eleven signed, checksum-verified APK artifacts from one pinned commit.');

let changed;
try { changed = git(['diff', '--name-only', baseline, currentSha]).split('\n').filter(Boolean); }
catch { reject('could not compare this commit with the last complete APK suite.'); }
const nativePatterns = [
  /^app\.config\.js$/,
  /^app\.json$/,
  /^eas\.json$/,
  /^niche-modules\.json$/,
  /^scripts\/prepare-niche-assets\.mjs$/,
  /^scripts\/prepare-niche-routes\.js$/,
  /^package\.json$/,
  /^(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/,
  /^(?:metro|babel|react-native)\.config\.(?:js|cjs|mjs)$/,
  /^expo-env\.d\.ts$/,
  /^plugins\//,
  /^android\//,
  /^ios\//,
  /^native\//
];
const nativeChanges = changed.filter(file => nativePatterns.some(pattern => pattern.test(file)));
if (nativeChanges.length) reject('native-incompatible changes require a new complete APK suite before OTA.', nativeChanges);
const compatiblePatterns = [/^app\//,/^components\//,/^contexts\//,/^constants\//,/^hooks\//,/^services\//,/^shared\//,/^template\//,/^utils\//,/^assets\//];
const compatibleChanges = changed.filter(file => compatiblePatterns.some(pattern => pattern.test(file)));
if (!compatibleChanges.length) reject('no OTA-compatible application changes were found since the last complete APK suite.');
console.log('OTA compatibility passed against complete 11-app APK baseline ' + baseline + '; ' + compatibleChanges.length + ' JS/asset file(s), no native-runtime changes.');
writeOutput('true');
