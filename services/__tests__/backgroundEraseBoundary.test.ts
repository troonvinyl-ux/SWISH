// Static security/wiring checks only; no provider keys, paid requests or device acceptance.
import fs from 'node:fs';
import { processCoinImage } from '../coinImageProcessing';
const read=(path:string)=>fs.readFileSync(path,'utf8');
test('client has no provider endpoint, secret name, header or Edge imports',()=>{
 const folders=['app','components','hooks','contexts','services','constants','shared','template','plugins'];
 function visit(path:string):string[]{return fs.readdirSync(path,{withFileTypes:true}).flatMap(entry=>{if(entry.name==='__tests__'||entry.name==='__mocks__')return [];const file=`${path}/${entry.name}`;return entry.isDirectory()?visit(file):/\.(tsx?|js|json)$/.test(file)?[file]:[];});}
 for(const file of [...folders.flatMap(visit),'app.config.js','app.json'])expect(read(file)).not.toMatch(/BACKGROUND_ERASE_API_KEY|EXPO_PUBLIC_BACKGROUND|api\.backgrounderase\.com|supabase\/functions\//);
});
test('BackgroundErase is the only production image processor and does not log raw provider payloads',()=>{
 const engine=read('supabase/functions/_shared/smartStudioEngine.ts'),gateway=read('supabase/functions/_shared/backgroundEraseService.ts');
 expect(engine).toContain('removeBackgroundBytes(input');expect(engine).not.toMatch(/aiRequest|studioEditPrompt|chat\/completions|renderStudio\(/);
 expect(gateway).toContain("Deno.env.get('BACKGROUND_ERASE_API_KEY')");expect(gateway).toContain("headers:{'x-api-key':apiKey}");expect(gateway).toContain("redirect:'error'");expect(gateway).not.toContain('response.text()');
 expect(read('services/sharedImagePreparationService.ts')).toContain("functions.invoke('swish-coin-image-enhance'");
});
test('original framing tool no longer re-encodes photos',async()=>{
 const result=await processCoinImage('file://source.jpg','enhance');expect(result.uri).toBe('file://source.jpg');expect(read('services/coinImageProcessing.ts')).not.toContain('expo-image-manipulator');
});
test('advisory review precedes provider spending; failed attempts are not silently replayed on save',()=>{
 const client=read('services/aiIdentificationService.ts');expect(client.indexOf('await preflightPhotos([')).toBeLessThan(client.indexOf('await prepareCapturedImages(images, {'));
 expect(read('services/sharedImagePreparationService.ts')).toContain('image.studio?.version===SMART_STUDIO_VERSION&&image.studio.originalUri===image.uri');
 expect(client).toContain('Object.assign(images[index],image)');
});
test('studio PNGs are server-written and existing originals remain canonical',()=>{
 const edge=read('supabase/functions/swish-coin-image-enhance/index.ts'),migration=read('supabase/migrations/20261110_backgrounderase_server_pipeline.sql');
 expect(edge).toContain('serveModule(');expect(edge).toContain('admin.storage');expect(edge).toContain('upsert:false');expect(edge).toContain('attachStudioMetadata(output.image,result)');
 expect(migration).toContain("array['anon','authenticated']");expect(migration).toContain("array['insert','update','delete']");expect(migration).toContain('as restrictive');expect(migration).not.toMatch(/update public\.items|delete from|disable row level security/i);
 expect(read('shared/smartStudio.ts')).toBe(read('supabase/functions/_shared/smartStudio.ts'));
});
