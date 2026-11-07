#!/usr/bin/env node
// Read-only evidence verifier. Current CI failures cannot be overridden by a supplied PASS manifest.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {blankAcceptance,evaluateAcceptance} from './production-acceptance-contract.mjs';
const root=process.cwd(),directory=path.join(root,'dist/production-acceptance');
fs.mkdirSync(directory,{recursive:true});
const git=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'});
const sourceSha=git.status===0?git.stdout.trim():null;
const registry=JSON.parse(fs.readFileSync('niche-modules.json','utf8'));
const nicheIds=Object.keys(registry.products??{});
const insideCheckout=file=>{const absolute=fs.realpathSync(path.resolve(root,file)),relative=path.relative(root,absolute);if(relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Outside checkout');return absolute;};
if(process.argv.includes('--template')){
 fs.writeFileSync(path.join(directory,'operational-template.json'),JSON.stringify(blankAcceptance(sourceSha,nicheIds),null,2));
 console.log('Created NOT_TESTED template; no operational check executed.');
}else{
 let input=blankAcceptance(sourceSha,nicheIds);
 try{
  if(process.env.SWISH_ACCEPTANCE_EVIDENCE_FILE){
   const file=insideCheckout(process.env.SWISH_ACCEPTANCE_EVIDENCE_FILE);
   if(fs.statSync(file).size>1000000)throw new Error('Evidence limit');
   const parsed=JSON.parse(fs.readFileSync(file,'utf8'));
   if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('Invalid manifest');
   input=parsed;
  }
 }catch{/* Invalid input stays blocked; never print private evidence. */}
 for(const row of Array.isArray(input.checks)?input.checks:[]){
  for(const reference of Array.isArray(row?.evidence)?row.evidence:[]){
   if(!reference||typeof reference!=='object'||Array.isArray(reference))continue;
   reference.verified=false;
   try{
    const file=insideCheckout(String(reference.path));
    if(!fs.statSync(file).isFile()||fs.statSync(file).size>20*1024*1024)continue;
    reference.verified=createHash('sha256').update(fs.readFileSync(file)).digest('hex')===reference.sha256;
   }catch{/* Unresolved paths/hashes are never passes. */}
  }
 }
 if(process.env.SWISH_APPROVED_ACCEPTANCE_REVIEW!=='1')input.review={authorized:false,sourceSha:null};
 const report=evaluateAcceptance(input,sourceSha,nicheIds);
 // Independent source/build jobs are authoritative in CI, including failure, cancellation and skips.
 if(process.env.GITHUB_ACTIONS==='true'){
  if(process.env.SWISH_AUTOMATED_RESULT!=='success')report.blockers.push('CURRENT_CI_AUTOMATED_CHECKS_NOT_PASSED');
  if(process.env.SWISH_ANDROID_REQUESTED==='true'&&process.env.SWISH_ANDROID_RESULT!=='success')report.blockers.push('REQUESTED_NATIVE_BUILD_NOT_PASSED');
 }
 report.blockers=[...new Set(report.blockers)];
 report.acceptancePassed=report.blockers.length===0;
 report.releaseDecision=report.acceptancePassed?'ELIGIBLE_FOR_OWNER_RELEASE_REVIEW':'BLOCKED';
 fs.writeFileSync(path.join(directory,'release-gate.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({releaseDecision:report.releaseDecision,acceptancePassed:report.acceptancePassed,blockedChecks:report.checks.filter(row=>row.result!=='PASS').length}));
 if(!report.acceptancePassed)process.exitCode=1;
}
