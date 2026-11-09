-- Reduce authenticated inventory read planning and repeated authorization work.
-- Schema only: SELECT policies remain restrictive; all write policies and user data are unchanged.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';

-- A zero/one-row statement-local authorization relation, not a persisted access cache.
-- Reuse the existing membership, entitlement/owner and strict auth-session module checks.
create or replace function public.swish_readable_module()
returns table(tenant_id uuid,niche_id text)
language sql stable security definer
set search_path=pg_catalog,public as $$
 select m.tenant_id,m.niche_id from public.swish_module_sessions m
 where m.session_id=(select auth.jwt()->>'session_id') and m.user_id=(select auth.uid())
  and m.niche_id is not null and public.swish_can_access_niche(m.tenant_id,m.niche_id);
$$;
revoke all on function public.swish_readable_module() from public,anon;
grant execute on function public.swish_readable_module() to authenticated,service_role;

create index if not exists idx_items_tenant_niche_read on public.items
 (tenant_id,public.swish_specialist_niche(specialist_id),id);

-- Fail closed if a differently named/deployed policy would invalidate this equivalence review.
do $preflight$
begin
 if (select count(*) from pg_policies where schemaname='public' and permissive='RESTRICTIVE' and cmd='SELECT' and roles=array['authenticated']::name[] and
  (tablename,policyname) in (('items','authenticated_select_paid_items'),('listings','authenticated_select_paid_listings'),
   ('orders','authenticated_select_paid_order_resource'),('sales','authenticated_select_module_sales'),
   ('ebay_returns','authenticated_select_module_returns'))) <> 5 then
  raise exception 'Inventory SELECT policy preflight failed' using errcode='42501';
 end if;
end $preflight$;

-- Uncorrelated IN subqueries are computed once per statement instead of once per candidate row.
-- Existing permissive tenant-membership policies still AND with these restrictive predicates.
alter policy authenticated_select_paid_items on public.items using (
 (tenant_id,public.swish_specialist_niche(specialist_id)) in
 (select a.tenant_id,a.niche_id from public.swish_readable_module() a)
);
alter policy authenticated_select_paid_listings on public.listings using (
 (tenant_id,item_id) in (select i.tenant_id,i.id from public.items i)
);

-- Equivalent parent checks, split by nullable relationship identity to avoid broad OR scans.
-- Explicit item: must be readable; a supplied listing must match the same tenant AND item.
-- Listing-only order: must have a readable listing and its readable parent item.
alter policy authenticated_select_paid_order_resource on public.orders using (
 case when item_id is not null then
  (tenant_id,item_id) in (select i.tenant_id,i.id from public.items i)
  and (listing_id is null or (tenant_id,listing_id,item_id) in
   (select l.tenant_id,l.id,l.item_id from public.listings l))
 else
  listing_id is not null and (tenant_id,listing_id) in
   (select l.tenant_id,l.id from public.listings l join public.items i on i.id=l.item_id and i.tenant_id=l.tenant_id)
 end
);

-- Preserve historical sale attribution precedence; unclassified rows remain hidden.
alter policy authenticated_select_module_sales on public.sales using (
 (tenant_id,coalesce(niche_id,public.swish_specialist_niche(specialist_id),
  (select public.swish_specialist_niche(i.specialist_id) from public.items i where i.id=sales.item_id and i.tenant_id=sales.tenant_id)))
 in (select a.tenant_id,a.niche_id from public.swish_readable_module() a)
);

-- Exactly the three non-null identity paths previously passed to swish_market_resource_visible.
-- Null/missing/orphan identities cannot become visible, nor can another tenant/niche's orders.
alter policy authenticated_select_module_returns on public.ebay_returns using (
 (tenant_id,ebay_item_id) in (select l.tenant_id,l.external_listing_id from public.listings l where l.external_listing_id is not null)
 or (tenant_id,ebay_order_id) in (select o.tenant_id,o.external_order_id from public.orders o where o.external_order_id is not null)
 or (tenant_id,order_id) in (select o.tenant_id,o.id from public.orders o)
);
notify pgrst,'reload schema';
commit;
