import { getSupabaseClient } from '@/template';
import { getProductionNicheSpecialistIds } from './nicheRouting';
import { getSpecialistProfile,recordValue } from '@/shared/specialistIntelligence';
export async function saveSpecialistItemFields(tenantId:string,nicheId:string,itemId:string,values:Record<string,string>) {
  const profile=getSpecialistProfile(nicheId);const specialists=getProductionNicheSpecialistIds(nicheId);
  if(!tenantId || !profile || !specialists.length) return { attributes:null,error:'A valid account and specialist niche are required.' };
  const client=getSupabaseClient();
  const { data:row,error:readError }=await client.from('items').select('attributes,updated_at').eq('id',itemId).eq('tenant_id',tenantId).in('specialist_id',specialists).maybeSingle();
  if(readError || !row) return { attributes:null,error:readError?.message ?? 'Item not found in this niche.' };
  const attributes={ ...recordValue(row.attributes) };const original=recordValue(attributes._specialist_analysis);
  const fields={ ...recordValue(original.fields) };const changed:Record<string,{ before:unknown;after:string }>={};
  for(const descriptor of profile.fields) {
    if(!(descriptor.key in values)) continue;
    const value=values[descriptor.key].trim();
    if(value.length>500) return { attributes:null,error:'Specialist fields must be at most 500 characters. Nothing was saved.' };
    if(value===String(attributes[descriptor.key] ?? '')) continue;
    changed[descriptor.key]={ before:attributes[descriptor.key] ?? null,after:value };
    attributes[descriptor.key]=value;
    fields[descriptor.key]={ value,basis:'user_supplied',reason:'Human correction; not independently verified.' };
  }
  attributes._specialist_analysis={ ...original,fields };
  const history=Array.isArray(attributes._specialist_corrections) ? attributes._specialist_corrections : [];
  if(Object.keys(changed).length) attributes._specialist_corrections=[...history,{ changed,recordedAt:new Date().toISOString() }].slice(-20);
  // Compare-and-swap protects concurrent editor/sync changes instead of replacing a newer attribute object.
  let query=client.from('items').update({ attributes,updated_at:new Date().toISOString() },{ count:'exact' }).eq('id',itemId).eq('tenant_id',tenantId).in('specialist_id',specialists);
  query=row.updated_at ? query.eq('updated_at',row.updated_at) : query.is('updated_at',null);
  const { error,count }=await query;
  return { attributes:error || count!==1 ? null : attributes,error:error?.message ?? (count!==1 ? 'The item changed while saving. Reload it and review your edits before retrying.' : null) };
}
