// Manual release gate. Android OTA needs its APK, not an unrelated iOS build.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {approvedCertificate,approvedProject} from './android-release-policy.mjs';
import { selectedOtaPlatforms, assertOtaBaselineRun, assertCompatibleRuntime, assertNoNativeOtaChanges } from './unified-ota-policy.mjs';
const repo=process.env.GITHUB_REPOSITORY, runId=process.env.SWISH_BASELINE_RUN, current=process.env.GITHUB_SHA;
if(!repo || !/^\d+$/.test(runId ?? '') || !/^[a-f0-9]{40}$/.test(current ?? '') || process.env.GITHUB_REF!=='refs/heads/main') throw Error('Pinned main commit and explicit unified baseline run required');
const platforms=selectedOtaPlatforms(process.env.SWISH_OTA_PLATFORM ?? 'android');
const channel=process.env.SWISH_RELEASE_CHANNEL, projectId=process.env.EXPO_PROJECT_ID;
if(!['preview-unified','production-unified'].includes(channel)) throw Error('Approved unified channel required');
if(projectId!==approvedProject) throw Error('Existing Expo project ID required; do not create a replacement project.');
const gh=endpoint=>JSON.parse(execFileSync('gh',['api',endpoint],{encoding:'utf8',maxBuffer:20*1024*1024}));
const run=gh(`repos/${repo}/actions/runs/${runId}`);
assertOtaBaselineRun(run);
execFileSync('git',['merge-base','--is-ancestor',run.head_sha,current]);
const changed=execFileSync('git',['diff','--name-only',run.head_sha,current],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
assertNoNativeOtaChanges(changed);
const artifacts=gh(`repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`).artifacts;
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'swish-unified-ota-'));
try {
 const baselines=[];
 for(const platform of platforms) {
  const artifact=artifacts.find(row=>row.name===`swish-unified-${platform}` && !row.expired && row.size_in_bytes>0);
  if(!artifact) throw Error(`Missing actual ${platform} binary artifact`);
  execFileSync('gh',['run','download',runId,'--repo',repo,'--name',artifact.name,'--dir',path.join(temp,platform)]);
  const files=[];
  const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);if(entry.isDirectory())walk(full);else files.push(full);}};
  walk(path.join(temp,platform));
  const evidence=files.find(file=>file.endsWith(`unified-${platform}-evidence.json`));
  const binary=files.find(file=>file.endsWith(platform==='android'?'swish-unified.apk':'swish-unified.ipa'));
  const configFile=files.find(file=>file.endsWith('unified-runtime-config.json'));
  if(!evidence || !binary || !configFile) throw Error('Baseline binary, update config or evidence missing; build an update-enabled baseline once.');
  const meta=JSON.parse(fs.readFileSync(evidence,'utf8'));
  const config=JSON.parse(fs.readFileSync(configFile,'utf8'));
  if(String(meta.buildRunId)!==String(runId) || meta.sourceSha!==run.head_sha || meta.binaryVerified!==true || !meta.runtimeVersion || meta.channel!==channel) throw Error('Source, runtime or channel baseline mismatch');
  if(config.extra?.swishUnifiedBuild!==true || config.extra?.eas?.projectId!==projectId || config.updates?.enabled!==true || config.updates?.url!==`https://u.expo.dev/${projectId}` || config.updates?.requestHeaders?.['expo-channel-name']!==channel) throw Error('Baseline native build belongs to a different update project or channel.');
  if(platform==='android') {
   const original=JSON.parse(fs.readFileSync('app.json','utf8')).expo;
   const expected=approvedCertificate(channel,process.env.SWISH_RELEASE_CERT_SHA256);
   if(meta.package!==original.android?.package || !/^[a-f0-9]{64}$/.test(expected) || meta.certificateSha256!==expected) throw Error('Original Android package/signing evidence mismatch.');
  }
  const checksum=crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex');
  if(checksum!==(meta.apkSha256 ?? meta.artifactSha256)) throw Error('Native artifact checksum mismatch');
  const checksumFile=files.find(file=>file.endsWith(platform==='android'?'swish-unified.sha256':'swish-unified-ipa.sha256'));
  if(!checksumFile || fs.readFileSync(checksumFile,'utf8').trim().split(/\s+/)[0]!==checksum)throw Error('Retained binary checksum receipt mismatch');
  const currentConfig=JSON.parse(execFileSync('npx',['--no-install','expo','config','--type','public','--json'],{encoding:'utf8',maxBuffer:20*1024*1024}));
  if(JSON.stringify(config.extra?.supabase)!==JSON.stringify(currentConfig.extra?.supabase))throw Error('Native baseline and OTA backend environments differ');
  if(platform==='android') {
    const expected=approvedCertificate(channel,process.env.SWISH_RELEASE_CERT_SHA256);
    const actual=JSON.parse(execFileSync(process.env.SWISH_APK_PYTHON,['scripts/inspect-unified-apk.py',binary],{encoding:'utf8',maxBuffer:4*1024*1024}));
    for(const key of ['package','versionName','versionCode','certificateSha256','runtimeVersion','channel','updatesEnabled','nativeUpdaterPresent','updateUrl','antiBrickingEnabled','hasEmbeddedUpdate','apkSha256'])if(actual[key]!==meta[key])throw Error('Actual baseline APK/evidence mismatch: '+key);
    if(actual.certificateSha256!==expected || actual.updatesEnabled!==true || !actual.antiBrickingEnabled || !actual.hasEmbeddedUpdate)throw Error('Actual baseline signing/update protection mismatch');
    const tools=process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
    if(!tools)throw Error('Android signing verifier unavailable');
    execFileSync(path.join(tools,'build-tools','36.0.0','apksigner'),['verify','--verbose',binary],{stdio:'pipe'});
  }
  // Installed Expo CLI resolver, not an invented runtime or compatibility override.
  const resolved=JSON.parse(execFileSync('npx',['--no-install','expo-updates','runtimeversion:resolve','--platform',platform,'--workflow','managed'],{encoding:'utf8',maxBuffer:20*1024*1024}));
  assertCompatibleRuntime(meta,resolved,channel,platform);
  baselines.push({platform,sourceSha:meta.sourceSha,runtimeVersion:meta.runtimeVersion,artifactSha256:checksum});
 }
 const registry=JSON.parse(fs.readFileSync('niche-modules.json','utf8'));
 const shared=changed.some(file=>/^(services|hooks|contexts|shared|template|components)\//.test(file));
 const affected=shared?Object.keys(registry.products):Object.entries(registry.products).filter(([,module])=>changed.some(file=>[module.entry,module.home,...module.dedicatedRoutes].filter(Boolean).some(route=>file==='app/'+route))).map(([id])=>id);
 const report={platforms,baselines,projectId,baselineRun:runId,baselineSha:run.head_sha,targetSha:current,channel,affectedModules:affected,changedFiles:changed,atomicBundle:true,nativeChanges:false,installedDeviceAcceptance:'NOT TESTED'};
 fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/unified-ota-impact.json',JSON.stringify(report,null,2));
 console.log('Selected-platform artifacts and native fingerprints match. Owner approval and installed-device verification remain separate.');
} finally { fs.rmSync(temp,{recursive:true,force:true}); }
