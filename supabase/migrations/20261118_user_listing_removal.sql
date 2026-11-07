-- User-controlled two-step removal: confirmed eBay end, then explicit inventory deletion.
-- Schema and guards only. Applying this migration does not delete or rewrite user records.
begin;
set local lock_timeout='5s';

-- Only the server may attest seller GetItem evidence. Client status edits are not proof of an end.
create table if not exists public.swish_listing_end_receipts (
 listing_id uuid primary key references public.listings(id) on delete cascade,
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 item_id uuid not null references public.items(id) on delete cascade,
 external_listing_id text not null check (external_listing_id ~ '^[0-9]+$'),
 quantity_sold integer not null check (quantity_sold=0),
 confirmed_at timestamptz not null default now()
);
alter table public.swish_listing_end_receipts enable row level security;
revoke all on public.swish_listing_end_receipts from public,anon,authenticated;
grant select on public.swish_listing_end_receipts to authenticated;
grant all on public.swish_listing_end_receipts to service_role;
create policy authenticated_select_own_listing_end_receipts on public.swish_listing_end_receipts
 for select to authenticated using (exists(select 1 from public.items i where i.id=item_id and i.tenant_id=swish_listing_end_receipts.tenant_id));
comment on table public.swish_listing_end_receipts is 'Server-only unsold seller GetItem end confirmations; no tokens, photos or item payloads.';

-- Private predicate sees all related rows, even children hidden by caller RLS.
-- Regex-based positive sale evidence avoids casting arbitrary client metadata to numeric.
create or replace function public.swish_item_removal_issue(p_tenant_id uuid,p_item_id uuid)
returns text language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare
 v_item public.items%rowtype;
 v_external text;
begin
 select * into v_item from public.items where id=p_item_id and tenant_id=p_tenant_id;
 if not found then return 'Item not found in this account.';end if;
 if lower(btrim(v_item.status)) in ('sold','fulfilled','completed') or v_item.sold_at is not null or v_item.sold_price is not null
  or coalesce(v_item.attributes->>'_ebay_quantity_sold','0') ~ '^[0-9]*[1-9][0-9]*$'
  or exists(select 1 from public.sales s where s.item_id=p_item_id)
  or exists(select 1 from public.orders o where o.item_id=p_item_id or o.listing_id in(select id from public.listings where item_id=p_item_id))
  or exists(select 1 from public.ebay_returns r where r.item_id=p_item_id)
 then return 'Sale, order or return history must be retained. This item cannot be deleted.';end if;
 if exists(select 1 from public.listings l where l.item_id=p_item_id and (l.tenant_id<>p_tenant_id or l.publish_claim_id is not null))
 then return 'A publication is pending or its outcome is unconfirmed. Sync eBay before deleting.';end if;
 if lower(btrim(v_item.status)) in ('listed','active') or exists(select 1 from public.listings l where l.item_id=p_item_id
  and lower(btrim(coalesce(l.status,''))) not in ('draft','pending','failed','ended'))
 then return 'End every live listing first, then return to inventory to delete the item.';end if;
 if exists(select 1 from public.listings l where l.item_id=p_item_id and
  ((nullif(btrim(l.external_listing_id),'') is not null or l.published_at is not null) and
   (lower(btrim(l.marketplace_id)) not in ('ebay','ebay_gb') or lower(btrim(l.status))<>'ended' or
    not exists(select 1 from public.swish_listing_end_receipts r where r.listing_id=l.id and r.tenant_id=p_tenant_id
     and r.item_id=p_item_id and r.external_listing_id=btrim(l.external_listing_id) and r.quantity_sold=0))))
 then return 'Confirm the saved listing has ended on eBay before deleting. Open the item and choose Confirm ended on eBay.';end if;
 v_external:=nullif(btrim(v_item.attributes->>'_ebay_item_id'),'');
 if v_external is not null and not exists(select 1 from public.swish_listing_end_receipts r join public.listings l on l.id=r.listing_id
  where r.tenant_id=p_tenant_id and r.item_id=p_item_id and r.external_listing_id=v_external
   and btrim(l.external_listing_id)=v_external and lower(btrim(l.status))='ended')
 then return 'This imported eBay identity needs an end confirmation before deletion.';end if;
 return null;
