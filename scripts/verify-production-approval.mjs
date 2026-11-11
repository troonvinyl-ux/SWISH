import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
export function assertProductionApproval(run, verdict, sha) {
  if(run?.path!=='.github/workflows/production-acceptance-gate.yml'||run.conclusion!=='success'||run.head_branch!=='main'||run.head_sha!==sha||verdict?.sourceSha!==sha||verdict.acceptancePassed!==true||verdict.releaseDecision!=='ELIGIBLE_FOR_OWNER_RELEASE_REVIEW')throw Error('Successful current-source protected production acceptance required');
}
if(process.argv[1]?.endsWith('verify-production-approval.mjs')) {
  if(process.env.SWISH_RELEASE_CHANNEL!=='production-unified') process.exit(0);
  const id=process.env.SWISH_PRODUCTION_ACCEPTANCE_RUN,repo=process.env.GITHUB_REPOSITORY,sha=process.env.GITHUB_SHA;
  if(!/^\d+$/.test(id??'')||!repo||!sha)throw Error('Production requires an explicit protected production acceptance run');
  const run=JSON.parse(execFileSync('gh',['api',`repos/${repo}/actions/runs/${id}`],{encoding:'utf8'}));
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'swish-production-'));
  try {
    execFileSync('gh',['run','download',id,'--repo',repo,'--name',`swish-release-verdict-${sha}`,'--dir',dir]);
    const verdict=JSON.parse(fs.readFileSync(path.join(dir,'release-gate.json'),'utf8'));
    assertProductionApproval(run,verdict,sha);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
}
