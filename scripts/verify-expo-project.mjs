import { execFileSync } from 'node:child_process';
import { approvedProject } from './android-release-policy.mjs';
const project = process.env.EXPO_PROJECT_ID || process.env.EAS_PROJECT_ID;
if (project !== approvedProject) throw Error('EXPO_PROJECT_ID must identify the existing owner-approved Expo project');
if (!process.env.EXPO_TOKEN) throw Error('Missing GitHub Secret EXPO_TOKEN; authenticated project ownership/access has not been verified');
const output = execFileSync('npx', ['--yes','eas-cli@27.2.0','project:info'], {encoding:'utf8',maxBuffer:2*1024*1024});
const ids = [...new Set(output.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi) ?? [])];
if (ids.length !== 1 || ids[0] !== approvedProject) throw Error('Authenticated Expo project differs from approved project');
console.log('Authenticated access to the owner-approved existing Expo project verified; account details withheld.');
