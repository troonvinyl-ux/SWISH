import { getSupabaseClient } from '@/template';
import { confirmedMusicAttributes, type MusicRelease } from '@/shared/musicRelease';
import { mapItem, createItem, type Item } from './itemService';
import { backendRead } from './backendRequestService';
export interface MusicCollectionFilter {field:string;query:string;status:string;sort:string;minValue:string;maxValue:string}
export const MUSIC_FILTER_FIELDS=['artist','release_title','genre','format','label','year','country','media_grade','sleeve_grade'] as const;
const sorts:Record<string,{column:string;ascending:boolean}>={recent:{column:'created_at',ascending:false},highest:{column:'valuation_mid',ascending:false},lowest:{column:'valuation_mid',ascending:true},artist:{column:'attributes->>artist',ascending:true},release_date:{column:'attributes->>year',ascending:false},profit:{column:'expected_profit',ascending:false}};
export async function listMusicPage(tenantId:string,filter:MusicCollectionFilter,page=0):Promise<{items:Item[];more:boolean}>{
 if(!tenantId||!Number.isSafeInteger(page)||page<0)throw new Error('Account and valid page required.');
 const client=getSupabaseClient();const auth=await client.rpc('swish_can_access_niche',{p_tenant_id:tenantId,p_niche_id:'tunes_flip'});
 if(auth.error||auth.data!==true)throw new Error('Open an entitled Tunes Flip workspace before viewing this collection.');
 const sort=sorts[filter.sort]??sorts.recent;
 let query=client.from('items').select('*').eq('tenant_id',tenantId).eq('specialist_id','vinyl_records');
 if(filter.status&&filter.status!=='all')query=query.eq('status',filter.status);
 if(filter.query.trim()){
  if(!(MUSIC_FILTER_FIELDS as readonly string[]).includes(filter.field))throw new Error('Invalid music filter.');
  const term=filter.query.replace(/[%_\\]/g,' ').trim().slice(0,120);query=query.ilike(`attributes->>${filter.field}`,`%${term}%`);
 }
 for(const [value,kind]of [[filter.minValue,'min'],[filter.maxValue,'max']] as const){if(value.trim()){const amount=Number(value);if(!Number.isFinite(amount)||amount<0)throw new Error('Value filters must be non-negative amounts.');query=kind==='min'?query.gte('valuation_mid',amount):query.lte('valuation_mid',amount);}}
 query=query.order(sort.column,{ascending:sort.ascending}).order('id',{ascending:true});
 const {data,error}=await backendRead(`music:${tenantId}:${JSON.stringify(filter)}:${page}`,signal=>query.range(page*50,page*50+49).abortSignal(signal));
 if(error)throw new Error('Music collection could not be read. Retry.');return {items:(data??[]).map(mapItem),more:(data?.length??0)===50};
}
export async function addCatalogueMusic(tenantId:string,release:MusicRelease,confirmed:boolean){
 const attrs=confirmedMusicAttributes(release,confirmed);
 const created=await createItem(tenantId,{canonicalTitle:release.title,specialistId:'vinyl_records',identificationSource:'user_confirmed',identificationConfidence:0,status:'review_required',catalogueNumber:attrs.catalogue_number,yearMade:release.year,countryOfOrigin:release.country,attributes:attrs,warnings:['Catalogue identity confirmed by user; original photos, media/sleeve grades and playback review still required.'],valuationConfidence:'unknown',media:[]});
 if(created.error||!created.item)return created;
 const client=getSupabaseClient();const readback=await client.from('items').select('attributes').eq('tenant_id',tenantId).eq('id',created.item.id).eq('specialist_id','vinyl_records').maybeSingle();
 if(readback.error||readback.data?.attributes?.discogs_release_id!==String(release.id))return {item:created.item,error:'Item created, but catalogue reference readback failed. Open the saved item; do not add it again.'};
 return created;
}
export async function attachMusicRelease(tenantId:string,itemId:string,release:MusicRelease,confirmed:boolean){
 const client=getSupabaseClient();const attrs=confirmedMusicAttributes(release,confirmed);
 const {data:row,error}=await client.from('items').select('attributes,updated_at').eq('tenant_id',tenantId).eq('id',itemId).eq('specialist_id','vinyl_records').maybeSingle();
 if(error||!row)throw new Error('Music item was not found in this account.');
 const attributes={...row.attributes,...attrs,_valuation_needs_review:true};
 const saved=await client.from('items').update({attributes,canonical_title:release.title,catalogue_number:attrs.catalogue_number,year_made:release.year,country_of_origin:release.country}).eq('tenant_id',tenantId).eq('id',itemId).eq('specialist_id','vinyl_records').eq('updated_at',row.updated_at).select('id').maybeSingle();
 if(saved.error||!saved.data)throw new Error('The record changed or access was denied. Reload before retrying.');
 const readback=await client.from('items').select('attributes').eq('tenant_id',tenantId).eq('id',itemId).eq('specialist_id','vinyl_records').maybeSingle();
 if(readback.error||readback.data?.attributes?.discogs_release_id!==String(release.id))throw new Error('Saved catalogue reference could not be confirmed. Reload; do not create a duplicate.');
}
