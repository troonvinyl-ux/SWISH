import fs from 'node:fs';

const source = fs.readFileSync('app/settings.tsx','utf8');
const handler = source.split('const handleSyncAllFromEbay = useCallback(async () => {')[1]?.split('const resetEbaySync = useCallback(')[0] ?? '';

test('Settings eBay sync no longer hangs in a Settings-only GetItem-per-listing loop',()=>{
 expect(handler.length).toBeGreaterThan(500);
 expect(handler).toContain("runNicheEbayOperation(tenantId,niche,'sync'");
 expect(handler).not.toContain("functions.invoke('swish-ebay-browse'");
 expect(handler).not.toContain("route: 'get_item_full'");
 expect(handler).not.toContain(".from('items').update");
 expect(handler).not.toContain(".from('listings').update");
 expect(handler).not.toContain("setTimeout(");
 expect(handler).toContain('onProgress:progress=>');
});
test('Settings requests only confirmed tenant-and-niche linked eBay count',()=>{
 expect(handler).toContain('resolveProductionNiche(nicheId)');
 expect(handler).toContain('getProductionNicheSpecialistIds(niche)');
 expect(handler).toContain(".select('id,items!inner(tenant_id,specialist_id)',{count:'exact',head:true})");
 expect(handler).toContain(".eq('tenant_id',tenantId).eq('marketplace_id','ebay')");
 expect(handler).toContain(".eq('items.tenant_id',tenantId).in('items.specialist_id',specialists)");
 expect(handler).toContain('if(!isCurrent())return;');
 expect(source).toContain('nicheId={activeNicheId} accessReady={accessReady && !moduleLoading}');
});
test('an uncertain provider outcome is not shown as success or blindly reissued',()=>{
 expect(handler).toContain("if(outcome.error||outcome.data?.success!==true)");
 expect(handler).toContain("state:'error'");
 expect(source).toContain('Last confirmed: {ebaySync.current} of {ebaySync.total}');
 // The button stays hidden in error state; explicit review is required first.
 expect(source).toContain("{ebaySync.state === 'idle' ? (");
 expect(source).toContain("router.push('/ebay-hub' as any)");
 expect(source).toContain("router.push('/ebay-import' as any)");
 expect(source).toContain('Missing eBay listings must be imported separately.');
});
