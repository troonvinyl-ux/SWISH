-- Scope secondary marketplace resources to the currently authorized session module.
-- Legacy clients without a scope row retain their existing tenant-bound policies.
create or replace function public.swish_market_resource_visible(p_tenant_id uuid,p_external_item text,p_external_order text,p_listing_id uuid,p_order_id uuid)
returns boolean language sql stable security invoker set search_path=pg_catalog,public as $$
select (public.swish_current_module() is null) or
exists(select 1 from public.listings l where l.tenant_id=p_tenant_id and (l.id=p_listing_id or (p_external_item is not null and l.external_listing_id=p_external_item))) or
exists(select 1 from public.orders o where o.tenant_id=p_tenant_id and (o.id=p_order_id or (p_external_order is not null and o.external_order_id=p_external_order))); $$;
revoke all on function public.swish_market_resource_visible(uuid,text,text,uuid,uuid) from public,anon;
grant execute on function public.swish_market_resource_visible(uuid,text,text,uuid,uuid) to authenticated,service_role;
create policy authenticated_select_module_messages on public.ebay_messages as restrictive for select to authenticated using(public.swish_market_resource_visible(tenant_id,item_id,order_id,listing_id,null));
create policy authenticated_update_module_messages on public.ebay_messages as restrictive for update to authenticated using(public.swish_market_resource_visible(tenant_id,item_id,order_id,listing_id,null)) with check(public.swish_market_resource_visible(tenant_id,item_id,order_id,listing_id,null));
create policy authenticated_select_module_returns on public.ebay_returns as restrictive for select to authenticated using(public.swish_market_resource_visible(tenant_id,ebay_item_id,ebay_order_id,null,order_id));
create policy authenticated_select_module_cases on public.ebay_cases as restrictive for select to authenticated using(public.swish_market_resource_visible(tenant_id,null,ebay_order_id,null,order_id));
create policy authenticated_select_module_financials on public.ebay_financials as restrictive for select to authenticated using(public.swish_market_resource_visible(tenant_id,null,ebay_order_id,null,order_id));
