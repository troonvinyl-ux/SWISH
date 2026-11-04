#!/usr/bin/env node
// Read-only reconciliation manifest: no reset, checkout, pull, merge, commit or source overwrite.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const git=(args)=>{const result=spawnSync('git',args,{encoding:'utf8'});if(result.status!==0)throw new Error('Git inspection unavailable');return result.stdout.trim();};
const reference=process.env.SWISH_SOURCE_REFERENCE || 'a8eee534b716a7be172992c3100943b1b6314562';
if(!/^[a-f0-9]{40}$/.test(reference))throw new Error('Pinned source SHA required');
const current=git(['rev-parse','HEAD']);
const worktree=git(['status','--porcelain']);
const changedFiles=git(['diff','--name-status',reference,current]);
const ancestry=spawnSync('git',['merge-base','--is-ancestor',reference,current]);
fs.mkdirSync('dist/completion',{recursive:true});
fs.writeFileSync('dist/completion/source-baseline.json',JSON.stringify({reference,current,referenceIsAncestor:ancestry.status===0,worktree,changedFiles,recordedAt:new Date().toISOString(),sourceSyncVerified:false,meaning:'Differences retained for review. This manifest does not prove every proposed change is correct.'},null,2));
console.log('Read-only source manifest written; no source files overwritten.');
