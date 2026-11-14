// Pure/source regression tests, not real eBay publication or installed-device acceptance.
import fs from 'node:fs';
import { quickListMetrics, type QuickTiming } from '@/shared/quickList';
const session=(seconds:number,outcome:QuickTiming['outcome']='live'):QuickTiming=>({id:`session-${seconds}`,nicheId:'coins',timestamps:{T0:0,T1:120000,T2:122000,T7:120000+seconds*1000},actions:4,barcodeAttempted:false,barcodeMatched:false,aiAttempted:true,aiMatched:true,publicationAttempted:true,outcome,eligible:true,reasons:[],operations:{},externalListingId:'123456789',platform:'android'});
test('scanner KPI excludes time before opening the scanner and preserves legacy app timing',()=>{
 const metrics=quickListMetrics([session(45),session(59),session(61)]);
 expect(metrics.medianMs).toBe(179000);expect(metrics.scannerToLive).toMatchObject({samples:3,medianMs:59000,p90Ms:61000,under60Count:2,under60Pct:66.67});
});
test('under 60 seconds is strict; 60 seconds is not counted as under target',()=>expect(quickListMetrics([session(60)]).scannerToLive.under60Count).toBe(0));
test('draft, failed and acknowledgement-only sessions never pass the target',()=>{
 const metrics=quickListMetrics([session(10,'running'),session(10,'failed'),session(10,'unconfirmed')]);
 expect(metrics.scannerToLive).toMatchObject({samples:0,medianMs:null,p90Ms:null,under60Pct:null});
});
test('legacy sessions without scanner-open or backwards timestamps are not invented samples',()=>{
 const legacy=session(30);delete legacy.timestamps.T1;const reversed=session(20);reversed.timestamps.T1=reversed.timestamps.T7!+1;
 expect(quickListMetrics([legacy,reversed]).scannerToLive.samples).toBe(0);
});
test('UI displays the scanner timer and stops only on reconciled live status',()=>{
 const hook=fs.readFileSync('hooks/useQuickList.ts','utf8'),ui=fs.readFileSync('components/feature/QuickListWorkspace.tsx','utf8');
 expect(hook).toContain('visibleState.timing.timestamps.T7??clock');expect(hook).toContain('visibleState.timing.timestamps.T1');expect(hook).toContain("stamp('T7'");expect(hook).toContain('row.timestamps[stage]==null');expect(ui).toContain('seconds}s / 60s');
});
test('manual cleanup remains a per-photo opt-in; Next and List now remain the main flow',()=>{
 const hook=fs.readFileSync('hooks/useQuickList.ts','utf8'),ui=fs.readFileSync('components/feature/QuickListWorkspace.tsx','utf8');
 expect(hook).toContain('!shouldAutoRemoveBackground(nicheId)');expect(hook).toContain('nicheId,manual:true');expect(ui).toContain('BG-remove');expect(ui).toContain('<BarcodeProductConfirmation');expect(fs.readFileSync('hooks/useBarcodeConfirmation.ts','utf8')).toContain("pathname: '/ebay-listing-editor'");expect(ui).toContain("'Next'");expect(fs.readFileSync('app/ebay-listing-editor.tsx','utf8')).toContain("?'Revise on eBay':'List now'");
 const bridge=fs.readFileSync('hooks/useListingQuickSession.ts','utf8');expect(bridge).toContain('confirmQuickLive');expect(bridge).toContain("mark(ticket, 'T7'");expect(bridge).toContain('row.timestamps[stage] == null');expect(bridge).not.toContain("mark(ticket, 'T1'");
});
