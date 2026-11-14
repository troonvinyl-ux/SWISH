// Static CI boundary check. Never logs environment values or credentials.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function checkDiscogsSecretBoundary(root=process.cwd()){
 const errors=[];const names=['DISCOGS_CONSUMER_KEY','DISCOGS_CONSUMER_SECRET','DISCOGS_USER_AGENT'];
 function scan(dir){if(!fs.existsSync(dir))return;for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory()){if(['__tests__','__mocks__'].includes(entry.name))continue;scan(file);}else if(/\.(tsx?|js|json)$/.test(file)&&!/\.(?:test|spec)\.(?:tsx?|js)$/.test(file)){const source=fs.readFileSync(file,'utf8');
  if(/(?:process\.env|Deno\.env\.get|import\.meta\.env)[^\n;]*DISCOGS_(?:CONSUMER_KEY|CONSUMER_SECRET|USER_AGENT)/.test(source)||/EXPO_PUBLIC_DISCOGS_/.test(source))errors.push(path.relative(root,file)+': client credential runtime access');
  if(/https:\/\/api\.discogs\.com/.test(source))errors.push(path.relative(root,file)+': direct client provider endpoint');
  if(/from\s+['"][^'"]*supabase\/functions/.test(source))errors.push(path.relative(root,file)+': server code imported into client');
 }}}
 for(const directory of ['app','components','hooks','contexts','services','constants','shared','template'])scan(path.join(root,directory));
 const gateway=path.join(root,'supabase/functions/swish-discogs/index.ts');if(!fs.existsSync(gateway))errors.push('Discogs Edge gateway missing');else{const source=fs.readFileSync(gateway,'utf8');for(const name of names)if(!source.includes(`Deno.env.get('${name}')`))errors.push('Required Edge-only credential read missing: '+name);if(!source.includes('withModuleScope(')||!source.includes("rpc('swish_is_platform_owner')"))errors.push('Catalogue authorization boundary missing');}
 return {errors};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const result=checkDiscogsSecretBoundary();if(result.errors.length){console.error(result.errors.join('\n'));process.exitCode=1;}else console.log('Discogs client credential boundary passed (static only; not provider/JWT acceptance).');}
