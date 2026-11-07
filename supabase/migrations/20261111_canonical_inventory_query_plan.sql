-- Preserve reporting semantics while allowing the tenant/item index to push
-- through external-identity deduplication. No global window materialization per item.
begin;
create index if not exists idx_listings_external_identity_normalized on public.listings(tenant_id,(btrim(external_listing_id)));
create or replace view public.swish_inventory_listing_rows with (security_invoker=true) as
select l.* from public.listings l where lower(btrim(l.marketplace_id)) not in ('ebay','ebay_gb')
  or nullif(btrim(l.external_listing_id),'') is null
  or not exists(select 1 from public.listings newer where newer.tenant_id=l.tenant_id
    and lower(btrim(newer.marketplace_id)) in ('ebay','ebay_gb') and btrim(newer.external_listing_id)=btrim(l.external_listing_id)
    and (coalesce(newer.updated_at,'epoch'::timestamptz),coalesce(newer.created_at,'epoch'::timestamptz))
      > (coalesce(l.updated_at,'epoch'::timestamptz),coalesce(l.created_at,'epoch'::timestamptz))
    or newer.tenant_id=l.tenant_id and lower(btrim(newer.marketplace_id)) in ('ebay','ebay_gb')
      and btrim(newer.external_listing_id)=btrim(l.external_listing_id)
      and coalesce(newer.updated_at,'epoch'::timestamptz)=coalesce(l.updated_at,'epoch'::timestamptz)
      and coalesce(newer.created_at,'epoch'::timestamptz)=coalesce(l.created_at,'epoch'::timestamptz) and newer.id<l.id);
notify pgrst,'reload schema';
commit;
