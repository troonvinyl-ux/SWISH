-- SWISH: exact shared Seller Hub counts using canonical inventory and deduplicated eBay observations.
-- Schema only. No user data, identity, policy, photo or marketplace state changes.
begin;
create or replace function public.swish_niche_listing_metrics(p_tenant_id uuid, p_niche_id text)
returns jsonb language plpgsql stable security invoker
set search_path=pg_catalog,public set statement_timeout='10s' set jit=off as $$
declare v_counts jsonb;
begin
  -- The existing count RPC verifies the caller's current tenant, module and paid access.
  v_counts := public.swish_inventory_tab_counts(p_tenant_id,p_niche_id);
  return (
    select jsonb_build_object('inventory_counts',v_counts,
      'total_listings',count(*),
      'ended_listings',count(*) filter(where lower(btrim(l.status))='ended'))
    from public.swish_inventory_listing_rows l
    join public.items i on i.id=l.item_id and i.tenant_id=l.tenant_id
    where l.tenant_id=p_tenant_id and public.swish_specialist_niche(i.specialist_id)=p_niche_id
      and lower(btrim(l.marketplace_id)) in ('ebay','ebay_gb')
  );
end; $$;
revoke all on function public.swish_niche_listing_metrics(uuid,text) from public,anon;
grant execute on function public.swish_niche_listing_metrics(uuid,text) to authenticated;
comment on function public.swish_niche_listing_metrics(uuid,text) is 'Exact RLS-enforced stored eBay counts. Live listings and draft items are distinct metrics; no seller API call.';
notify pgrst,'reload schema';
commit;
