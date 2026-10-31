import { fetchManifestSoldComparisons } from '../../supabase/functions/_shared/manifestSoldComparisons';
const response=(data:unknown,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
describe('Sold-only eBay adapter with mocked provider responses, not live approval tests',()=>{
  const previous=global.fetch;
  afterEach(()=>{global.fetch=previous;});
  test('requests the sold-data OAuth scope, then reads only actual last-sold fields',async()=>{
    const fetchMock=jest.fn().mockResolvedValueOnce(response({access_token:'mock-token'})).mockResolvedValueOnce(response({itemSales:[
      {itemId:'sold-1',title:'Camera model',lastSoldPrice:{value:'25',currency:'GBP'},lastSoldDate:'2026-10-01T10:00:00Z',itemWebUrl:'https://www.ebay.co.uk/itm/123'},
      {itemId:'ask-1',title:'Active camera',price:{value:'900',currency:'GBP'}},
      {itemId:'no-date',title:'Camera model',lastSoldPrice:{value:'25',currency:'GBP'}},
      {itemId:'usd',title:'Camera model',lastSoldPrice:{value:'25',currency:'USD'},lastSoldDate:'2026-10-01T10:00:00Z'},
    ]}));global.fetch=fetchMock as any;
    const result=await fetchManifestSoldComparisons('id','secret','Camera model');
    expect(fetchMock.mock.calls[0][1].body).toContain('buy.marketplace.insights');
    expect(fetchMock.mock.calls[1][0]).toContain('/item_sales/search?');
    expect(result.status).toBe('available');expect(result.items).toHaveLength(1);expect(result.items[0].price).toBe(25);
  });
  test('access denial never falls back to active asking prices or AI',async()=>{
    const fetchMock=jest.fn().mockResolvedValueOnce(response({access_token:'mock-token'})).mockResolvedValueOnce(response({},403));global.fetch=fetchMock as any;
    const result=await fetchManifestSoldComparisons('id','secret','Camera');
    expect(result.status).toBe('unavailable');expect(result.items).toEqual([]);expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  test('invalid scope or network failure cannot produce fake sales',async()=>{
    global.fetch=jest.fn().mockResolvedValue(response({},400)) as any;
    expect((await fetchManifestSoldComparisons('id','secret','Camera')).status).toBe('unavailable');
    global.fetch=jest.fn().mockRejectedValue(new Error('offline')) as any;
    expect((await fetchManifestSoldComparisons('id','secret','Camera')).items).toEqual([]);
  });
});
