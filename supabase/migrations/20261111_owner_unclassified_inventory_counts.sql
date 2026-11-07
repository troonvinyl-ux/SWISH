-- Owner-wide physical totals include unclassified historical records without
-- assigning them a niche or granting subscribers access to another module.
begin;
do $migration$
declare v_definition text;v_marker text:=$marker$'subscriptionRevenue',null,$marker$;
begin
 v_definition:=pg_get_functiondef('public.swish_command_snapshot(uuid,boolean,text,text)'::regprocedure);
 if position('unclassifiedInventory' in v_definition)=0 then
  if position(v_marker in v_definition)=0 then raise exception 'Unreviewed command snapshot output'; end if;
  v_definition:=replace(v_definition,v_marker,$replacement$
'subscriptionRevenue',null,
'unclassifiedInventory',case when p_platform and p_niche_id is null then (select count(*) from public.items where public.swish_specialist_niche(specialist_id) is null) else 0 end,
'canonicalCounts',case when p_platform and p_niche_id is null then (
  with physical as materialized(select * from public.swish_inventory_canonical_rows)
  select jsonb_build_object('total',count(distinct item_id),'units',coalesce(sum(quantity),0),
    'stock',count(*) filter(where inventory_tab='stock'),'draft',count(*) filter(where inventory_tab='draft'),
    'live',count(*) filter(where inventory_tab='live'),'sold',count(*) filter(where inventory_tab='sold'),'archived',count(*) filter(where inventory_tab='archived'),
    'live_listings',(select count(*) from public.swish_inventory_listing_rows l join physical c on c.item_id=l.item_id and c.tenant_id=l.tenant_id
      where c.inventory_tab not in ('sold','archived') and lower(btrim(l.marketplace_id)) in ('ebay','ebay_gb') and lower(btrim(l.status)) in ('active','live') and l.ended_at is null and nullif(btrim(l.external_listing_id),'') is not null)) from physical
 ) else null end,
$replacement$);
  execute v_definition;
 end if;
end $migration$;
notify pgrst,'reload schema';
commit;
