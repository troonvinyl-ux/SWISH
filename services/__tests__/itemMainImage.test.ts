jest.mock('@/template',()=>({getSupabaseClient:jest.fn()}));
jest.mock('../backendRequestService',()=>({backendRead:jest.fn((_key:string,operation:(signal:AbortSignal)=>unknown)=>operation(new AbortController().signal))}));
import { getSupabaseClient } from '@/template';
import { moveMainImageFirst,selectMainItemImage } from '../itemPhotoService';
import { PRODUCTION_NICHE_IDS } from '@/constants/niches';
import { getProductionNicheSpecialistIds } from '../nicheRouting';
const media=['https://example.com/label.jpg','https://example.com/front.jpg','https://example.com/back.jpg'];
function setup(niche='collectibles'){
 const row={id:'item',tenant_id:'tenant',specialist_id:getProductionNicheSpecialistIds(niche)[0],canonical_title:'Item',media,updated_at:'2026-11-05T00:00:00Z'};
 const read:any={},write:any={};for(const query of [read,write])for(const method of ['select','eq','in','update','single','maybeSingle'])query[method]=jest.fn(()=>query);
 read.abortSignal=jest.fn().mockResolvedValue({data:row,error:null});write.abortSignal=jest.fn().mockResolvedValue({data:{...row,media:moveMainImageFirst(media,media[1])},error:null});
 const from=jest.fn().mockReturnValueOnce(read).mockReturnValue(write);(getSupabaseClient as jest.Mock).mockReturnValue({from});return {row,read,write,from};
}
beforeEach(()=>jest.clearAllMocks());
describe('Shared main image and independent seller selection, mocked backend',()=>{
 test('moves selected source first without removing or reordering others',()=>{expect(moveMainImageFirst(media,media[1])).toEqual([media[1],media[0],media[2]]);expect(media[0]).toContain('label');});
 test('unknown photos are refused',()=>expect(()=>moveMainImageFirst(media,'other')).toThrow('attached'));
 test.each(PRODUCTION_NICHE_IDS)('%s uses tenant/niche/version-constrained photo save',async niche=>{const {write,row}=setup(niche);const result=await selectMainItemImage('tenant',niche,'item',media[1],media);expect(result.error).toBeNull();expect(result.item?.media[0]).toBe(media[1]);expect(write.update).toHaveBeenCalledWith({media:[media[1],media[0],media[2]]});expect(write.eq).toHaveBeenCalledWith('tenant_id','tenant');expect(write.eq).toHaveBeenCalledWith('updated_at',row.updated_at);expect(write.in).toHaveBeenCalledWith('specialist_id',getProductionNicheSpecialistIds(niche));});
 test('unchanged main image makes no write',async()=>{const {write}=setup();expect((await selectMainItemImage('tenant','collectibles','item',media[0],media)).error).toBeNull();expect(write.update).not.toHaveBeenCalled();});
 test('stale photos never overwrite concurrent photo uploads',async()=>{const {read,row,write}=setup();read.abortSignal.mockResolvedValue({data:{...row,media:[...media,'new']},error:null});expect((await selectMainItemImage('tenant','collectibles','item',media[1],media)).error).toMatch(/Photos changed/);expect(write.update).not.toHaveBeenCalled();});
 test('zero rows and RLS errors are not success',async()=>{const {write}=setup();write.abortSignal.mockResolvedValue({data:null,error:null});expect((await selectMainItemImage('tenant','collectibles','item',media[1],media)).error).toMatch(/changed or access/);});
 test('inventory cover preserves the seller original/cutout subset',async()=>{const {row,read,write}=setup();const attributes={ebay_listing_media:[media[0],media[2]],maker:'Harrods'},next=[media[1],media[0],media[2]];read.abortSignal.mockResolvedValue({data:{...row,attributes},error:null});write.abortSignal.mockResolvedValue({data:{...row,media:next,attributes},error:null});const result=await selectMainItemImage('tenant','collectibles','item',media[1],media);expect(result.error).toBeNull();expect(write.update).toHaveBeenCalledWith({media:next});expect(result.item?.attributes?.ebay_listing_media).toEqual(attributes.ebay_listing_media);});
 test('missing scope fails before data access',async()=>{const {from}=setup();expect((await selectMainItemImage('','collectibles','item',media[1],media)).error).not.toBeNull();expect(from).not.toHaveBeenCalled();});
 test('cross-tenant read cannot produce a write',async()=>{const {read,row,write}=setup();read.abortSignal.mockResolvedValue({data:{...row,tenant_id:'other'},error:null});expect((await selectMainItemImage('tenant','collectibles','item',media[1],media)).error).not.toBeNull();expect(write.update).not.toHaveBeenCalled();});
});
