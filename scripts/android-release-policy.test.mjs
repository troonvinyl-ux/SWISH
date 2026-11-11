import test from 'node:test';
import assert from 'node:assert/strict';
import {approvedCertificate,testingCertificate,assertReleaseConfiguration,approvedProject} from './android-release-policy.mjs';
import {assertProductionApproval} from './verify-production-approval.mjs';
import {verifyPublication} from './verify-ota-publication.mjs';
const config={android:{package:'com.swish.inventory',versionCode:1794427892},scheme:'onspaceapp',extra:{eas:{projectId:approvedProject},supabase:{url:'https://existing.example',anonKey:'public-anon'}},runtimeVersion:{policy:'fingerprint'},updates:{enabled:true,url:`https://u.expo.dev/${approvedProject}`,requestHeaders:{'expo-channel-name':'preview-unified'}}};
const env={SWISH_NICHE:'',SWISH_MASTER_ADMIN:'0',SWISH_TEST_LAB:'0',SWISH_RELEASE_CHANNEL:'preview-unified',EXPO_PROJECT_ID:approvedProject,EXPO_PUBLIC_SUPABASE_URL:'https://existing.example',EXPO_PUBLIC_SUPABASE_ANON_KEY:'public-anon'};
const check=(c=config,e=env)=>assertReleaseConfiguration(c,e,{'expo-updates':'~0.28.17'},{'expo-updates':'~0.28.15'},'0.28.18');
test('unified original-identity update configuration accepts supported SDK patch versions',()=>assert.doesNotThrow(()=>check()));
test('missing credentials/settings and wrong project/backend/channel fail clearly',()=>{
 for(const key of ['EXPO_PROJECT_ID','EXPO_PUBLIC_SUPABASE_URL','EXPO_PUBLIC_SUPABASE_ANON_KEY'])assert.throws(()=>check(config,{...env,[key]:''}));
 for(const override of [{EXPO_PROJECT_ID:'another-project'},{SWISH_RELEASE_CHANNEL:'production-unified'},{EXPO_PUBLIC_SUPABASE_URL:'https://other.example'},{SWISH_NICHE:'coins'},{SWISH_MASTER_ADMIN:'1'}])assert.throws(()=>check(config,{...env,...override}));
});
test('compiled-upgrade configuration rejects disabled updates, anti-bricking changes, invalid versions and changed identities',()=>{
 for(const change of [{updates:{...config.updates,enabled:false}},{updates:{...config.updates,disableAntiBrickingMeasures:true}},{updates:{...config.updates,useEmbeddedUpdate:false}},{runtimeVersion:{policy:'appVersion'}},{android:{...config.android,versionCode:2100000001}},{android:{...config.android,versionCode:1794427891}},{android:{...config.android,package:'other'}},{scheme:'other'}])assert.throws(()=>check({...config,...change}));
});
test('preview fallback is the inspected certificate; missing or testing production credentials are prohibited',()=>{
 assert.equal(approvedCertificate('preview-unified',''),testingCertificate);
 assert.throws(()=>approvedCertificate('production-unified',''));
 assert.throws(()=>approvedCertificate('production-unified',testingCertificate));
 assert.throws(()=>approvedCertificate('preview-unified','bad'));
 assert.throws(()=>approvedCertificate('production-unified','a'.repeat(64)),/migration decision/);
});
test('production requires the existing protected current-source acceptance verdict',()=>{
 const sha='a'.repeat(40),run={path:'.github/workflows/production-acceptance-gate.yml',conclusion:'success',head_branch:'main',head_sha:sha},verdict={sourceSha:sha,acceptancePassed:true,releaseDecision:'ELIGIBLE_FOR_OWNER_RELEASE_REVIEW'};
 assert.doesNotThrow(()=>assertProductionApproval(run,verdict,sha));
 for(const change of [{conclusion:'failure'},{head_sha:'b'.repeat(40)},{path:'other'}])assert.throws(()=>assertProductionApproval({...run,...change},verdict,sha));
 assert.throws(()=>assertProductionApproval(run,{...verdict,acceptancePassed:false},sha));
});
test('Android-only publication receipts require one exact-runtime update, never iOS',()=>{
 const impact={platforms:['android'],baselines:[{platform:'android',runtimeVersion:'native'}],projectId:approvedProject,channel:'preview-unified',targetSha:'a'.repeat(40),baselineRun:'123'};
 const publication=[{id:'12345678-1234-1234-1234-123456789abc',group:'group',gitCommitHash:'a'.repeat(40),platform:'android',runtimeVersion:'native'}];
 assert.equal(verifyPublication(publication,impact).deviceAcceptance,'NOT TESTED');
 for(const change of [{platform:'ios'},{runtimeVersion:'wrong'},{id:null},{group:null}])assert.throws(()=>verifyPublication([{...publication[0],...change}],impact));
});
test('missing Expo token and missing signing secrets fail before any network publication', async()=>{
 const {spawnSync}=await import('node:child_process');
 const result=spawnSync(process.execPath,['scripts/verify-expo-project.mjs'],{encoding:'utf8',env:{...process.env,EXPO_PROJECT_ID:approvedProject,EXPO_TOKEN:''}});
 assert.notEqual(result.status,0);assert.match(result.stderr,/Missing GitHub Secret EXPO_TOKEN/);
 const environment={...process.env,SWISH_RELEASE_CHANNEL:'production-unified'};
 for(const key of ['SWISH_RELEASE_KEYSTORE_BASE64','SWISH_KEYSTORE_STORE_PASSWORD','SWISH_KEYSTORE_KEY_PASSWORD','SWISH_KEYSTORE_KEY_ALIAS','SWISH_RELEASE_CERT_SHA256'])environment[key]='';
 const signing=spawnSync('bash',['scripts/resolve-android-signing.sh'],{encoding:'utf8',env:environment});
 assert.notEqual(signing.status,0);assert.match(signing.stderr,/Missing GitHub signing secrets/);
});
test('OTA publication requires an actual repository-owner review rule, not just an environment name',async()=>{
 const {assertOwnerReviewEnvironment}=await import('./verify-ota-owner-approval.mjs');
 assert.doesNotThrow(()=>assertOwnerReviewEnvironment({protection_rules:[{type:'required_reviewers',reviewers:[{type:'User',reviewer:{login:'troonvinyl-ux'}}]}]},'troonvinyl-ux'));
 for(const env of [{},{protection_rules:[]},{protection_rules:[{type:'required_reviewers',reviewers:[]}]}])assert.throws(()=>assertOwnerReviewEnvironment(env,'troonvinyl-ux'));
});
