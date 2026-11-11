// Pure/injected tests, no provider or production writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {blankAcceptance,evaluateAcceptance,speedCohort,continuousPercentile} from './production-acceptance-contract.mjs';
import {loadJwtFixtureConfig} from './verify-command-jwt.mjs';
const source='a'.repeat(40),ids=Object.keys(JSON.parse(fs.readFileSync(new URL('../niche-modules.json',import.meta.url),'utf8')).products);
const attempt=(patch={})=>({attemptRef:'fixture',sourceSha:source,nicheId:'coins',cohort:'listing_ready',platform:'android',clock:'native_process',openedAt:1000,liveAt:60000,outcome:'confirmed_live',liveConfirmation:'seller_GetItem_Active',canonicalOccurrences:1,photosRetained:true,manualInterventions:0,...patch});
test('blank thirteen-niche evidence cannot release and all fourteen journey steps remain required',()=>{
 const input=blankAcceptance(source,ids),report=evaluateAcceptance(input,source,ids);
 assert.equal(ids.length,13);assert.equal(input.checks.filter(row=>row.id.startsWith('coins:')).length,14);
 assert.equal(report.acceptancePassed,false);assert.equal(report.releaseDecision,'BLOCKED');assert.equal(report.speed.length,78);
});
test('static presence, zero assertions, unresolved artifacts and stale commits cannot certify runtime',()=>{
 for(const patch of [{kind:'source'},{assertions:0},{sourceSha:'b'.repeat(40)},{evidence:[]},{result:'SKIPPED'}]){
  const input=blankAcceptance(source,ids);input.review={authorized:true,sourceSha:source};
  input.checks[0]={...input.checks[0],result:'PASS',observed:true,kind:'runtime',assertions:1,evidence:[{path:'fixture',sha256:'b'.repeat(64),verified:true}],...patch};
  assert.notEqual(evaluateAcceptance(input,source,ids).checks[0].result,'PASS');
 }
});
test('continuous percentiles and all-attempt success denominator include failures',()=>{
 assert.equal(continuousPercentile([10,20],.9),19);
 const result=speedCohort([attempt(),attempt({attemptRef:'failed',outcome:'failed',liveAt:null,manualInterventions:1})],ids,'listing_ready','android');
 assert.equal(result.samples,1);assert.equal(result.medianMs,59000);assert.equal(result.publishedWithin60Pct,50);assert.equal(result.failedAttempts,1);assert.equal(result.manualInterventionItems,1);
});
test('research and native/browser cohorts stay separate; empty percentiles and rates are null',()=>{
 const rows=[attempt(),attempt({attemptRef:'research',cohort:'research_review',liveAt:121000,manualInterventions:2})];
 assert.equal(speedCohort(rows,ids,'listing_ready','android').medianMs,59000);
 assert.equal(speedCohort(rows,ids,'research_review','android').medianMs,120000);
 const empty=speedCohort(rows,ids,'research_review','web');assert.equal(empty.medianMs,null);assert.equal(empty.publishedWithin60Pct,null);assert.equal(empty.failedAttempts,null);
});
test('Expo JS foreground timestamps, missing photos, duplicate records and Ack-only publication are excluded',()=>{
 for(const patch of [{clock:'expo_js_launch_or_foreground'},{photosRetained:false},{canonicalOccurrences:2},{liveConfirmation:'Ack'},{liveAt:100},{outcome:'unconfirmed'}])assert.equal(speedCohort([attempt(patch)],ids,'listing_ready','android').samples,0);
});
test('open high defects and duplicate checks keep a fully populated manifest blocked',()=>{
 const input=blankAcceptance(source,ids);input.review={authorized:true,sourceSha:source};
 input.checks=input.checks.map(row=>({...row,result:'PASS',observed:true,assertions:1,evidence:[{path:'fixture',sha256:'b'.repeat(64),verified:true}]}));
 input.attempts=ids.map((nicheId,index)=>attempt({nicheId,attemptRef:'fixture'+index}));
 assert.equal(evaluateAcceptance(input,source,ids).acceptancePassed,true);
 input.defects=[{severity:'high',resolved:false}];assert.equal(evaluateAcceptance(input,source,ids).acceptancePassed,false);
 input.defects=[];input.checks.push(input.checks[0]);assert.ok(evaluateAcceptance(input,source,ids).blockers.includes('DUPLICATE_CHECK_EVIDENCE'));
});
test('existing approved JWT runner supports thirteen niches and still requires an unentitled niche',()=>{
 const token=claims=>Buffer.from('{}').toString('base64url')+'.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.fixture';
 const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),exp=Math.floor(Date.now()/1000)+3600;
 const env={SWISH_APPROVED_JWT_READS:'1',SWISH_APPROVED_DIAGNOSTIC_EVIDENCE:'1',GITHUB_SHA:source,SWISH_ANON_KEY:token({role:'anon'}),SWISH_OWNER_USER_ID:id(1),SWISH_SUBSCRIBER_USER_ID:id(2),SWISH_OWNER_TENANT_ID:id(3),SWISH_SUBSCRIBER_TENANT_ID:id(4),SWISH_FOREIGN_TENANT_ID:id(5),SWISH_OWNER_JWT:token({role:'authenticated',sub:id(1),exp}),SWISH_SUBSCRIBER_JWT:token({role:'authenticated',sub:id(2),exp}),SWISH_SUBSCRIBER_NICHES:'coins'};
 assert.equal(loadJwtFixtureConfig(env).config?.nicheIds.length,13);
 assert.equal(loadJwtFixtureConfig({...env,SWISH_SUBSCRIBER_NICHES:ids.join(',')}).config,null);
});
