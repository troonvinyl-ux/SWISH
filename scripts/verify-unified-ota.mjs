// No automatic publishing. Verify both actual native artifacts before compatible unified OTA.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
const repo=process.env.GITHUB_REPOSITORY,runId=process.env.SWISH_BASELINE_RUN,current=process.env.GITHUB_SHA;
if(!repo || !/^\d+$/.test(runId ?? '') || !current || process.env.GITHUB_REF!=='refs/heads/main') throw Error('Pinned main commit and explicit unified baseline run required');
const gh=endpoint=>JSON.parse(execFileSync('gh',['api',endpoint],{encoding:'utf8',maxBuffer:20*1024*1024}));
const run=gh(`repos/${repo}/actions/runs/${runId}`);
if(run.conclusion!=='success' || run.path!=='.github/workflows/build-swish-unified.yml') throw Error('A successful unified native workflow is required');
execFileSync('git',['merge-base','--is-ancestor',run.head_sha,current]);
const artifacts=gh(`repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`).artifacts;
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'swish-unified-ota-'));
try {
 for(const platform of ['android','ios']) {
  const artifact=artifacts.find(row=>row.name===`swish-unified-${platform}` && !row.expired && row.size_in_bytes>0);
  if(!artifact) throw Error(`Missing actual ${platform} binary artifact`);
  execFileSync('gh',['run','download',runId,'--repo',repo,'--name',artifact.name,'--dir',path.join(temp,platform)]);
  const files=[];const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);if(entry.isDirectory())walk(full);else files.push(full);}};walk(path.join(temp,platform));
  const evidence=files.find(file=>file.endsWith(`unified-${platform}-evidence.json`));
  const binary=files.find(file=>file.endsWith(platform==='android'?'swish-unified.apk':'swish-unified.ipa'));
  if(!evidence || !binary) throw Error('Baseline evidence or binary missing');
  const meta=JSON.parse(fs.readFileSync(evidence,'utf8'));
  if(meta.sourceSha!==run.head_sha || meta.binaryVerified!==true || !meta.runtimeVersion || meta.channel!==process.env.SWISH_RELEASE_CHANNEL) throw Error('Source, runtime or channel baseline mismatch');
  const checksum=crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex');
  if(checksum!==(meta.apkSha256 ?? meta.artifactSha256)) throw Error('Native artifact checksum mismatch');
 }
 const changed=execFileSync('git',['diff','--name-only',run.head_sha,current],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
 const native=/^(app\.(config\.(js|ts)|json)|eas\.json|package\.json|.*lock.*|(?:metro|babel|react-native)\.config\..*|niche-modules\.json|android\/|ios\/|plugins\/|native\/|scripts\/prepare-niche)/;
 if(changed.some(file=>native.test(file))) throw Error('Native or packaging changes require new native builds, not OTA');
 const registry=JSON.parse(fs.readFileSync('niche-modules.json','utf8'));
 // Shared-engine changes affect every module. Niche-route changes are separately identified.
 const shared=changed.some(file=>/^(services|hooks|contexts|shared|template|components)\//.test(file));
 const affected=shared?Object.keys(registry.products):Object.entries(registry.products).filter(([,module])=>changed.some(file=>[module.entry,module.home,...module.dedicatedRoutes].filter(Boolean).some(route=>file==='app/'+route))).map(([id])=>id);
 const report={baselineRun:runId,baselineSha:run.head_sha,targetSha:current,channel:process.env.SWISH_RELEASE_CHANNEL,affectedModules:affected,changedFiles:changed,atomicBundle:true,nativeChanges:false};
 fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/unified-ota-impact.json',JSON.stringify(report,null,2));
 console.log('Verified native baseline and compatible source impact. Expo fingerprint runtime matching remains mandatory.');
}finally{fs.rmSync(temp,{recursive:true,force:true});}
