-- Coin inventory investigation: existing public.items and related listings only.
-- Read-only audit. Does not impersonate users, edit a coin, alter RLS, or expose credentials.
-- Run with the audit connection; these counts are not proof of authenticated UI visibility.
select i.tenant_id,i.specialist_id,count(*) as coin_records,
 count(*) filter(where cardinality(i.media)>0) as records_with_photos
from public.items i where public.swish_specialist_niche(i.specialist_id)='coins'
group by i.tenant_id,i.specialist_id order by i.tenant_id,i.specialist_id;

select s.user_id,s.tenant_id,s.niche_id,s.updated_at,
 (select count(*) from public.items i where i.tenant_id=s.tenant_id and public.swish_specialist_niche(i.specialist_id)='coins') as selected_tenant_coins,
 (select count(*) from public.items i where public.swish_specialist_niche(i.specialist_id)='coins' and exists(select 1 from public.tenant_memberships m where m.user_id=s.user_id and m.tenant_id=i.tenant_id)) as member_tenant_coins
from public.swish_module_sessions s order by s.updated_at desc;

select count(*) as records,count(distinct i.id) as unique_ids,
 md5(string_agg(to_jsonb(i)::text,'|' order by i.id)) as item_fingerprint
from public.items i where public.swish_specialist_niche(i.specialist_id)='coins';

select count(l.id) as listing_relationships,
 count(l.id) filter(where nullif(l.external_listing_id,'') is not null) as external_ids,
 count(l.id) filter(where l.tenant_id<>i.tenant_id) as mismatched_tenants,
 md5(string_agg(to_jsonb(l)::text,'|' order by l.id)) as listing_fingerprint
from public.items i left join public.listings l on l.item_id=i.id
where public.swish_specialist_niche(i.specialist_id)='coins';

select tenant_id,inventory_tab,count(*) as rows,count(distinct item_id) as physical_items
from public.swish_inventory_tab_rows where public.swish_specialist_niche(specialist_id)='coins'
group by tenant_id,inventory_tab order by tenant_id,inventory_tab;
