-- Close the no-session fallback. Direct JWT clients must activate a verified module first.
-- Existing data, accounts and paid grants are preserved; older native clients need the unified upgrade.
create or replace function public.swish_can_access_niche(p_tenant_id uuid,p_niche_id text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
select public.swish_has_niche_entitlement(p_tenant_id,p_niche_id) and
exists(select 1 from public.swish_module_sessions where session_id=auth.jwt()->>'session_id' and user_id=auth.uid() and tenant_id=p_tenant_id and niche_id=p_niche_id); $$;
create or replace function public.swish_market_resource_visible(p_tenant_id uuid,p_external_item text,p_external_order text,p_listing_id uuid,p_order_id uuid)
returns boolean language sql stable security invoker set search_path=pg_catalog,public as $$
select exists(select 1 from public.listings l where l.tenant_id=p_tenant_id and (l.id=p_listing_id or (p_external_item is not null and l.external_listing_id=p_external_item)))
or exists(select 1 from public.orders o where o.tenant_id=p_tenant_id and (o.id=p_order_id or (p_external_order is not null and o.external_order_id=p_external_order))); $$;
