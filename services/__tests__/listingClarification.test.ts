import fs from 'node:fs';
import { identificationPublicationAdvice, listingClarification } from '@/shared/listingClarification';
import { getNicheWorkflowPolicy } from '@/shared/nichePolicy';
test('coin publication has no AI percentage requirement; Quick List review is unchanged', () => {
 expect(getNicheWorkflowPolicy('coins')).toMatchObject({publicationMinimum:0,quickReviewMinimum:0.95});
 const source=fs.readFileSync('supabase/functions/_shared/listingConfidencePolicy.ts','utf8');
 expect(source).not.toContain('COIN_CONFIDENCE_BELOW_THRESHOLD');
 expect(source).toContain('allowed: true');
 expect(source).not.toContain("state === 'observation_only') {\n    return");
});
test('asks the exact missing field, not for a higher score', () => {
 const help=listingClarification({error:'Complete required item specific: Year.'});
 expect(help).toMatchObject({target:'specifics',fields:['Year']});
 expect(help.question).toContain('correct Year');
 expect(listingClarification({error:'Missing fields',missingRequiredAspects:['Year','Country/Region of Manufacture']}).fields).toEqual(['Year','Country/Region of Manufacture']);
 expect(listingClarification({error:'Choose an eBay-supported value for Grade.'})).toMatchObject({target:'specifics',fields:['Grade']});
});
test.each([
 ['Choose a supported eBay condition that matches this item.','condition'],
 ['Use a meaningful eBay title of 3–80 characters.','title'],
 ['A factual item description is required.','description'],
 ['Choose a positive listing price.','pricing'],
 ['Selected specialist category is not a verified current eBay leaf. Nothing submitted.','category'],
 ['Original photo persistence is incomplete. Retry photos.','photos'],
 ['Your eBay return policy has not been selected.','policies'],
 ['eBay authorisation could not be refreshed. Please reconnect eBay.','connection'],
 ['eBay Taxonomy API error (503): service unavailable','retry'],
 ['Review the exact music release/pressing before listing.','safety'],
])('guidance routes %s to %s', (error,target) => expect(listingClarification({error}).target).toBe(target));
test('uncertain submission has priority over any suggested form edit', () => {
 expect(listingClarification({error:'Invalid price',accepted:true}).target).toBe('status');
 expect(listingClarification({error:'Request timeout',publicationUnconfirmed:true}).target).toBe('status');
});
test('specific eBay response is preserved, and unknown errors do not invent missing facts', () => {
 const error='eBay error 219XXXXX: account review pending.';
 const help=listingClarification({error});expect(help.detail).toBe(error);expect(help.fields).toEqual([]);expect(help.target).toBe('retry');
});
test('identification advice reuses actual evidence questions without raising the score', () => {
 const advice=identificationPublicationAdvice(0.71,'candidate',{_specialist_analysis:{followUps:[{question:'What is the literal reverse inscription?'}]}});
 expect(advice).toEqual({confidence:0.71,questions:['What is the literal reverse inscription?']});
 expect(identificationPublicationAdvice(0.99,'verified',{})).toBeNull();
});
test('client and deployment guidance are identical and advisory verification cannot mutate draft lifecycle', () => {
 expect(fs.readFileSync('shared/listingClarification.ts','utf8')).toBe(fs.readFileSync('supabase/functions/_shared/listingClarification.ts','utf8'));
 const verifier=fs.readFileSync('services/verificationService.ts','utf8');
 const ordinary=verifier.slice(verifier.indexOf('export async function verifyListing('),verifier.indexOf('export async function getLatestVerification('));
 expect(ordinary).not.toContain("update({ status: 'needs_correction'");expect(ordinary).not.toContain("update({ status: 'verified'");
 const ui=fs.readFileSync('app/ebay-listing-editor.tsx','utf8');expect(ui).toContain('<ListingPublishHelp');expect(ui).toContain('resolvePublishHelp');
});
