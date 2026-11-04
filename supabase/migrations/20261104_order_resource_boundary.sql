-- Additive resource-boundary policies on existing orders; historical rows retained.
-- Orphan/unclassified orders remain for owner reconciliation, not guessed niche assignment.
begin;
alter table public.sales add column if not exists niche_id text;
alter table public.sales add column if not exists specialist_id text;
alter table public.sales add column if not exists category_id text;
create index if not exists sales_tenant_niche_sold_at_idx on public.sales(tenant_id,niche_id,sold_at);
create or replace function public.swish_can_access_order_item(p_tenant_id uuid,p_item_id uuid,p_listing_id uuid)
returns boolean language sql stable security invoker set search_path=pg_catalog,public as $$
 select exists(select 1 from public.items i where i.tenant_id=p_tenant_id
 and public.swish_specialist_niche(i.specialist_id) is not null
 and public.swish_can_access_niche(p_tenant_id,public.swish_specialist_niche(i.specialist_id))
 and ((p_item_id is not null and i.id=p_item_id) or (p_item_id is null and exists(select 1 from public.listings l where l.id=p_listing_id and l.item_id=i.id and l.tenant_id=p_tenant_id)))
 and (p_listing_id is null or exists(select 1 from public.listings l where l.id=p_listing_id and l.item_id=i.id and l.tenant_id=p_tenant_id)));
$$;
revoke all on function public.swish_can_access_order_item(uuid,uuid,uuid) from public,anon;
grant execute on function public.swish_can_access_order_item(uuid,uuid,uuid) to authenticated,service_role;
do $$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='orders' and policyname='authenticated_select_paid_order_resource') then
 execute 'create policy authenticated_select_paid_order_resource on public.orders as restrictive for select to authenticated using(public.swish_can_access_order_item(tenant_id,item_id,listing_id))';
 end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='orders' and policyname='authenticated_insert_paid_order_resource') then
 execute 'create policy authenticated_insert_paid_order_resource on public.orders as restrictive for insert to authenticated with check(public.swish_can_access_order_item(tenant_id,item_id,listing_id))';
 end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='orders' and policyname='authenticated_update_paid_order_resource') then
 execute 'create policy authenticated_update_paid_order_resource on public.orders as restrictive for update to authenticated using(public.swish_can_access_order_item(tenant_id,item_id,listing_id)) with check(public.swish_can_access_order_item(tenant_id,item_id,listing_id))';
 end if;
end $$;
commit;
