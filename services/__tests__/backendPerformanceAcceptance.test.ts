// Evidence integrity only. Passing this file does not certify unexecuted device/provider checks.
import fs from 'node:fs';
const evidence=JSON.parse(fs.readFileSync('docs/SWISH_BACKEND_PERFORMANCE_EVIDENCE.json','utf8'));
function percentile(values:number[],fraction:number){const sorted=[...values].sort((a,b)=>a-b),position=(sorted.length-1)*fraction,left=Math.floor(position),right=Math.ceil(position);return sorted[left]+(sorted[right]-sorted[left])*(position-left);}
test('published SQL median/P90 are calculated from actual retained samples, not estimated network timings',()=>{
 for(const phase of ['before','after']){expect(evidence[phase].samplesMs).toHaveLength(5);expect(evidence[phase].medianMs).toBeCloseTo(percentile(evidence[phase].samplesMs,0.5),4);expect(evidence[phase].p90Ms).toBeCloseTo(percentile(evidence[phase].samplesMs,0.9),4);}
 expect(evidence.measurementType).toContain('not_subscriber_or_network_latency');
});
test('unexecuted acceptance and provider measurements remain explicitly unmeasured',()=>{
 expect(evidence.tests.jest).toBe('not_executed');expect(evidence.tests.authenticatedDeviceAndWeb).toBe('not_executed');
 expect(evidence.tests.liveProviderAfterTimings).toBe('not_executed');expect(evidence.under60SecondsCertified).toBe(false);
 for(const value of Object.values(evidence.afterRuntimePercentiles))expect(value).toBeNull();
});
test('RLS and original canonical record counts survive performance changes',()=>{
 expect(evidence.preservation.canonicalItemsAfter).toBe(evidence.preservation.canonicalItemsBefore);
 expect(evidence.preservation.itemsWithMediaAfter).toBe(evidence.preservation.itemsWithMediaBefore);
 expect(evidence.preservation.countsSecurityInvoker).toBe(true);expect(evidence.preservation.leaseAuthenticatedExecute).toBe(false);
 expect(evidence.preservation.leaseServiceExecute).toBe(true);expect(evidence.indexesAdded).toEqual([]);
});
test('new root visibility handling is SSR-safe and does not alter the mandatory provider hierarchy',()=>{
 const root=fs.readFileSync('app/_layout.tsx','utf8');
 expect(root).toContain("import { AlertProvider, AuthProvider } from '@/template'");
 expect(root.indexOf('<AlertProvider>')).toBeLessThan(root.indexOf('<SafeAreaProvider>'));
 expect(root).toContain("document.addEventListener('visibilitychange',updateVisible)");
 expect(root).toContain("document.removeEventListener('visibilitychange',updateVisible)");
 expect(root.indexOf("const browserVisible=")).toBeGreaterThan(root.indexOf('useEffect(() => {',root.indexOf('export default function RootLayout')));
});
