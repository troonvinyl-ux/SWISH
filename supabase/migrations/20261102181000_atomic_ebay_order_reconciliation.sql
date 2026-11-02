-- Atomic eBay order reconciliation. The provider order has already been verified
-- by the server-side eBay Orders importer; clients cannot invoke this function.
begin;

create or replace function public.swish_reconcile_ebay_sold_order(
  p_tenant_id uuid,
  p_item_id uuid,
  p_listing_id uuid,
  p_sold_at timestamptz,
  p_sold_price numeric
) returns boolean
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_item public.items%rowtype;
  v_listing public.listings%rowtype;
  v_now timestamptz := now();
begin
  if auth.role() <> 'service_role' then
    raise exception 'Server-side eBay reconciliation only' using errcode='42501';
  end if;
  if p_tenant_id is null or p_item_id is null or p_listing_id is null
     or p_sold_price is null or p_sold_price < 0
     or p_sold_price::text in ('NaN','Infinity','-Infinity') then
    raise exception 'Invalid sold-order evidence' using errcode='22023';
  end if;

  select * into v_listing
    from public.listings
   where id=p_listing_id and tenant_id=p_tenant_id and item_id=p_item_id
     and marketplace_id='ebay' and nullif(btrim(external_listing_id),'') is not null
   for update;
  if not found then
    raise exception 'Verified eBay listing does not match the order item and account' using errcode='42501';
  end if;

  select * into v_item
    from public.items
   where id=p_item_id and tenant_id=p_tenant_id
   for update;
  if not found then
    raise exception 'Canonical inventory item not found in this account' using errcode='42501';
  end if;

  -- Never mark a multi-unit item wholly sold from one order line.
  if coalesce(v_item.quantity,1) > 1 then
    return false;
  end if;

  if lower(btrim(coalesce(v_item.status,''))) in ('held','bundled','wholesaled','scrapped','disposed') then
    raise exception 'Archived inventory requires manual review before sale reconciliation' using errcode='22023';
  end if;

  update public.listings
     set status='sold', ended_at=coalesce(ended_at,p_sold_at,v_now), updated_at=v_now
   where id=p_listing_id and tenant_id=p_tenant_id and item_id=p_item_id;

  update public.items
     set status='sold',
         sold_price=coalesce(sold_price,p_sold_price),
         sold_at=coalesce(sold_at,p_sold_at,v_now),
         marketplace='ebay',
         updated_at=v_now
   where id=p_item_id and tenant_id=p_tenant_id;

  if lower(btrim(coalesce(v_item.status,''))) not in ('sold','fulfilled','completed') then
    insert into public.item_lifecycle_events(
      tenant_id,item_id,from_status,to_status,triggered_by,notes
    ) values (
      p_tenant_id,p_item_id,v_item.status,'sold','ebay_orders_sync',
      'Confirmed eBay order for listing '||p_listing_id::text
    );
  end if;

  if lower(btrim(coalesce(v_item.status,''))) not in ('sold','fulfilled','completed')
     or lower(btrim(coalesce(v_listing.status,''))) <> 'sold' then
    insert into public.audit_events(
      tenant_id,entity_type,entity_id,action,before_state,after_state
    ) values (
      p_tenant_id,'listing',p_listing_id::text,'ebay_order_sold_reconciled',
      jsonb_build_object('item_status',v_item.status,'listing_status',v_listing.status),
      jsonb_build_object('item_status','sold','listing_status','sold','source','verified_ebay_order')
    );
  end if;

  return true;
end;
$$;

revoke all on function public.swish_reconcile_ebay_sold_order(uuid,uuid,uuid,timestamptz,numeric) from public,anon,authenticated;
grant execute on function public.swish_reconcile_ebay_sold_order(uuid,uuid,uuid,timestamptz,numeric) to service_role;

commit;
