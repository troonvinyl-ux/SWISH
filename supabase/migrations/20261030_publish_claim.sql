-- Server-owned operation claim: prevents concurrent marketplace publishes.
-- No existing listing/status/credential data is changed by this migration.
alter table public.listings add column if not exists publish_claim_id uuid;
alter table public.listings add column if not exists publish_claimed_at timestamptz;
create or replace function public.swish_claim_listing_publish(p_listing_id uuid,p_tenant_id uuid)
returns uuid language plpgsql security definer set search_path=pg_catalog, public
as $$ declare v_claim uuid; begin
update public.listings set publish_claim_id=gen_random_uuid(),publish_claimed_at=now()
where id=p_listing_id and tenant_id=p_tenant_id and marketplace_id='ebay'
  and status in ('draft','pending','failed') and nullif(external_listing_id,'') is null
  and publish_claim_id is null returning publish_claim_id into v_claim;
return v_claim;
end; $$;
revoke all on function public.swish_claim_listing_publish(uuid,uuid) from public,anon,authenticated;
grant execute on function public.swish_claim_listing_publish(uuid,uuid) to service_role;
revoke update on public.listings from public,anon,authenticated;
do $$ declare v_columns text; begin
select string_agg(quote_ident(column_name),',') into v_columns from information_schema.columns
where table_schema='public' and table_name='listings' and column_name not in ('publish_claim_id','publish_claimed_at');
execute format('grant update (%s) on public.listings to authenticated',v_columns);
end $$;
