-- Prevent future cross-tenant listing/item references, including service-role writes.
-- Existing user rows are neither read into reports nor updated by this migration.
create or replace function public.swish_guard_listing_tenant()
returns trigger language plpgsql security definer set search_path=pg_catalog,public
as $$ begin
if not exists(select 1 from public.items i where i.id=new.item_id and i.tenant_id=new.tenant_id) then
raise exception 'Listing and inventory item must belong to the same account' using errcode='42501';
end if;
return new;
end; $$;
revoke all on function public.swish_guard_listing_tenant() from public,anon,authenticated;
do $$ begin
if not exists(select 1 from pg_trigger where tgrelid='public.listings'::regclass and tgname='guard_listing_tenant') then
create trigger guard_listing_tenant before insert or update of tenant_id,item_id on public.listings for each row execute function public.swish_guard_listing_tenant();
end if;
end $$;
