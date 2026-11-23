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

test('OAuth entrypoint boots against older OnSpace policy snapshots missing named legacy-seller export',()=>{
 const source=fs.readFileSync('supabase/functions/swish-ebay-oauth/index.ts','utf8');
 expect(source).toContain("import * as ebayAccountPolicy from '../_shared/ebayAccountPolicy.ts'");
 expect(source).not.toContain("import { assertVerifiedLegacySeller } from '../_shared/ebayAccountPolicy.ts'");
 expect(source).toContain("typeof ebayAccountPolicy.assertVerifiedLegacySeller === 'function'");
 expect(source).toContain("ebayAccountPolicy.assertVerifiedLegacySeller(identity,savedSeller,savedUserId)");
 // The compatibility path must fail closed for an unverified identity or a
 // different linked stable account; it is never an account-switch override.
 expect(source).toContain("if(!verifiedId||!verifiedName||verifiedId.length>256||verifiedName.length>256)");
 expect(source).toContain("previousId&&previousId!==verifiedId");
 expect(source).toContain("previousSeller&&previousSeller!==verifiedName&&previousSeller!==verifiedId");
 expect(source).toContain("assertVerifiedLegacySeller(identity,connector.seller_account_id,creds.ebayUserId)");
 expect(source).toContain("assertVerifiedLegacySeller(verifiedIdentity,connectorRow.seller_account_id,previous.ebayUserId)");
});

test('first-use eBay login is fresh and links only the signed-in SWISH member',()=>{
 const oauth=fs.readFileSync('supabase/functions/swish-ebay-oauth/index.ts','utf8');
 expect(oauth).toContain("prompt:        'login'");
 expect(oauth).toContain("swishMemberUserId: memberUserId");
 expect(oauth).toContain("swishTenantId: tenantId");
 expect(oauth).toContain("verify.userId!");
 expect(oauth).toContain("credentials.swishTenantId!==tenantId");
 expect(oauth).toContain(".eq('user_id',memberUserId).maybeSingle()");
 expect(oauth).toContain("persistVerifiedMemberBinding(supabase,tenantId,memberUserId,verifiedIdentity");
 expect(oauth).toContain(".from('swish_ebay_bindings')");
 expect(oauth).toContain(".eq('user_id',userId)");
 expect(oauth).toContain("bindingId,userId,tenantId,ebayUserId:identity.userId");
 expect(oauth).toContain("existing.ebay_account_id!==identity.userId");
 expect(oauth).toContain("if(!matchesLegacy)return htmlResponse(successPage())");
 expect(oauth).toContain("if (body.action === 'member_binding_status')");
 expect(oauth).toContain("verifyUserAndTenant(authHeader,tenantId,db)");
 expect(oauth).not.toContain("memberUserId=req.headers.get('x-swish-user')");
});

test('new member consent must not overwrite an unidentified shared tenant eBay account',()=>{
 const source=fs.readFileSync('supabase/functions/swish-ebay-oauth/index.ts','utf8');
 expect(source).toContain("if(typeof previous.ebayUserId==='string'&&previous.ebayUserId.trim())");
 expect(source).toContain("assertVerifiedLegacySeller(verifiedIdentity,connectorRow.seller_account_id,previous.ebayUserId)");
 expect(source).toContain("if(!matchesLegacy)return htmlResponse(successPage())");
 expect(source).toContain("persistVerifiedMemberBinding(supabase,tenantId,memberUserId,verifiedIdentity");
});

test('verified seller re-import fills existing coin and listing ownership, never relists',()=>{
 const sql=fs.readFileSync('supabase/migrations/20261123_verified_ebay_reimport_binding_repair.sql','utf8');
 const browse=fs.readFileSync('supabase/functions/swish-ebay-browse/index.ts','utf8');
 const native=fs.readFileSync('services/ebayInventoryImportService.ts','utf8');
 const nativeUi=fs.readFileSync('app/ebay-import.tsx','utf8');
 expect(sql).toContain("auth.role() is distinct from 'service_role'");
 expect(sql).toContain("v_binding public.swish_ebay_bindings%rowtype");
 expect(sql).toContain("btrim(l.external_listing_id)=v_external");
 expect(sql).toContain("v_count<>1");
 expect(sql).toContain("v_item.ebay_binding_id is not null and v_item.ebay_binding_id<>v_binding.id");
 expect(sql).toContain("v_listing.ebay_binding_id is not null and v_listing.ebay_binding_id<>v_binding.id");
 expect(sql).toContain("ebay_binding_id=v_binding.id,");
 expect(sql).toContain("ebay_account_id=v_binding.ebay_account_id,ebay_member_id=p_user_id");
 expect(sql).not.toMatch(/delete from public\.(items|listings)|insert into public\.(items|listings)/i);
 expect(sql).not.toMatch(/update public\.(items|listings) set (status|price|media|published_at)/i);
 expect(browse).toContain("route==='repair_seller_links'");
 expect(browse).toContain("prepareMemberBinding(userId,tenantId)");
 expect(browse).toContain("readEbayIdentity(token)");
 expect(browse).toContain("verified.userId!==member.ebay_account_id");
 expect(browse).toContain("method=single?'GetItem':'GetMyeBaySelling'");
 expect(browse).toContain("seller.trim().toLowerCase()!==verified.username.toLowerCase()");
 expect(browse).toContain("swish_repair_verified_ebay_import");
 expect(native).toContain("repairVerifiedNativeEbayLinks");
 expect(native).toContain("externalListingId:externalId.trim()");
 expect(nativeUi).toContain("Re-import & Repair eBay Links");
});
