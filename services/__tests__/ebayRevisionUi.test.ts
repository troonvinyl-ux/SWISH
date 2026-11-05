// Source contracts for shared UI messaging, not installed-device acceptance.
import fs from 'node:fs';
const source=(file:string)=>fs.readFileSync(file,'utf8');
describe('Shared eBay revision feedback and scope safety',()=>{
 test('Save is explicitly local, while revision confirms only live-readback evidence',()=>{
  const editor=source('app/ebay-listing-editor.tsx');
  expect(editor).toContain('Saved in SWISH');
  expect(editor).toContain('live eBay listing is unchanged');
  expect(editor).toContain('seller price were read back');
  expect(editor).toContain('<EbayContentComparison');
 });
 test('overview is honest about saved price and keeps niche-specific details',()=>{
  const overview=source('app/stock-listing/[id].tsx');
  expect(overview).toContain('SWISH saved seller price');
  expect(overview).toContain('<EbayListingLiveCheck');
  expect(overview).toContain('<SpecialistItemFields');
  expect(overview).toContain('<MXConditionGrader');
 });
 test('comparison displays readable descriptions, stale timestamps and buyer-only fees separately',()=>{
  const component=source('components/feature/EbayContentComparison.tsx');
  expect(component).toContain('descriptionText(live.description)');
  expect(component).toContain('Compare description text');
  expect(component).toContain('Buyer Protection fees, postage and buyer taxes');
  expect(component).toContain('previous snapshot is not a guarantee');
  expect(component).not.toContain('getSupabaseClient');
 });
 test('cross-module late snapshots are not shown and concurrent taps are deduplicated',()=>{
  const hook=source('hooks/useEbayLiveContent.ts');
  expect(hook).toContain('moduleEpoch');
  expect(hook).toContain('flight.current === scope');
  expect(hook).toContain('scopeRef.current !== scope');
  expect(hook).toContain('previous.scope === scope');
  const editor=source('hooks/useListingEditor.ts');
  expect(editor).toContain('actionLock.current = true');
  expect(editor).toContain('persistState(snapshot)');
  expect(editor).toContain('triggerInventoryReload()');
 });
});
