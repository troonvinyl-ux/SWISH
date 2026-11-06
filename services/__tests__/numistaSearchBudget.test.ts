import fs from 'node:fs';
import path from 'node:path';
const source = (file:string) => fs.readFileSync(path.resolve(__dirname,'../..',file),'utf8');
test('image-search gateway makes one bounded paid search and does not replay it',()=>{
  const gateway=source('supabase/functions/_shared/numistaImageSearchService.ts');
  expect(gateway.match(/search_by_image\?lang=en/g)).toHaveLength(1);
  expect(gateway).toContain('AbortSignal.timeout(15_000)');
  expect(gateway).toContain('max_results: NUMISTA_IMAGE_LIMITS.finalists');
  expect(gateway).toContain('No automatic retry was made');
  expect(gateway).not.toMatch(/console\.(log|error)|\.from\(|\.storage\.|\.rpc\(/);
  expect(gateway).toContain("Deno.env.get('NUMISTA_API_KEY')");
  const contract=source('shared/numistaImageSearch.ts');
  expect(contract).toContain('finalists: 8');
  const edge=source('supabase/functions/swish-identify/index.ts');
  expect(edge).toContain('imageCatalogue.length ? 8 : 15');
  expect(edge).toContain('item.candidate._numistaImageRank ? item.candidate');
});
