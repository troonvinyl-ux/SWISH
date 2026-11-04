#!/usr/bin/env node
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// Fail closed unless this commit contains OTA-compatible JS/assets only since
// the latest successful isolated APK suite build that is an ancestor of it.
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

let runs;
try {
  const raw = execFileSync('gh', ['api', 'repos/' + repo + '/actions/workflows/build-swish-suite.yml/runs?status=success&per_page=30'], { encoding: 'utf8' });
  runs = JSON.parse(raw).workflow_runs ?? [];
} catch {
  reject('could not read successful Android suite history; failing closed.');
}
let baseline = null;
for (const run of runs) {
  if (run.conclusion !== 'success' || !/^[0-9a-f]{40}$/i.test(run.head_sha || '')) continue;
  try { git(['cat-file', '-e', run.head_sha + '^{commit}']); }
  catch {
    try { git(['fetch', '--no-tags', '--depth=1', 'origin', run.head_sha]); }
    catch { continue; }
  }
  try {
    git(['merge-base', '--is-ancestor', run.head_sha, currentSha]);
    baseline = run.head_sha;
    break;
  } catch { /* A successful suite on an unmerged branch is not a baseline for this commit. */ }
}
if (!baseline) reject('no successful 11-app APK suite build is an ancestor of this commit.');

let changed;
try { changed = git(['diff', '--name-only', baseline, currentSha]).split('\n').filter(Boolean); }
catch { reject('could not compare this commit with the last successful APK build.'); }
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
if (nativeChanges.length) reject('native-incompatible changes require a new APK suite before OTA.', nativeChanges);
const compatiblePatterns = [/^app\//,/^components\//,/^contexts\//,/^constants\//,/^hooks\//,/^services\//,/^shared\//,/^template\//,/^utils\//,/^assets\//];
const compatibleChanges = changed.filter(file => compatiblePatterns.some(pattern => pattern.test(file)));
if (!compatibleChanges.length) reject('no OTA-compatible application changes were found since the last APK suite.');
console.log('OTA compatibility passed against APK baseline ' + baseline + '; ' + compatibleChanges.length + ' JS/asset file(s), no native-runtime changes.');
writeOutput('true');
