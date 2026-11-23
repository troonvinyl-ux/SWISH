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

test('seller verification refreshes existing consent rather than making a new OAuth session',()=>{
 const oauth=fs.readFileSync('supabase/functions/swish-ebay-oauth/index.ts','utf8');
 const verify=oauth.split('async function handleVerifyConnectedIdentity(')[1].split('// ════════════════════════════════════════════════════════════════════════════════\n// ACTION: authorize')[0];
 expect(verify).toContain("verifyUserAndTenant(authHeader,tenantId,db,true)");
 expect(verify).toContain("if(!refreshToken||!clientId||!clientSecret)");
 expect(verify).toContain("grant_type:'refresh_token'");
 expect(verify).toContain("access_token_expires_at:expiresAt");
 expect(verify).toContain("identity=await readEbayIdentity(accessToken)");
 expect(verify).toContain("assertVerifiedLegacySeller(identity,connector.seller_account_id,creds.ebayUserId)");
 expect(verify).toContain(".eq('credential_ref',connector.credential_ref)");
 expect(verify).not.toContain("createOAuthSession(");
 expect(verify).not.toContain("start_subscriber_authorization");
 expect(verify).not.toContain("swish_ebay_bindings");
});
