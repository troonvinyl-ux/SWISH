// Source contracts only. This suite does not claim UI timing, device acceptance,
// real product accuracy, provider availability or production certification.
import fs from 'node:fs';
const read=(file:string)=>fs.readFileSync(file,'utf8');

test('AppContext keeps its invalidation action and published value stable',()=>{
 const source=read('contexts/AppContext.tsx');
 expect(source).toContain('const triggerInventoryReload=useCallback(()=>setReloadSignal(v=>v+1),[])');
 expect(source).toContain('useMemo<AppContextType>');
 expect(source).toContain('value={value}');
 expect(source).toContain('inventoryReloadSignal,triggerInventoryReload');
 for(const guard of ['verificationMaxAge','activateModuleScope(account.id, id)','userRef.current===uid','setEpoch(v=>v+1)'])expect(source).toContain(guard);
});
test('Minority Report does not fetch GitHub acceptance detail on portfolio mount',()=>{
 const source=read('components/feature/CommandPortfolio.tsx');
 expect(source).not.toContain('useProductionControl');
 expect(source).toContain('Evidence & scope');
 expect(source).toContain('modules.get(id)');
 expect(source).not.toContain('state.modules.find');
 expect(source).toContain('state.snapshot?.activity');
 expect(source).toContain('formatCommandMoney');
});
test('Quick List hides stale scoped state and fences post-review auto publication',()=>{
 const source=read('hooks/useQuickList.ts');
 expect(source).toContain('scope&&state.scope===scope?state:emptyState');
 expect(source).toContain('state:visibleState');
 const review=source.split('const confirm=useCallback')[1].split('const checkLive=')[0];
 expect(source).toContain('scopeRef.current===scope');
 expect(review).toContain('if(!validFor(version))return;if(publishAfterReview)');
 expect(review).toContain('if(validFor(version)){operation.current=false;patch({processing:false,phase:\'\'});}');
 const recovery=source.split('const checkLive=useCallback')[1].split('const toggleAuto=')[0];
 expect(recovery).toContain('if(!validFor(version))return;const id=');
 expect(recovery).toContain('if(validFor(version))');
 expect(source).toContain('state.scope!==scope');
});
test('valuation reads item media once and starts independent discovery before AI waits',()=>{
 const source=read('supabase/functions/swish-market-value/index.ts');
 const handler=source.split("withEdgeFunctionLogging('swish-market-value', async")[1];
 expect(handler).toBeDefined();
 expect(handler.match(/select\('media, specialist_id'\)/g)).toHaveLength(1);
 expect(handler).not.toContain("select('specialist_id')");
 expect(handler.indexOf("select('media, specialist_id')")).toBeLessThan(handler.indexOf('await getAndRefreshConnectorCreds'));
 expect(handler.indexOf('const visualPromise=')).toBeLessThan(handler.indexOf('const [gemini, appToken] = await Promise.all'));
 expect(handler.indexOf('const canoaPromise=')).toBeLessThan(handler.indexOf('const [gemini, appToken] = await Promise.all'));
 for(const guard of ['requirePaidNiche','specialistNiche(owned.specialist_id) !== requestedNiche','itemProduct !== requestedProduct','valuation.insufficientSoldEvidence'])expect(source).toContain(guard);
 expect(source).toContain("model: 'google/gemini-2.5-flash'");
});
test('canonical Collectibles receives the existing evidence prompt without registering the legacy catch-all',()=>{
 expect(read('supabase/functions/swish-identify/index.ts')).toContain('SPECIALIST_SYSTEM_PROMPTS.collectibles = SPECIALIST_SYSTEM_PROMPTS.curiosities_collectibles');
 const registry=JSON.parse(read('niche-modules.json'));
 expect(registry.products.collectibles.specialists).toEqual(['collectibles']);
 expect(JSON.parse(read('supabase/functions/_shared/niche-modules.json'))).toEqual(registry);
});
