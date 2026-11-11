import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
const runs=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const build=(Array.isArray(runs)?runs:[runs]).find(row=>row.platform==='IOS' && row.status==='FINISHED');
if(!build?.artifacts?.buildUrl || build.gitCommitHash!==process.env.GITHUB_SHA) throw Error('No completed iOS artifact for the pinned source SHA');
const response=await fetch(build.artifacts.buildUrl);
if(!response.ok) throw Error('iOS artifact download failed');
const bytes=Buffer.from(await response.arrayBuffer());
const ipa='dist/swish-unified.ipa';fs.writeFileSync(ipa,bytes);
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'swish-ios-'));
try {
 execFileSync('unzip',['-q',path.resolve(ipa),'-d',temp]);
 const payload=path.join(temp,'Payload');const app=fs.readdirSync(payload).find(name=>name.endsWith('.app'));
 if(!app) throw Error('No iOS app in IPA');
 const appPath=path.join(payload,app);const plist=path.join(appPath,'Info.plist');
 const bundle=execFileSync('/usr/libexec/PlistBuddy',['-c','Print :CFBundleIdentifier',plist],{encoding:'utf8'}).trim();
 if(!process.env.SWISH_APPROVED_IOS_BUNDLE_ID || bundle!==process.env.SWISH_APPROVED_IOS_BUNDLE_ID) throw Error('iOS bundle identity mismatch');
 execFileSync('codesign',['--verify','--deep','--strict',appPath]);
 let signing='';
 try{signing=execFileSync('codesign',['-dv','--verbose=4',appPath],{encoding:'utf8',stdio:['ignore','pipe','pipe']});}catch(error){throw Error('iOS signature inspection failed');}
 // codesign writes identity details to stderr; query the TeamIdentifier through the signed entitlement instead.
 const entitlements=execFileSync('codesign',['-d','--entitlements',':-',appPath],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 const team=entitlements.match(/<key>com.apple.developer.team-identifier<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
 if(!team || team!==process.env.SWISH_APPROVED_IOS_TEAM_ID) throw Error('Original iOS team identity has not been verified');
 const sha=crypto.createHash('sha256').update(bytes).digest('hex');
 fs.writeFileSync('dist/swish-unified-ipa.sha256',sha+'  swish-unified.ipa\n');
 fs.writeFileSync('dist/unified-ios-evidence.json',JSON.stringify({platform:'ios',buildRunId:process.env.GITHUB_RUN_ID,buildId:build.id,sourceSha:build.gitCommitHash,bundleId:bundle,teamIdentifier:team,runtimeVersion:build.runtimeVersion,channel:typeof build.channel==='string' ? build.channel : build.channel?.name ?? process.env.SWISH_RELEASE_CHANNEL,artifactSha256:sha,binaryVerified:true,deviceAcceptance:'NOT TESTED',createdAt:new Date().toISOString()},null,2));
}finally{fs.rmSync(temp,{recursive:true,force:true});}
