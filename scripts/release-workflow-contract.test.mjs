import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const yaml=require('js-yaml');
const read=file=>yaml.load(fs.readFileSync('.github/workflows/'+file,'utf8')); // rejects duplicate mapping keys

test('release workflow YAML rejects duplicate environment keys, including disabled iOS jobs',()=>{
 for(const file of ['build-swish-release-apk.yml','build-swish-unified.yml','publish-swish-ota.yml'])assert.ok(read(file).jobs);
 assert.throws(()=>yaml.load('env:\n  EXPO_TOKEN: first\n  EXPO_TOKEN: second\n'),/duplicated mapping key/);
});
test('tools are initialized before release scripts and OTA publication remains owner-reviewed/manual',()=>{
 const build=read('build-swish-unified.yml');
 for(const job of ['verify','android']) {
  const steps=build.jobs[job].steps;
  const signing=steps.findIndex(step=>step.run?.includes('resolve-android-signing.sh'));
  for(const action of ['actions/checkout@','actions/setup-node@','actions/setup-java@'])assert.ok(steps.findIndex(step=>step.uses?.startsWith(action))<signing);
 }
 const ota=read('publish-swish-ota.yml');
 assert.deepEqual(Object.keys(ota.on),['workflow_dispatch']);
 assert.equal(ota.jobs.publish.environment,'swish-ota-approval');
 assert.equal(ota.on.workflow_dispatch.inputs.platform.default,'android');
 const steps=ota.jobs.publish.steps;
 const publish=steps.findIndex(step=>step.name?.startsWith('Publish one atomic'));
 assert.ok(steps.findIndex(step=>step.run?.includes('verify-ota-owner-approval.mjs'))<publish);
 assert.ok(steps.findIndex(step=>step.run?.includes('verify-unified-ota.mjs'))<publish);
});
test('native release inputs trigger the existing APK entry workflow',()=>{
 const paths=read('build-swish-release-apk.yml').on.push.paths;
 for(const path of ['app.json','app.config.js','eas.json','package.json','pnpm-lock.yaml','plugins/**','release/android-installed-baseline.json'])assert.ok(paths.includes(path));
});
test('EAS profiles select the unified shell without invalid empty environment values',()=>{
 const eas=JSON.parse(fs.readFileSync('eas.json','utf8'));
 for(const name of ['unified-preview','unified-ios-testing','unified-store']) {
  const profile=eas.build[name];
  assert.equal(profile.env.SWISH_NICHE,undefined);
  assert.equal(profile.env.SWISH_MASTER_ADMIN,'0');
  assert.equal(profile.env.SWISH_TEST_LAB,'0');
  for(const value of Object.values(profile.env))assert.ok(typeof value==='string'&&value.length>0);
 }
});
