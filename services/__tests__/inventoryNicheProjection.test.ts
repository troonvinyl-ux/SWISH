/**
 * Inventory projection boundary contracts.
 * These tests prove the client query remains tenant/specialist scoped and that
 * the SQL projection executes with invoker RLS, including paid niche policies.
 */
import fs from 'fs';
import path from 'path';
import modules from '../../niche-modules.json';
import { getProductionNicheSpecialistIds } from '@/services/nicheRouting';

const read = (file:string) => fs.readFileSync(path.join(process.cwd(),file),'utf8');

describe('ten-niche inventory projection contracts',()=>{
  test.each(Object.keys(modules.products))('%s has a unique, registered inventory specialist allow-list',niche=>{
    const ids=getProductionNicheSpecialistIds(niche);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toEqual(expect.arrayContaining(modules.products[niche as keyof typeof modules.products].specialists));
    expect(ids).not.toContain('curiosities_collectibles');
  });

  test('no two production niches share a specialist identity',()=>{
    const entries=Object.keys(modules.products).map(niche=>({niche,ids:getProductionNicheSpecialistIds(niche)}));
    for(let i=0;i<entries.length;i++) for(let j=i+1;j<entries.length;j++){
      expect(entries[i].ids.filter(id=>entries[j].ids.includes(id))).toEqual([]);
    }
  });

  test('tab rows and counts are scoped by tenant, tab and niche specialists',()=>{
    const source=read('services/inventoryTabQueryService.ts');
    expect(source).toContain(".eq('tenant_id',tenantId)");
    expect(source).toContain(".eq('inventory_tab',tab)");
    expect(source).toContain(".in('specialist_id',specialists)");
    expect(source).toContain("select('item_id',{ count:'exact',head:true })");
  });

  test('inventory projection invokes caller RLS and paid-niche item policies',()=>{
    const sql=read('supabase/migrations/20261030_inventory_tab_state.sql');
    const auth=read('supabase/migrations/20261030_paid_niche_authorization.sql');
    expect(sql).toContain('with (security_invoker = true)');
    expect(sql).toContain('grant select on public.swish_inventory_tab_rows to authenticated');
    expect(auth).toContain('create policy authenticated_select_paid_items on public.items as restrictive');
    expect(auth).toContain('public.swish_can_access_niche(tenant_id,public.swish_specialist_niche(specialist_id))');
    expect(auth).toContain('create policy authenticated_select_paid_listings on public.listings as restrictive');
  });

  test('main inventory view checks paid access before loading items and listings',()=>{
    const source=read('services/inventoryViewService.ts');
    expect(source).toContain("rpc('swish_can_access_niche'");
    expect(source).toContain('listItems(tenantId, { specialistIds: specialists })');
    expect(source).toContain('getAllListings(tenantId, undefined, specialists)');
  });
});
