import fs from 'node:fs';
import path from 'node:path';
const read=(file:string)=>fs.readFileSync(path.resolve(__dirname,'../..',file),'utf8');

describe('Master Minority Report presentation and count contract',()=>{
 test('portfolio distinguishes physical items from marketplace listing counts',()=>{
  const component=read('components/feature/CommandPortfolio.tsx');
  expect(component).toContain('label="Unique items"');
  expect(component).toContain('label="Live eBay listings"');
  expect(component).toContain('label="Draft listings"');
  expect(component).not.toContain('Inventory records');
 });
 test('primary report stays concise and operational detail is explicitly collapsible',()=>{
  const component=read('components/feature/CommandPortfolio.tsx');
  expect(component).toContain('Show operational detail');
  expect(component).toContain('Hide operational detail');
  expect(component).toContain('accessibilityState={{expanded:showDetails}}');
  expect(component).toContain('Open ${NICHE_MODULES[id].name} workspace');
  expect(component).not.toContain('CANONICAL WORKSPACE');
 });
 test('portfolio aggregates unique external listing identities and one draft per physical item',()=>{
  const migration=read('supabase/migrations/20261106_140000_command_report_distinct_listings.sql');
  expect(migration).toContain('distinct on (l.tenant_id,l.external_listing_id)');
  expect(migration).toContain('distinct on (l.tenant_id,l.item_id)');
  expect(migration).toContain('left join draft_stats d on d.niche=n.id');
  expect(migration).toContain('coalesce(d.drafts,0) as drafts');
  expect(migration).toContain('security definer');
  expect(migration).toContain('revoke all on function public.swish_command_snapshot');
 });
});
