import test from 'node:test';
import assert from 'node:assert/strict';
import { selectedOtaPlatforms, assertOtaBaselineRun, assertCompatibleRuntime, assertNoNativeOtaChanges } from './unified-ota-policy.mjs';
const baseline={platform:'android',binaryVerified:true,runtimeVersion:'native-fingerprint',channel:'preview-unified'};
test('APK OTA targets Android only; all still needs both binaries',()=>{
 assert.deepEqual(selectedOtaPlatforms('android'),['android']);
 assert.deepEqual(selectedOtaPlatforms('ios'),['ios']);
 assert.deepEqual(selectedOtaPlatforms('all'),['android','ios']);
 for(const value of [undefined,'web','android; echo no']) assert.throws(()=>selectedOtaPlatforms(value));
});
test('approved Android entry workflows retain successful main/source checks',()=>{
 for(const file of ['build-swish-unified.yml','build-swish-release-apk.yml','build-android-apk.yml']) assert.doesNotThrow(()=>assertOtaBaselineRun({path:'.github/workflows/'+file,head_sha:'a'.repeat(40),head_branch:'main',conclusion:'success'}));
 for(const change of [{conclusion:'failure'},{head_branch:'other'},{path:'.github/workflows/test-lab-apk.yml'},{head_sha:'unknown'}]) assert.throws(()=>assertOtaBaselineRun({path:'.github/workflows/build-swish-unified.yml',head_sha:'a'.repeat(40),head_branch:'main',conclusion:'success',...change}));
});
test('matching platform, channel and exact resolved runtime are mandatory',()=>{
 assert.doesNotThrow(()=>assertCompatibleRuntime(baseline,{runtimeVersion:'native-fingerprint'},'preview-unified','android'));
 for(const [meta,resolved,channel,platform] of [[baseline,{runtimeVersion:'changed'},'preview-unified','android'],[baseline,{runtimeVersion:'native-fingerprint'},'production-unified','android'],[baseline,{runtimeVersion:'native-fingerprint'},'preview-unified','ios'],[{...baseline,binaryVerified:false},{runtimeVersion:'native-fingerprint'},'preview-unified','android'],[baseline,{},'preview-unified','android']]) assert.throws(()=>assertCompatibleRuntime(meta,resolved,channel,platform));
});
test('native dependencies, identities and packaging changes cannot be sent as OTA',()=>{
 assert.doesNotThrow(()=>assertNoNativeOtaChanges(['app/(tabs)/inventory.tsx','services/itemService.ts','components/feature/AppUpdateNotice.tsx']));
 for(const file of ['app.config.js','app.json','eas.json','package.json','package-lock.json','pnpm-lock.yaml','plugins/withAndroidSdk36.js','android/app/build.gradle','ios/Podfile','niche-modules.json']) assert.throws(()=>assertNoNativeOtaChanges([file]));
});
