-- SWISH pool repair: remove the global materialization fence in the existing inventory view.
-- Existing rows, grants, niche identities and SECURITY INVOKER RLS are unchanged.
-- EXPLAIN before repair: classified CTE materializes all tenants before filtering (cost 145901).
-- Index audit: listings and sales had no item relationship index; other existing indexes retained.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
create index if not exists idx_listings_tenant_item on public.listings(tenant_id,item_id);
create index if not exists idx_sales_tenant_item on public.sales(tenant_id,item_id);
create or replace view public.swish_inventory_tab_rows with (security_invoker = true) as
select i.tenant_id,i.specialist_id,i.id as item_id,c.inventory_tab,
  to_jsonb(i)||case when c.terminal_sold then jsonb_build_object('status','sold') else '{}'::jsonb end as item,
  c.listing,c.sort_at
from public.items i
cross join lateral (
  -- This CTE is per physical item, not a materialized scan of the whole shared inventory.
  with classified as (
    select case when state.terminal_sold then 'sold'
      when lower(btrim(i.status)) in ('held','bundled','wholesaled','scrapped','disposed','archived') then 'archived'
      when lower(btrim(l.status)) in ('active','live') and nullif(btrim(l.external_listing_id),'') is not null and l.ended_at is null then 'live'
      when lower(btrim(l.status)) in ('draft','pending','failed') and nullif(btrim(l.external_listing_id),'') is null and l.ended_at is null then 'draft'
      else 'stock' end as inventory_tab,
      state.terminal_sold,
      case when l.id is not null then to_jsonb(l) else null end as listing,
      coalesce(l.updated_at,i.updated_at,i.created_at) as sort_at,
      row_number() over(order by l.updated_at desc nulls last,l.id) as item_row
    from (
      select lower(btrim(i.status)) in ('sold','fulfilled','completed') or i.sold_at is not null
        or exists(select 1 from public.listings x where x.item_id=i.id and x.tenant_id=i.tenant_id and lower(btrim(x.status)) in ('sold','fulfilled','completed'))
        or (coalesce(i.quantity,1)<=1 and (
          exists(select 1 from public.sales s where s.item_id=i.id and s.tenant_id=i.tenant_id)
          or exists(select 1 from public.orders o where o.item_id=i.id and o.tenant_id=i.tenant_id and lower(btrim(o.status)) in ('completed','paid','sold','dispatched','shipped','delivered','fulfilled'))
        ))
        or (i.attributes->>'_ebay_status_source'='GetItem' and i.attributes->>'_ebay_listing_status'='sold') as terminal_sold
      offset 0
    ) state
    left join public.listings l on l.item_id=i.id and l.tenant_id=i.tenant_id
  )
  select inventory_tab,terminal_sold,listing,sort_at from classified c
  where c.inventory_tab in ('live','draft')
    or (c.inventory_tab='sold' and c.item_row=1)
    or (c.inventory_tab='stock' and c.item_row=1 and not exists(
      select 1 from classified x where x.inventory_tab in ('live','draft','sold','archived')
    ))
) c;
revoke all on public.swish_inventory_tab_rows from public,anon;
grant select on public.swish_inventory_tab_rows to authenticated;

-- One aggregate request replaces page-by-page status reads. This is not a second inventory.
create or replace function public.swish_inventory_status_counts(p_tenant_id uuid,p_specialist_ids text[] default null)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare v_niche text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_specialist_ids is not null and cardinality(p_specialist_ids)=0 then return '{}'::jsonb; end if;
  -- Even an all-status read must remain bound to the currently authorized module.
  select niche_id into v_niche from public.swish_module_sessions
    where session_id=auth.jwt()->>'session_id' and user_id=auth.uid() and tenant_id=p_tenant_id;
  if v_niche is null or not public.swish_can_access_niche(p_tenant_id,v_niche) then
    raise exception 'Inventory niche access denied' using errcode='42501';
  end if;
  if p_specialist_ids is not null and exists(select 1 from unnest(p_specialist_ids) s
      where public.swish_specialist_niche(s) is distinct from v_niche) then
    raise exception 'Inventory specialist scope mismatch' using errcode='42501';
  end if;
  return (select coalesce(jsonb_object_agg(status,n),'{}'::jsonb) from (
    select status,count(*) n from public.items where tenant_id=p_tenant_id
      and (p_specialist_ids is null or specialist_id=any(p_specialist_ids)) group by status
  ) counts);
end; $$;
create or replace function public.swish_inventory_tab_counts(p_tenant_id uuid,p_niche_id text)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.swish_can_access_niche(p_tenant_id,p_niche_id) then
    raise exception 'Inventory niche access denied' using errcode='42501';
  end if;
  return jsonb_build_object('stock',0,'draft',0,'live',0,'sold',0)||(select coalesce(jsonb_object_agg(inventory_tab,n),'{}'::jsonb) from (
    select inventory_tab,count(*) n from public.swish_inventory_tab_rows
    where tenant_id=p_tenant_id and public.swish_specialist_niche(specialist_id)=p_niche_id group by inventory_tab
  ) counts);
end; $$;
revoke all on function public.swish_inventory_status_counts(uuid,text[]),public.swish_inventory_tab_counts(uuid,text) from public,anon;
grant execute on function public.swish_inventory_status_counts(uuid,text[]),public.swish_inventory_tab_counts(uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
