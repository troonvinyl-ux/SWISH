#!/usr/bin/env node
// Reuse the owner's existing persistent keystore. Never create or rotate a key.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {approvedCertificate,normalizeCertificate} from './android-release-policy.mjs';
for(const key of ['SWISH_RELEASE_KEYSTORE_BASE64','SWISH_KEYSTORE_STORE_PASSWORD','SWISH_KEYSTORE_KEY_PASSWORD','SWISH_KEYSTORE_KEY_ALIAS','SWISH_RELEASE_CERT_SHA256']) {
 if(!process.env[key]) throw new Error('Missing existing release configuration: '+key);
}
const keyBytes=Buffer.from(process.env.SWISH_RELEASE_KEYSTORE_BASE64,'base64');
if(!keyBytes.length) throw new Error('Release keystore is empty');
fs.writeFileSync('android/app/swish-release.keystore',keyBytes,{mode:0o600});
const expected=approvedCertificate(process.env.SWISH_RELEASE_CHANNEL,process.env.SWISH_RELEASE_CERT_SHA256);
const certificate=execFileSync('keytool',['-exportcert','-keystore','android/app/swish-release.keystore','-storepass:env','SWISH_KEYSTORE_STORE_PASSWORD','-alias',process.env.SWISH_KEYSTORE_KEY_ALIAS]);
const {createHash}=await import('node:crypto');
if(createHash('sha256').update(certificate).digest('hex')!==normalizeCertificate(expected))throw Error('Keystore certificate does not match approved original identity');
const file='android/app/build.gradle'; let text=fs.readFileSync(file,'utf8');
if(!text.includes('signingConfigs {')) throw new Error('Generated Android signing configuration not found');
text=text.replace('signingConfigs {',`signingConfigs {
        swishRelease {
            storeFile file('swish-release.keystore')
            storePassword System.getenv('SWISH_KEYSTORE_STORE_PASSWORD')
            keyAlias System.getenv('SWISH_KEYSTORE_KEY_ALIAS')
            keyPassword System.getenv('SWISH_KEYSTORE_KEY_PASSWORD')
        }`);
const types=text.indexOf('buildTypes {'); const start=text.indexOf('release {',types);
if(types<0||start<0) throw new Error('Release build type missing');
const open=text.indexOf('{',start); let depth=1; let end=open+1;
while(end<text.length&&depth){if(text[end]==='{')depth++;if(text[end]==='}')depth--;end++;}
if(depth) throw new Error('Unbalanced release Gradle block');
let block=text.slice(open+1,end-1);
block=block.replace(/signingConfig\s+signingConfigs\.\w+/g,'');
block+='\n            signingConfig signingConfigs.swishRelease\n';
text=text.slice(0,open+1)+block+text.slice(end-1);
fs.writeFileSync(file,text);
console.log('Persistent signing configured; secrets withheld. Certificate verification is mandatory after compilation.');
