#!/usr/bin/env node
// Aggregate the eleven niche APK artifacts into a conservative testing index.
const fs = require('node:fs');
const path = require('node:path');
const registry = require('../niche-modules.json');
const artifactRoot = process.env.SWISH_ARTIFACTS_DIR || 'collected-artifacts';
const artifactJsonPath = process.env.SWISH_ARTIFACTS_JSON || 'release-artifacts.json';
const artifactsPayload = fs.existsSync(artifactJsonPath) ? JSON.parse(fs.readFileSync(artifactJsonPath, 'utf8')) : {};
const artifacts = Array.isArray(artifactsPayload.artifacts) ? artifactsPayload.artifacts : [];
const artifactByName = new Map(artifacts.map(item => [item.name, item]));
const runId = process.env.GITHUB_RUN_ID || '';
const repo = process.env.GITHUB_REPOSITORY || '';
const server = process.env.GITHUB_SERVER_URL || 'https://github.com';
const runUrl = runId && repo ? server + '/' + repo + '/actions/runs/' + runId : null;
const expectedSha = process.env.GITHUB_SHA || '';

function findFile(directory, filename) {
  if (!fs.existsSync(directory)) return null;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = findFile(full, filename);
      if (nested) return nested;
    } else if (entry.name === filename) return full;
  }
  return null;
}
function artifactUrl(item) {
  return item && runId && repo ? server + '/' + repo + '/actions/runs/' + runId + '/artifacts/' + item.id : runUrl;
}
function md(value) {
  return String(value ?? '—').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

const products = Object.entries(registry.products);
if (products.length !== 11) throw new Error('Testing index requires exactly eleven registered niche products.');
const rows = products.map(([id, product]) => {
  const metadataPath = findFile(artifactRoot, id + '-metadata.json');
  const metadata = metadataPath ? JSON.parse(fs.readFileSync(metadataPath, 'utf8')) : null;
  const apkArtifact = artifactByName.get('swish-' + id + '-apk');
  const evidenceArtifact = artifactByName.get('swish-' + id + '-build-evidence');
  const shaPath = findFile(artifactRoot, id + '.sha256');
  const shaText = shaPath ? fs.readFileSync(shaPath, 'utf8').trim() : '';
  const sourceMatches = metadata && metadata.sourceSha === expectedSha;
  const status = metadata && apkArtifact && sourceMatches && shaText.includes(metadata.apkSha256)
    ? 'PASS — signed APK verified'
    : evidenceArtifact ? 'FAILED — build evidence retained, no verified APK' : 'NOT PRODUCED — no verified APK artifact';
  return {
    nicheId: id,
    productName: product.name,
    artifactName: 'swish-' + id + '-apk',
    artifactUrl: artifactUrl(apkArtifact),
    evidenceArtifactName: evidenceArtifact?.name ?? null,
    evidenceArtifactUrl: artifactUrl(evidenceArtifact),
    androidPackage: metadata?.androidPackage ?? product.androidPackage,
    appVersion: metadata?.appVersion ?? null,
    androidVersionCode: metadata?.androidVersionCode ?? null,
    sourceSha: metadata?.sourceSha ?? expectedSha,
    sourceShaMatchesRun: Boolean(sourceMatches),
    signingFingerprintSha256: metadata?.signingFingerprintSha256 ?? null,
    runtimeVersion: metadata?.runtimeVersion ?? null,
    otaChannel: metadata?.otaChannel ?? null,
    apkSha256: metadata?.apkSha256 ?? (shaText.split(/\s+/)[0] || null),
    buildStatus: status,
    automatedTestStatus: metadata?.automatedTestStatus ?? 'NOT PASSED / NOT REACHED',
    deviceTestStatus: 'NOT PERFORMED',
    productionStatus: 'NOT CERTIFIED'
  };
});
const passed = rows.filter(row => row.buildStatus.startsWith('PASS')).length;
const index = {
  generatedAt: new Date().toISOString(),
  repository: repo,
  workflowRunId: runId,
  workflowRunUrl: runUrl,
  pinnedSourceSha: expectedSha,
  nicheCount: rows.length,
  signedApksVerified: passed,
  deviceTesting: 'NOT PERFORMED',
  productionCertification: 'NOT CERTIFIED',
  products: rows
};
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/apk-testing-index.json', JSON.stringify(index, null, 2) + '\n');
const table = [
  '# SWISH — 11-app Android testing index',
  '',
  '- Source commit: ' + md(expectedSha),
  '- Actions run: ' + (runUrl ? '[' + md(runId) + '](' + runUrl + ')' : '—'),
  '- Verified signed APKs: ' + passed + ' / 11',
  '- Device installation/launch: **NOT PERFORMED**',
  '- Production certification: **NOT CERTIFIED**',
  '',
  '| Product | APK / evidence | Android package | Version / code | Source SHA | Signing SHA-256 | Runtime | OTA channel | Build / tests | Device test |',
  '|---|---|---|---|---|---|---|---|---|---|'
];
for (const row of rows) {
  const link = row.artifactUrl ? '[' + md(row.artifactName) + '](' + row.artifactUrl + ')' : md(row.artifactName);
  const evidence = row.evidenceArtifactUrl ? ' · [build log](' + row.evidenceArtifactUrl + ')' : '';
  table.push('| ' + md(row.productName) + ' | ' + link + evidence + ' | ' + md(row.androidPackage) + ' | ' + md(row.appVersion) + ' / ' + md(row.androidVersionCode) + ' | ' + md(row.sourceSha) + ' | ' + md(row.signingFingerprintSha256) + ' | ' + md(row.runtimeVersion) + ' | ' + md(row.otaChannel) + ' | ' + md(row.buildStatus) + '; ' + md(row.automatedTestStatus) + ' | ' + md(row.deviceTestStatus) + ' |');
}
table.push('', 'APK checksums and verification reports are included in each successful niche APK artifact. A successful CI build does not establish installation, launch, login, live data isolation or production readiness.');
fs.writeFileSync('dist/apk-testing-index.md', table.join('\n') + '\n');
console.log('Generated testing index: ' + passed + '/11 verified APK artifacts.');
