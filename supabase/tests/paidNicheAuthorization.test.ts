// Run with: deno test --allow-read --allow-env supabase/tests/paidNicheAuthorization.test.ts
import { requirePaidNiche,NicheAccessError } from '../functions/_shared/paidNicheAuthorization.ts';
function assert(value:unknown,message='Assertion failed'):asserts value { if(!value)throw new Error(message); }
function mockAdmin(member:boolean,tier:string,grant:unknown=null) {
  const calls:string[]=[];
  return { calls,from(table:string){ calls.push(table);const chain:any={ select:()=>chain,eq:()=>chain,gt:()=>chain,maybeSingle:()=>Promise.resolve({ data:table==='tenant_memberships' ? (member ? { id:'membership' } : null) : table==='tenants' ? { subscription_tier:tier } : grant,error:null }) };return chain; },rpc(){ throw new Error('Unexpected cache mutation'); } };
}
Deno.test('Lifetime authorization bypasses Stripe/cache and still requires tenant ownership',async()=>{
  const admin=mockAdmin(true,'lifetime');const result=await requirePaidNiche(admin,{ id:'u' },'00000000-0000-0000-0000-000000000001','trading_cards');
  assert(result.source==='tenant_tier');assert(!admin.calls.includes('niche_entitlements'));
});
Deno.test('Cross-tenant denial occurs before lifetime/cache lookup',async()=>{
  const admin=mockAdmin(false,'lifetime');let caught:unknown=null;
  try { await requirePaidNiche(admin,{ id:'u' },'00000000-0000-0000-0000-000000000001','coins'); }catch(error){ caught=error; }
  assert(caught instanceof NicheAccessError && caught.status===403);assert(!admin.calls.includes('tenants'));
});
Deno.test('Registered verified cache authorizes only after membership',async()=>{
  const admin=mockAdmin(true,'starter',{ expires_at:new Date(Date.now()+1000).toISOString() });
  const result=await requirePaidNiche(admin,{ id:'u' },'00000000-0000-0000-0000-000000000001','tech');assert(result.source==='verified_stripe_cache');
});
Deno.test('Unknown paid-niche identifier does not inherit a Stripe subscription',async()=>{
  const admin=mockAdmin(true,'starter');let caught:unknown=null;
  try { await requirePaidNiche(admin,{ id:'u' },'00000000-0000-0000-0000-000000000001',null); }catch(error){ caught=error; }
  assert(caught instanceof NicheAccessError && caught.status===403);assert(!admin.calls.includes('niche_entitlements'));
});
