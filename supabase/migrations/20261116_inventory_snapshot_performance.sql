-- Materialize the canonical scope once per existing count RPC.
-- Measured baseline: five warm SELECTs, median 51.121 ms / P90 52.56 ms / 18,105 shared hits.
-- No tables, ownership, RLS, identities or historical records are changed.
begin;
create or replace function public.swish_inventory_tab_counts(p_tenant_id uuid,p_niche_id text)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public set statement_timeout='10s' as $$
begin
 if auth.uid() is null or not public.swish_can_access_niche(p_tenant_id,p_niche_id) then
  raise exception 'Inventory niche access denied' using errcode='42501';
 end if;
 return(
  with physical as materialized (
   select c.*,i.status as recorded_status from public.swish_inventory_canonical_rows c
   join public.items i on i.id=c.item_id and i.tenant_id=c.tenant_id
   where c.tenant_id=p_tenant_id and c.niche_id=p_niche_id
  ), live_metric as (
   select count(*) as n from public.swish_inventory_listing_rows l join physical c
   on c.tenant_id=l.tenant_id and c.item_id=l.item_id
   where c.inventory_tab not in ('sold','archived') and lower(btrim(l.marketplace_id)) in ('ebay','ebay_gb')
    and lower(btrim(l.status)) in ('active','live') and l.ended_at is null and nullif(btrim(l.external_listing_id),'') is not null
  )
  select jsonb_build_object('total',count(distinct item_id),'units',coalesce(sum(quantity),0),
   'stock',count(*) filter(where inventory_tab='stock'),'draft',count(*) filter(where inventory_tab='draft'),
   'live',count(*) filter(where inventory_tab='live'),'sold',count(*) filter(where inventory_tab='sold'),
   'archived',count(*) filter(where inventory_tab='archived'),'live_listings',(select n from live_metric),
   'revision',md5(coalesce(string_agg(jsonb_build_array(item_id,item->>'updated_at',listing->>'id',listing->>'updated_at',inventory_tab,quantity)::text,',' order by item_id),'')||':'||(select n from live_metric)::text),
   'status_counts',(select coalesce(jsonb_object_agg(recorded_status,n),'{}'::jsonb) from (select recorded_status,count(*) as n from physical group by recorded_status) s)) from physical
 );
end;$$;
revoke all on function public.swish_inventory_tab_counts(uuid,text) from public,anon;
grant execute on function public.swish_inventory_tab_counts(uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
