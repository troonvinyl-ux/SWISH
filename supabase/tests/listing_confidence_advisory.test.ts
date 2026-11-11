// Pure policy regressions. No seller writes, authentication bypass or score changes.
import { assessListingConfidence } from '../functions/_shared/listingConfidencePolicy.ts';
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
for (const specialist of ['coins','islamic_silver','banknotes','tech','antiques','collectibles','vinyl_records']) {
 Deno.test(`${specialist}: any AI score is advisory for eBay publication`, () => {
  for (const confidence of [0, 0.3, 0.7, 0.94, 0.95, 1]) {
   const result = assessListingConfidence(specialist, confidence, 'candidate');
   assert(result.allowed, 'An arbitrary AI score blocked a registered seller draft');
   assert(result.confidence === confidence && result.threshold === 0, 'Score was altered or old threshold retained');
  }
 });
}
Deno.test('observation-only is not a seller permission and cannot fabricate certainty', () => {
 const result = assessListingConfidence('coins', 0.2, 'observation_only');
 assert(result.allowed && result.confidence === 0.2 && Boolean(result.advisory), 'Observation disclosure was lost');
 assert(!assessListingConfidence('invented', 1, 'verified').allowed, 'Unregistered ownership was accepted');
});
