import {execFileSync} from 'node:child_process';
export function assertOwnerReviewEnvironment(environment, owner) {
  const rule=environment?.protection_rules?.find(row=>row.type==='required_reviewers');
  if(!rule?.reviewers?.some(row=>row.type==='User'&&row.reviewer?.login===owner))throw Error('Configure the repository owner as a required reviewer of swish-ota-approval before publishing');
}
if(process.argv[1]?.endsWith('verify-ota-owner-approval.mjs')) {
 const repo=process.env.GITHUB_REPOSITORY;
 if(!repo)throw Error('GitHub repository required');
 const environment=JSON.parse(execFileSync('gh',['api',`repos/${repo}/environments/swish-ota-approval`],{encoding:'utf8'}));
 assertOwnerReviewEnvironment(environment,repo.split('/')[0]);
 console.log('Owner-review environment protection confirmed; this job runs only after GitHub environment approval.');
}
