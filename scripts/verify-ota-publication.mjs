import fs from 'node:fs';
export function verifyPublication(publication, impact) {
  const updates = Array.isArray(publication) ? publication : publication.updates;
  if(!Array.isArray(updates)||updates.length!==impact.platforms.length)throw Error('Publication receipt must contain exactly the selected platform updates');
  const ids=new Set(),groups=new Set();
  for(const platform of impact.platforms) {
    const row=updates.find(update=>update.platform===platform);
    const baseline=impact.baselines.find(item=>item.platform===platform);
    if(!row||row.gitCommitHash!==impact.targetSha||!/^[a-f0-9-]{36}$/i.test(row.id??'')||ids.has(row.id)||row.runtimeVersion!==baseline?.runtimeVersion||!row.group)throw Error('Published update ID/platform/runtime/group mismatch');
    ids.add(row.id);groups.add(row.group);
  }
  if(groups.size!==1)throw Error('Publication must be one atomic update group');
  return {projectId:impact.projectId,channel:impact.channel,sourceSha:impact.targetSha,baselineRun:impact.baselineRun,publicationRun:process.env.GITHUB_RUN_ID??null,updates:updates.map(({id,group,platform,runtimeVersion})=>({id,group,platform,runtimeVersion})),deviceAcceptance:'NOT TESTED'};
}
if(process.argv[1]?.endsWith('verify-ota-publication.mjs')) {
 const receipt=verifyPublication(JSON.parse(fs.readFileSync('dist/unified-ota-publication.json','utf8')),JSON.parse(fs.readFileSync('dist/unified-ota-impact.json','utf8')));
 fs.writeFileSync('dist/unified-ota-receipt.json',JSON.stringify(receipt,null,2)+'\n');
 console.log('Publication receipt recorded. Download/restart/device acceptance remains NOT TESTED.');
}
