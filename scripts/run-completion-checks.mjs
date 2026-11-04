#!/usr/bin/env node
// Execute independent automated gates and retain evidence; never fabricate E2E completion.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const directory=path.resolve('dist/completion'); fs.mkdirSync(directory,{recursive:true});
const registry=JSON.parse(fs.readFileSync('niche-modules.json','utf8'));
const git=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'});
const commit=git.status===0?git.stdout.trim():null;
const gates=[['foundation','node',['scripts/validate-foundation.mjs']],['register','node',['scripts/validate-production-register.mjs']],['typescript','npx',['tsc','--noEmit','--pretty','false']],['lint','pnpm',['lint']],['regression','npx',['--yes','jest@29.7.0','--config','jest.config.ci.js','--runInBand']],['edge-deployment-assets','node',['scripts/validate-edge-deployment.mjs']]];
for(const niche of Object.keys(registry.products)) gates.push([niche+'-routes','node',['scripts/prepare-niche-routes.js'],niche],[niche+'-closure','node',['scripts/verify-niche-module.js'],niche]);
const results=[];
const redact=text=>String(text??'').replace(/Bearer\s+\S+/gi,'Bearer [REDACTED]').replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[REDACTED_JWT]');
for(const [id,command,args,niche] of gates){
 const started=Date.now(); const env={...process.env};
 if(niche) env.SWISH_NICHE=niche; else delete env.SWISH_NICHE;
 const run=spawnSync(command,args,{encoding:'utf8',env,maxBuffer:20*1024*1024,timeout:600000});
 const log=redact((run.stdout??'')+'\n'+(run.stderr??'')+(run.error?'\n'+run.error.message:''));
 fs.writeFileSync(path.join(directory,id+'.log'),log);
 const record={id,command:[command,...args],niche:niche??'shared',exitCode:run.status,durationMs:Date.now()-started,status:run.status===0?'PASSED':'FAILED',log:id+'.log'};
 results.push(record); console.log(id+': '+record.status);
}
fs.writeFileSync(path.join(directory,'automated-evidence.json'),JSON.stringify({commit,recordedAt:new Date().toISOString(),results,productionReady:false,scope:'Automated source gates only. No seller actions, native installation or hosted web acceptance.'},null,2));
if(results.some(result=>result.status!=='PASSED')) process.exitCode=1;