end;
$$;
revoke all on function public.swish_item_removal_issue(uuid,uuid) from public,anon,authenticated;

create or replace function public.swish_inventory_delete_issue(p_tenant_id uuid,p_item_id uuid)
returns text language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_niche text;
begin
 select public.swish_specialist_niche(specialist_id) into v_niche from public.items where id=p_item_id and tenant_id=p_tenant_id;
 if auth.uid() is null or v_niche is null or public.swish_can_access_niche(p_tenant_id,v_niche) is not true
 then raise exception 'Active account and niche access required' using errcode='42501';end if;
 return public.swish_item_removal_issue(p_tenant_id,p_item_id);
end;
$$;
revoke all on function public.swish_inventory_delete_issue(uuid,uuid) from public,anon;
grant execute on function public.swish_inventory_delete_issue(uuid,uuid) to authenticated;

-- Runs on existing client deletion and all cascades; a forged local status cannot skip evidence.
create or replace function public.swish_guard_item_removal() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_issue text;
begin
 v_issue:=public.swish_item_removal_issue(old.tenant_id,old.id);
 if v_issue is not null then raise exception '%',v_issue using errcode='23514';end if;
 return old;
end;
$$;
create or replace trigger guard_user_item_removal before delete on public.items
 for each row execute function public.swish_guard_item_removal();

-- Serialize new drafts and publish claims against the parent deletion lock.
-- Published references cannot be erased or moved to pretend the item was never listed.
create or replace function public.swish_lock_listing_inventory() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if tg_op='UPDATE' and nullif(btrim(old.external_listing_id),'') is not null and
  (new.external_listing_id is distinct from old.external_listing_id or new.item_id is distinct from old.item_id or new.tenant_id is distinct from old.tenant_id)
 then raise exception 'A published eBay reference cannot be cleared or moved. End the saved listing first.' using errcode='23514';end if;
 if tg_op='UPDATE' and old.published_at is not null and new.published_at is null
 then raise exception 'Publication history cannot be cleared to bypass removal checks.' using errcode='23514';end if;
 perform 1 from public.items where id=new.item_id and tenant_id=new.tenant_id for update;
 if not found then raise exception 'Inventory item is no longer available' using errcode='23503';end if;
 return new;
end;
$$;
create or replace trigger lock_listing_inventory_removal before insert or update of item_id,tenant_id,status,external_listing_id,published_at,publish_claim_id on public.listings
 for each row execute function public.swish_lock_listing_inventory();

-- Standalone deletion is for never-published drafts only. Ended history stays linked until item deletion.
create or replace function public.swish_guard_listing_removal() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if exists(select 1 from public.items where id=old.item_id) and
  (old.publish_claim_id is not null or nullif(btrim(old.external_listing_id),'') is not null or old.published_at is not null
   or exists(select 1 from public.swish_listing_end_receipts where listing_id=old.id)
   or lower(btrim(coalesce(old.status,''))) not in ('draft','pending','failed')
   or exists(select 1 from public.sales where listing_id=old.id) or exists(select 1 from public.orders where listing_id=old.id))
 then raise exception 'End the eBay listing first, then delete its item from inventory. Marketplace history cannot be removed separately.' using errcode='23514';end if;
 return old;
end;
$$;
create or replace trigger guard_user_listing_removal before delete on public.listings
 for each row execute function public.swish_guard_listing_removal();
create policy authenticated_delete_own_unpublished_listings on public.listings
 for delete to authenticated using (tenant_id in(select public.swish_user_tenant_ids()) and
  exists(select 1 from public.items i where i.id=listings.item_id and i.tenant_id=listings.tenant_id));
grant delete on public.listings to authenticated;
revoke all on function public.swish_guard_item_removal(),public.swish_lock_listing_inventory(),public.swish_guard_listing_removal() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
