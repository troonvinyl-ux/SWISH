-- Additive shared eBay line lifecycle and server-only atomic ingestion.
-- Installation changes schema/functions only; no existing user rows are changed.
alter table public.orders add column if not exists ebay_line_key text;
alter table public.orders add column if not exists ebay_line_item_id text;
alter table public.orders add column if not exists ebay_order_aliases text[] not null default '{}';
alter table public.orders add column if not exists ebay_payment_status text;
alter table public.orders add column if not exists ebay_synced_at timestamptz;
alter table public.orders add column if not exists ebay_modified_at timestamptz;
alter table public.orders add column if not exists ebay_source text;
alter table public.orders add column if not exists quantity_ordered integer not null default 1;
alter table public.orders add column if not exists dispatch_claim_id uuid;
alter table public.orders add column if not exists dispatch_claimed_at timestamptz;
create unique index if not exists orders_tenant_ebay_line_key_unique on public.orders(tenant_id,ebay_line_key) where ebay_line_key is not null;
create index if not exists orders_tenant_payment_dispatch on public.orders(tenant_id,ebay_payment_status,fulfilment_status);
create or replace function public.swish_ingest_ebay_order_line(p_tenant_id uuid,p_niche_id text,p_listing_id uuid,p_line jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public set statement_timeout='15s' as $$
declare l public.listings%rowtype; i public.items%rowtype; o public.orders%rowtype; sid uuid; new_order boolean:=false; stage text; order_state text; paid boolean; aliases text[]; amount numeric; shipping numeric; fee numeric; net numeric; quantity integer; key text; modified timestamptz; created timestamptz;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Server-verified eBay evidence only' using errcode='42501'; end if;
 if jsonb_typeof(p_line) is distinct from 'object' or octet_length(p_line::text)>20000 or nullif(p_line->>'orderId','') is null or length(p_line->>'orderId')>150 or nullif(p_line->>'lineKey','') is null or length(p_line->>'lineKey')>200 or p_line->>'source' not in ('fulfillment_rest','trading_xml') then raise exception 'Invalid order line evidence' using errcode='22023'; end if;
 key:=p_line->>'lineKey'; amount:=(p_line->>'amount')::numeric; shipping:=(p_line->>'shipping')::numeric; quantity:=(p_line->>'quantity')::integer;
 if amount is null or shipping is null or amount<0 or shipping<0 or amount::text in ('NaN','Infinity','-Infinity') or shipping::text in ('NaN','Infinity','-Infinity') or quantity is null or quantity<1 then raise exception 'Invalid line amounts/quantity' using errcode='22023'; end if;
 stage:=p_line->>'fulfilmentStatus'; order_state:=p_line->>'status'; paid:=p_line->>'payment'='PAID';
 if stage is null or stage not in ('awaiting_payment','awaiting_dispatch','dispatched','delivered','cancelled','returned') then raise exception 'Invalid eBay lifecycle' using errcode='22023'; end if;
 if stage='delivered' and nullif(p_line->>'deliveredAt','') is null then raise exception 'Explicit eBay delivery evidence required' using errcode='22023'; end if;
 created:=(p_line->>'createdAt')::timestamptz; modified:=nullif(p_line->>'modifiedAt','')::timestamptz;
 if created is null then raise exception 'Order creation evidence required' using errcode='22023'; end if;
 aliases:=array(select distinct v from jsonb_array_elements_text(p_line->'aliases') v where length(v) between 1 and 150);
 if cardinality(aliases)>5 or not ((p_line->>'orderId')=any(aliases)) then raise exception 'Invalid order aliases' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text||':'||p_listing_id::text,0));
 select * into l from public.listings where id=p_listing_id and tenant_id=p_tenant_id and marketplace_id='ebay' for update;
 if not found or l.external_listing_id is distinct from p_line->>'legacyItemId' then raise exception 'Order listing identity differs from this tenant' using errcode='42501'; end if;
 select * into i from public.items where id=l.item_id and tenant_id=p_tenant_id for update;
 if not found or public.swish_specialist_niche(i.specialist_id) is distinct from p_niche_id then raise exception 'Order is outside this niche' using errcode='42501'; end if;
 if (select count(*) from public.orders x where x.tenant_id=p_tenant_id and x.marketplace_id='ebay' and x.item_id=i.id and x.listing_id=l.id and (x.ebay_line_key=key or ((x.external_order_id=any(aliases) or x.ebay_order_aliases&&aliases) and (x.ebay_line_key is null or (nullif(p_line->>'lineId','') is not null and x.ebay_line_item_id=p_line->>'lineId')))))>1 then raise exception 'Legacy duplicate order rows require review; no duplicate was inserted'; end if;
 select * into o from public.orders x where x.tenant_id=p_tenant_id and x.marketplace_id='ebay' and x.item_id=i.id and x.listing_id=l.id and (x.ebay_line_key=key or ((x.external_order_id=any(aliases) or x.ebay_order_aliases&&aliases) and (x.ebay_line_key is null or (nullif(p_line->>'lineId','') is not null and x.ebay_line_item_id=p_line->>'lineId')))) for update;
 if found then
  -- Never regress payment, posted parcels, completed local workflows or final cancellations from an incomplete fallback.
  if o.ebay_modified_at is not null and modified is not null and modified<o.ebay_modified_at and nullif(p_line->>'deliveredAt','') is null then return jsonb_build_object('id',o.id,'imported',false,'updated',false,'stale',true); end if;
  if o.ebay_payment_status='PAID' and p_line->>'source'='trading_xml' and not paid then return jsonb_build_object('id',o.id,'imported',false,'updated',false,'stale',true); end if;
  if o.fulfilment_status in ('cancelled','returned') and stage not in ('cancelled','returned') then return jsonb_build_object('id',o.id,'imported',false,'updated',false,'stale',true); end if;
  if stage='awaiting_dispatch' and o.fulfilment_status in ('packing','label_created','dispatched','delivered','completed') then stage:=o.fulfilment_status; end if;
  if stage='dispatched' and o.fulfilment_status in ('delivered','completed') then stage:=o.fulfilment_status; end if;
  if stage='delivered' and o.fulfilment_status='completed' then stage:=o.fulfilment_status; end if;
 else
  insert into public.orders(tenant_id,item_id,listing_id,marketplace_id,external_order_id,status,sale_price,created_at,fulfilment_status) values(p_tenant_id,i.id,l.id,'ebay',p_line->>'orderId',order_state,amount,created,stage) returning * into o;
  new_order:=true;
 end if;
 fee:=case when not new_order then coalesce(o.marketplace_fee,round(amount*0.128,2)) else round(amount*0.128,2) end;
 net:=amount-fee-shipping-coalesce(o.packaging_cost,0);
 order_state:=case when stage in ('packing','label_created','awaiting_dispatch') then 'payment_received' when stage='awaiting_payment' then 'pending' else stage end;
 update public.orders set external_order_id=case when p_line->>'source'='fulfillment_rest' then p_line->>'orderId' else coalesce(external_order_id,p_line->>'orderId') end,
  ebay_line_key=key,ebay_line_item_id=coalesce(nullif(p_line->>'lineId',''),ebay_line_item_id),ebay_order_aliases=array(select distinct v from unnest(coalesce(o.ebay_order_aliases,'{}')||aliases) v),ebay_payment_status=p_line->>'payment',ebay_synced_at=now(),ebay_modified_at=coalesce(modified,ebay_modified_at),ebay_source=p_line->>'source',quantity_ordered=quantity,status=order_state,fulfilment_status=stage,
  buyer_name=coalesce(nullif(p_line->>'buyerName',''),buyer_name),buyer_email=coalesce(nullif(p_line->>'buyerEmail',''),buyer_email),buyer_address=case when p_line->'buyerAddress' is not null and p_line->'buyerAddress'<>'{}'::jsonb then p_line->'buyerAddress' else buyer_address end,
  sale_price=amount,shipping_cost=shipping,marketplace_fee=fee,net_revenue=net,tracking_number=coalesce(nullif(p_line->>'trackingNumber',''),tracking_number),carrier=coalesce(nullif(p_line->>'carrier',''),carrier),dispatched_at=coalesce(dispatched_at,nullif(p_line->>'shippedAt','')::timestamptz),delivered_at=coalesce(nullif(p_line->>'deliveredAt','')::timestamptz,delivered_at),
  requires_action=stage in ('awaiting_dispatch','packing','label_created'),action_required=case when stage='awaiting_payment' then 'Awaiting confirmed eBay payment' when stage in ('awaiting_dispatch','packing','label_created') then 'Pack and dispatch this paid order' else null end,
  dispatch_claim_id=case when stage in ('dispatched','delivered','completed') then null else dispatch_claim_id end,dispatch_claimed_at=case when stage in ('dispatched','delivered','completed') then null else dispatch_claimed_at end,
  notes=case when new_order then 'fee_note:ESTIMATE_12.8pct' else notes end,updated_at=now() where id=o.id and tenant_id=p_tenant_id;
 if paid and stage not in ('cancelled','returned') then
  select id into sid from public.sales where tenant_id=p_tenant_id and marketplace_id='ebay' and item_id=i.id and (external_transaction_id=key or (external_transaction_id is null and external_order_id=any(aliases))) limit 1;
  if sid is null then
   insert into public.sales(tenant_id,item_id,listing_id,marketplace_id,sale_price,marketplace_fee,shipping_cost,net_revenue,profit,predicted_profit,sold_at,external_order_id,external_transaction_id,niche_id,specialist_id,category_id) values(p_tenant_id,i.id,l.id,'ebay',amount,fee,shipping,net,net-coalesce(i.acquired_cost,0),0,created,p_line->>'orderId',key,p_niche_id,i.specialist_id,l.category_id) returning id into sid;
  end if;
  update public.orders set sale_id=sid where id=o.id;
  if coalesce(i.quantity,1)<=1 and i.status not in ('sold','fulfilled','completed','disposed','held','bundled','wholesaled','scrapped') then
   update public.listings set status='sold',ended_at=coalesce(ended_at,created) where id=l.id and tenant_id=p_tenant_id;
   update public.items set status='sold',sold_at=coalesce(sold_at,created),sold_price=coalesce(sold_price,amount),marketplace='ebay' where id=i.id and tenant_id=p_tenant_id;
   insert into public.item_lifecycle_events(tenant_id,item_id,from_status,to_status,triggered_by,notes) values(p_tenant_id,i.id,i.status,'sold','ebay_orders_sync','Confirmed paid eBay order line');
  end if;
 end if;
 if new_order or o.status is distinct from order_state or o.fulfilment_status is distinct from stage then
  insert into public.audit_events(tenant_id,entity_type,entity_id,action,before_state,after_state) values(p_tenant_id,'order',o.id::text,'ebay_order_lifecycle_synced',jsonb_build_object('status',o.status,'stage',o.fulfilment_status),jsonb_build_object('status',order_state,'stage',stage,'source',p_line->>'source'));
 end if;
 return jsonb_build_object('id',o.id,'imported',new_order,'updated',not new_order,'multiQuantity',paid and stage not in ('cancelled','returned') and coalesce(i.quantity,1)>1);
end;$$;
revoke all on function public.swish_ingest_ebay_order_line(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.swish_ingest_ebay_order_line(uuid,text,uuid,jsonb) to service_role;
comment on function public.swish_ingest_ebay_order_line(uuid,text,uuid,jsonb) is 'Atomic seller line/status/payment/sale ingestion; no completion by age, no unpaid revenue; trusted service role and tenant/niche/listing identity.';
notify pgrst,'reload schema';
