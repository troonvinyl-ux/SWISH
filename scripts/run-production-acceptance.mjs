#!/usr/bin/env node
// Automated verification only. Never publish, switch modules, upload photos or mutate production.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const directory=path.resolve('dist/production-acceptance');fs.mkdirSync(directory,{recursive:true});
const git=args=>spawnSync('git',args,{encoding:'utf8',maxBuffer:20*1024*1024});
const head=git(['rev-parse','HEAD']),sourceSha=head.status===0?head.stdout.trim():null;
const results=[];
const run=(id,command,args,timeout=600000)=>{
 const start=Date.now(),result=spawnSync(command,args,{encoding:'utf8',timeout,maxBuffer:20*1024*1024});
 // This job has no provider/session secrets. Retain compiler/test logs, not user/provider payloads.
 const text=((result.stdout??'')+'\n'+(result.stderr??'')).replace(/Bearer\s+\S+/gi,'Bearer [REDACTED]').replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[REDACTED_JWT]');
 fs.writeFileSync(path.join(directory,id+'.log'),text);
 const row={id,sourceSha,result:result.status===0&&!result.error?'PASS':'FAIL',exitCode:result.status,durationMs:Date.now()-start,log:id+'.log'};results.push(row);return row;
};
// Compare ALL existing test files with the PR base or explicit reviewed source. Missing base is blocked.
const base=process.env.SWISH_TEST_BASE_SHA,integrity={id:'test_integrity',sourceSha,result:'BLOCKED',changedExisting:[],removed:[]};
if(/^[a-f0-9]{40}$/i.test(base??'')){
 const diff=git(['diff','--name-status','--no-renames',base,'HEAD','--','services/__tests__','supabase/tests','scripts','jest.config.js','jest.config.ci.js']);
 if(diff.status===0){
  const changes=diff.stdout.trim().split('\n').filter(Boolean).map(line=>line.split('\t')).filter(([,file])=>/\.(test|spec)\.[cm]?[jt]sx?$/.test(file??'')||/jest\.config/.test(file??''));
  integrity.changedExisting=changes.filter(([state])=>state!=='A').map(([,file])=>file);
  integrity.removed=changes.filter(([state])=>state==='D').map(([,file])=>file);
  // Any altered existing assertion/config requires explicit review rather than an automatic weakening heuristic.
  integrity.result=integrity.changedExisting.length?'FAIL':'PASS';
 }
}
results.push(integrity);
run('gate_contract','node',['--test','scripts/production-acceptance-contract.test.mjs','scripts/verify-command-jwt.test.mjs']);
run('typescript','npx',['--no-install','tsc','--noEmit','--pretty','false']);
run('lint','npx',['--no-install','expo','lint']);
const unit=run('unit','npx',['--no-install','jest','--config','jest.config.ci.js','--runInBand','--json','--outputFile='+path.join(directory,'full-jest.json')]);
try{
 const evidence=JSON.parse(fs.readFileSync(path.join(directory,'full-jest.json'),'utf8'));
 unit.tests=evidence.numTotalTests;unit.passed=evidence.numPassedTests;unit.failed=evidence.numFailedTests;unit.pending=evidence.numPendingTests;
 if(!evidence.success||!Number.isInteger(unit.tests)||unit.tests<1||unit.passed!==unit.tests||unit.failed!==0||unit.pending!==0||evidence.numRuntimeErrorTestSuites>0)unit.result='FAIL';
}catch{unit.result='FAIL';unit.reason='NONEMPTY_EXECUTED_JEST_RESULTS_REQUIRED';}
run('edge_assets','node',['scripts/validate-edge-deployment.mjs']);
run('registry_parity','node',['scripts/sync-backend-registry.mjs','--check']);
run('unified_registry','node',['scripts/validate-unified-modules.mjs']);
const functions=fs.readdirSync('supabase/functions',{withFileTypes:true}).filter(entry=>entry.isDirectory()&&entry.name!=='_shared'&&fs.existsSync(`supabase/functions/${entry.name}/index.ts`)).map(entry=>`supabase/functions/${entry.name}/index.ts`);
run('edge_types','deno',['check',...functions]);
const tests=fs.readdirSync('supabase/tests').filter(name=>name.endsWith('.test.ts')).map(name=>'supabase/tests/'+name);
run('edge_tests','deno',['test','--allow-read','--allow-env',...tests]); // No runtime --allow-net, no live provider calls.
run('web_build','npx',['--no-install','expo','export','--platform','web','--output-dir','dist/production-acceptance/web'],1200000);
run('production_build','npx',['--no-install','expo','export','--platform','android','--output-dir','dist/production-acceptance/android-js'],1200000);
const report={schemaVersion:1,sourceSha,checkedAt:new Date().toISOString(),mode:'AUTOMATED_ONLY',results,automatedPassed:results.every(row=>row.result==='PASS'),productionReady:false,notCovered:['real account integration','per-niche 14-step user journeys','capture-to-live speed','native APK installation/signing','live provider calls','hosted/deployed revision','two-subscriber isolation']};
fs.writeFileSync(path.join(directory,'automated.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({automatedPassed:report.automatedPassed,results:results.map(row=>({id:row.id,result:row.result})),productionReady:false}));
if(!report.automatedPassed)process.exitCode=1;
