import { verifiedSubscriptionNiches,LEGACY_PREMIUM_TIERS,SWISH_SUBSCRIPTION_PRODUCT,type StripeSubscriptionEvidence } from '@/shared/nicheAuthorization';
import modules from '../../niche-modules.json';
import fs from 'fs';
import path from 'path';
const now=1700000000;
const sub=(niche='trading_cards'):StripeSubscriptionEvidence=>({ status:'active',metadata:{ user_id:'owner',niche_id:niche },items:{ data:[{ current_period_end:now+3600,price:{ product:SWISH_SUBSCRIPTION_PRODUCT } }] } });
const niches=Object.keys(modules.products);
describe('Verified account/niche billing evidence',()=>{
  test.each(niches)('%s is supported from verified Stripe evidence',niche=>{ expect([...verifiedSubscriptionNiches([sub(niche)],'owner',niches,now).keys()]).toEqual([niche]); });
  test('one niche never unlocks other products',()=>{ expect(verifiedSubscriptionNiches([sub()],'owner',niches,now).has('coins')).toBe(false); });
  test.each(['canceled','past_due','incomplete','unpaid'])('%s does not grant paid access',status=>{ expect(verifiedSubscriptionNiches([{ ...sub(),status }],'owner',niches,now).size).toBe(0); });
  test('trialing, expanded product objects and Stripe item-level periods are handled',()=>{ const evidence={ ...sub(),status:'trialing',items:{ data:[{ current_period_end:now+10,price:{ product:{ id:SWISH_SUBSCRIPTION_PRODUCT } } }] } };expect(verifiedSubscriptionNiches([evidence],'owner',niches,now).size).toBe(1); });
  test('expiry, ownership mismatch, wrong product and unknown niches fail closed',()=>{
    const expired={ ...sub(),items:{ data:[{ current_period_end:now,price:{ product:SWISH_SUBSCRIPTION_PRODUCT } }] } };
    const mismatch={ ...sub(),metadata:{ user_id:'attacker',niche_id:'trading_cards' } };
    const wrongProduct={ ...sub(),items:{ data:[{ current_period_end:now+100,price:{ product:'other' } }] } };
    for(const evidence of [expired,mismatch,wrongProduct,sub('unknown')]) expect(verifiedSubscriptionNiches([evidence],'owner',niches,now).size).toBe(0);
  });
  test('legacy metadata-free subscriptions are Coins only and lifetime tier remains supported',()=>{ const evidence={ ...sub(),metadata:{} };expect([...verifiedSubscriptionNiches([evidence],'owner',niches,now).keys()]).toEqual(['coins']);expect(LEGACY_PREMIUM_TIERS).toContain('lifetime'); });
});
describe('Source boundary contracts (not substitutes for RLS integration tests)',()=>{
  const read=(file:string)=>fs.readFileSync(path.join(process.cwd(),file),'utf8');
  test('database mapper preserves every registered historical specialist',()=>{ const sql=read('supabase/migrations/20261030_paid_niche_authorization.sql');for(const [niche,config] of Object.entries(modules.products))for(const specialist of [...config.specialists,...config.legacySpecialists])expect(sql).toContain(`('${specialist}','${niche}')`);expect(sql).not.toMatch(/update\s+public\.items\s+set\s+specialist_id/i); });
  test('cache cannot be written by clients; expiry and racing revocations are guarded',()=>{ const sql=read('supabase/migrations/20261030_paid_niche_authorization.sql');expect(sql).toContain('as restrictive for select to authenticated');expect(sql).toContain('pg_advisory_xact_lock');expect(sql).toContain('v_last>=p_checked_at');expect(sql).toContain('from public,anon,authenticated');expect(sql).toContain('expires_at>now()'); });
  test('both specialist APIs use the same paid guard and structured error response',()=>{ const identify=read('supabase/functions/swish-identify/index.ts'),islamic=read('supabase/functions/swish-islamic-identify/index.ts');expect(identify).toContain('return requirePaidNiche(');expect(islamic).toContain('await requirePaidNiche(');expect(islamic).not.toContain("specialist_id: 'islamic_silver',");expect(identify).toContain('nicheAccessResponse(err)'); });
  test('local metrics and diagnostics cannot invoke AI during navigation',()=>{ for(const file of ['services/photoQualityService.ts','services/imageQualityMetrics.ts','services/photoQualityDeviceTests.ts'])expect(read(file)).not.toMatch(/functions\.invoke|chat\/completions/);expect(read('services/aiIdentificationService.ts').indexOf('preflightPhotos([')).toBeLessThan(read('services/aiIdentificationService.ts').indexOf("functions.invoke('swish-identify'")); });
});
