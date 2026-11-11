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
