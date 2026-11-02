jest.mock('@/template',()=>({getSupabaseClient:jest.fn()}));
import { getSupabaseClient } from '@/template';
import { saveListingEditor,type EditorSave } from '@/services/listingEditorService';

const base=():EditorSave=>({
  tenantId:'tenant-1',listingId:'listing-1',title:'Leather jacket',description:'Vintage leather jacket',
  price:'45',shippingCost:'4.99',floorPrice:'30',ceilingPrice:'60',categoryId:'57988',categoryName:'Coats',
  condition:'Used',conditionDescription:'Good',quantity:'1',sku:'JACKET-1',
  itemSpecifics:[
    {name:'Department',value:"Women's"},
    {name:'Style',value:'Vintage'},
    {name:'Outer Shell Material',value:'Leather'},
    {name:'',value:''},
  ],
});

describe('listing editor item-specific persistence contract',()=>{
  beforeEach(()=>jest.clearAllMocks());
  test('saves exact seller-entered clothing specifics through the existing RPC',async()=>{
    const rpc=jest.fn().mockResolvedValue({data:'listing-1',error:null});
    (getSupabaseClient as jest.Mock).mockReturnValue({rpc});
    const result=await saveListingEditor(base());
    expect(result.error).toBeNull();
    expect(rpc).toHaveBeenCalledWith('swish_save_listing_editor',expect.objectContaining({
      p_tenant_id:'tenant-1',p_listing_id:'listing-1',
      p_specifics:[
        {name:'Department',value:"Women's"},
        {name:'Style',value:'Vintage'},
        {name:'Outer Shell Material',value:'Leather'},
      ],
      p_item_patch:expect.objectContaining({ebay_category_id:'57988',ebay_category_name:'Coats'}),
    }));
  });
  test('rejects duplicate specific names before making a persistence call',async()=>{
    const rpc=jest.fn();
    (getSupabaseClient as jest.Mock).mockReturnValue({rpc});
    const input=base();
    input.itemSpecifics=[{name:'Department',value:"Women's"},{name:'department',value:'Men'}];
    const result=await saveListingEditor(input);
    expect(result.error).toMatch(/unique/);
    expect(rpc).not.toHaveBeenCalled();
  });
  test('rejects overlong values rather than silently truncating them',async()=>{
    const rpc=jest.fn();
    (getSupabaseClient as jest.Mock).mockReturnValue({rpc});
    const input=base();
    input.itemSpecifics=[{name:'Style',value:'x'.repeat(66)}];
    const result=await saveListingEditor(input);
    expect(result.error).toMatch(/not truncated/);
    expect(rpc).not.toHaveBeenCalled();
  });
});
