import fs from 'node:fs';
import { parseEbayIdentity, assertVerifiedLegacySeller } from '../../supabase/functions/_shared/ebayAccountPolicy';

test('existing encrypted consent may repair a blank seller name only with an eBay-verified identity',()=>{
 const id=parseEbayIdentity({userId:'eBayUserStable123',username:'real_seller'});
 expect(()=>assertVerifiedLegacySeller(id,'',undefined)).not.toThrow();
 expect(()=>assertVerifiedLegacySeller(id,'real_seller','eBayUserStable123')).not.toThrow();
 expect(()=>assertVerifiedLegacySeller(id,'not_the_linked_seller','eBayUserStable123')).toThrow(/Different eBay account/);
 expect(()=>assertVerifiedLegacySeller(id,'real_seller','different_eBay_id')).toThrow(/Different eBay account/);
 expect(()=>parseEbayIdentity({userId:'',username:'real_seller'})).toThrow(/identity could not be verified/);
});
test('seller name recovery is owner-scoped and never starts new OAuth or silently swaps account',()=>{
 const source=fs.readFileSync('supabase/functions/swish-ebay-oauth/index.ts','utf8');
 expect(source).toContain("if (body.action === 'verify_connected_identity')");
 expect(source).toContain('verifyUserAndTenant(authHeader,tenantId,db,true)');
 expect(source).toContain('identity=await readEbayIdentity(accessToken)');
 expect(source).toContain('assertVerifiedLegacySeller(identity,connector.seller_account_id,creds.ebayUserId)');
 expect(source).toContain(".eq('credential_ref',connector.credential_ref)");
 expect(source).toContain("seller_account_id:identity.username");
 expect(source).toContain('assertVerifiedLegacySeller(verifiedIdentity,connectorRow.seller_account_id,previous.ebayUserId)');
 expect(source).toContain('seller_account_id:        verifiedIdentity.username');
 expect(source).not.toContain("seller_account_id:        sellerAccountId ?? ''");
});
