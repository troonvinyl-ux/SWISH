jest.mock('@/template',()=>({getSupabaseClient:jest.fn()}));
import fs from 'node:fs';
import path from 'node:path';
import { getSupabaseClient } from '@/template';
import { normaliseAuctionUrl,validAuctionUrl,ebaySoldSearchUrl } from '@/services/auctionLinkService';
import { calculateLotBasePrice } from '@/services/lotBasePriceService';
import { suggestLotBid } from '@/services/lotBiddingService';
import { simpleLotAdvice } from '@/services/lotSimpleAdviceService';
import { parseManifestSoldResult,searchManifestSold } from '@/services/manifestSoldService';
const source=(file:string)=>fs.readFileSync(path.resolve(__dirname,'../..',file),'utf8');
const base=()=>calculateLotBasePrice({manifestRrp:10000,eligibleRrp:10000,inbound:100,currentBid:500,premiumRate:0,vatRate:0});
const bid=()=>suggestLotBid({ceiling:base().maximumHammerBid,currentBid:500,increment:1,bidCount:3,minutesLeft:2});
const sale=()=>({id:'sale-1',title:'Example model',price:40,currency:'GBP',soldDate:'2026-10-01T12:00:00Z',condition:'Used',url:'https://www.ebay.co.uk/itm/123',imageUrl:''});
describe('Validated optional auction links',()=>{
  test('normalises HTTPS host while retaining auction path, query and fragment',()=>expect(normaliseAuctionUrl(' HTTPS://Jobalots.com/lot/123?x=2#bid ')).toBe('https://jobalots.com/lot/123?x=2#bid'));
  test.each(['','  ',null,undefined])('blank %s is optional',value=>expect(normaliseAuctionUrl(value)).toBe(''));
  test.each(['http://example.com','javascript:alert(1)','onspaceapp://auth','https://user:secret@example.com','https://localhost/a','https://127.0.0.1/a','https://example.com\\evil','https://example.com/a b','https://example.com:99999','https://example.com/%xy'])('rejects unsafe or malformed link %s',value=>{expect(()=>normaliseAuctionUrl(value)).toThrow();expect(validAuctionUrl(value)).toBe(false);});
  test('sold search is an encoded browser search, not an API sale result',()=>expect(ebaySoldSearchUrl('camera & lamp')).toContain('_nkw=camera%20%26%20lamp&LH_Sold=1&LH_Complete=1'));
  test('all platform opening uses validation before Linking.openURL',()=>{const hook=source('hooks/useAuctionLink.ts');expect(hook.indexOf('normaliseAuctionUrl(value)')).toBeLessThan(hook.indexOf('Linking.openURL(url)'));});
});
describe('One SWISH bid and profit',()=>{
  test('£10,000 retail, £100 delivery, next bid £501 = £3,399 before selling costs',()=>{const plan=simpleLotAdvice(base(),bid());expect(plan.suggestedBid).toBe(501);expect(plan.profit).toBe(3399);expect(plan.referenceBid).toBe(501);expect(plan.suggestedBid).toBeLessThan(base().maximumHammerBid);});
  test('delivery and buyer charges are deducted once',()=>{const b=calculateLotBasePrice({manifestRrp:10000,eligibleRrp:10000,inbound:100,currentBid:500,premiumRate:.2,vatRate:.2});const plan=simpleLotAdvice(b,{...bid(),suggestedBid:501});expect(plan.profit).toBeCloseTo(4000-501*1.44-100,2);});
  test('no current bid gives a labelled ceiling scenario, not an invented opening bid',()=>{const advice=suggestLotBid({ceiling:base().maximumHammerBid,currentBid:null,increment:1,bidCount:null,minutesLeft:null});const plan=simpleLotAdvice(base(),advice);expect(plan.suggestedBid).toBeNull();expect(plan.profitLabel).toBe('Profit at the ceiling');});
  test('waiting shows a lower bid for later, never the whole ceiling',()=>{const advice=suggestLotBid({ceiling:base().maximumHammerBid,currentBid:500,increment:1,bidCount:12,minutesLeft:60});expect(simpleLotAdvice(base(),advice).suggestedBid).toBe(501);expect(simpleLotAdvice(base(),advice).bidLabel).toContain('nearer the end');});
  test('stale, ended and over-ceiling auctions do not offer an actionable bid',()=>{expect(simpleLotAdvice(base(),bid(),true).suggestedBid).toBeNull();expect(simpleLotAdvice(base(),{...bid(),action:'ended'}).suggestedBid).toBeNull();expect(simpleLotAdvice(base(),{...bid(),action:'pass'}).suggestedBid).toBeNull();});
});
describe('Real eBay sold comparisons only',()=>{
  test('non-GBP, undated, invalid and duplicate evidence is excluded',()=>{const data={source:'ebay_marketplace_insights',status:'available',items:[sale(),sale(),{...sale(),id:'usd',currency:'USD'},{...sale(),id:'undated',soldDate:''},{...sale(),id:'bad',price:NaN}]};expect(parseManifestSoldResult(data,'Example').items).toHaveLength(1);});
  test('asking or AI results can never be labelled as sold',()=>expect(()=>parseManifestSoldResult({source:'browse',status:'available',items:[sale()]},'Example')).toThrow());
  test('unavailable is explicit and has no fake sales',()=>{const result=parseManifestSoldResult({source:'ebay_marketplace_insights',status:'unavailable',message:'Access unavailable',items:[sale()]},'Example');expect(result.items).toEqual([]);expect(result.message).toBe('Access unavailable');});
  test('request is niche-scoped, sold-only and never applies to an inventory item',async()=>{const invoke=jest.fn().mockResolvedValue({data:{source:'ebay_marketplace_insights',status:'empty',items:[]},error:null});(getSupabaseClient as jest.Mock).mockReturnValue({functions:{invoke}});await searchManifestSold('tenant','surplus_flip','Example product');expect(invoke).toHaveBeenCalledWith('swish-market-value',{body:expect.objectContaining({route:'manifest_sold_comparisons',nicheId:'surplus_flip',specialistId:'surplus_trader',applyToItem:false})});});
  test('server sold route uses the existing paid niche guard and proper scope, without AI or Browse',()=>{const code=source('supabase/functions/swish-market-value/index.ts');expect(code).toContain("body.route === 'manifest_sold_comparisons'");expect(code).toContain('requirePaidNiche(supabase, sec.account, tenantId, body.nicheId)');const adapter=source('supabase/functions/_shared/manifestSoldComparisons.ts');expect(adapter).toContain('buy.marketplace.insights');expect(adapter).toContain('item.lastSoldPrice?.value');expect(adapter).not.toContain('chat/completions');expect(adapter).not.toContain('/browse/');});
  test('scroll/navigation never trigger paid external searches',()=>{const hook=source('hooks/useManifestSoldComparisons.ts');expect(hook).not.toContain('setInterval(');expect(hook).toContain('Only an explicit product button');const workflow=source('hooks/useManifestOpportunity.ts');expect(workflow).toContain('checkSold:sold.checkSold');const ui=source('components/feature/ManifestOpportunityWorkspace.tsx');expect(ui).not.toContain('Separate cautious buying guide');});
});
