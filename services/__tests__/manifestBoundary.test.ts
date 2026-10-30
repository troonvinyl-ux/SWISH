import fs from 'node:fs';
import path from 'node:path';
const source=(file:string)=>fs.readFileSync(path.resolve(__dirname,'../..',file),'utf8');
describe('Manifest import source contracts (not runtime integration)',()=>{
  test('intake retains RLS and explicit paid tenant permission',()=>{const sql=source('supabase/migrations/20261030_manifest_lot_import.sql');expect(sql).toContain('security invoker');expect(sql).toContain('swish_can_access_niche(p_tenant_id,p_niche_id)');expect(sql).toContain('swish_specialist_niche(v_specialist) is distinct from p_niche_id');expect(sql).toContain('from public,anon');});
  test('retries lock the same manifest and reopen canonical records',()=>{const sql=source('supabase/migrations/20261030_manifest_lot_import.sql');expect(sql).toContain('pg_advisory_xact_lock');expect(sql).toContain("'existing',true");expect(sql).toContain('i.acquisition_id=v_acquisition');});
  test('all newly compiled listings are draft only; no marketplace calls',()=>{const sql=source('supabase/migrations/20261030_manifest_lot_import.sql');expect(sql).toContain("'draft') returning id");expect(sql).not.toContain("'active'");expect(source('services/manifestListingService.ts')).not.toContain('submitListingToMarketplace');});
  test('new manifest draft review gate exists at the actual eBay publish boundary',()=>{expect(source('supabase/functions/swish-ebay-list/index.ts')).toContain('MANIFEST_REVIEW_REQUIRED');});
  test('root owns the shared session provider',()=>{expect(source('app/_layout.tsx')).toContain('<ManifestOpportunityProvider>');});
  test('XLSX dependency/file reads are lazy on navigation',()=>{expect(source('hooks/useManifestOpportunity.ts')).toContain("await import('@/services/manifestFileService')");expect(source('contexts/ManifestOpportunityContext.tsx')).not.toContain('generateListing(');});
});
