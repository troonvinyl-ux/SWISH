import { assertEquals, assertStringIncludes } from 'jsr:@std/assert';
import { guardStampIdentification } from '../functions/_shared/stampIdentification.ts';
import { stampComparableIssue } from '../functions/_shared/stampMarket.ts';
Deno.test('stamp guard refuses provider-only catalogue and hidden measurement certainty',()=>{
 const result=guardStampIdentification({canonicalTitle:'Stamp SG 10 MNH',condition:'MNH',identificationState:'verified',attributes:{sg_number:'10',perforation:'14'},attributesConfirmed:{perforation:'14'}});
 assertEquals(result.identificationState,'candidate');assertEquals(result.attributesConfirmed.perforation,undefined);assertEquals(result.attributes.catalogue_status,'unverified');assertEquals(result.valuationMid,0);assertStringIncludes(result.canonicalTitle,'gum not checked');
});
Deno.test('stamp market relevance rejects incompatible gum and lot format',()=>{
 assertEquals(stampComparableIssue('GB Penny Black used stamp',{country:'Great Britain',issue_name:'Penny Black',usage:'Used',format:'Single'}),null);
 assertEquals(stampComparableIssue('GB Penny Red used stamp',{issue_name:'Penny Black'}),'Different or unestablished issue design');
 assertEquals(stampComparableIssue('Stamp used',{format:'Album collection lot'}),'Single-versus-lot sale unit mismatch');
});
