-- S3: atomic, scoped inventory transitions and idempotent provider message ingestion.
-- Definitions/grants only; applying this migration does not rewrite or delete existing records.
begin;
create or replace function public.swish_transition_item(
  p_tenant_id uuid, p_item_id uuid, p_status text, p_notes text default null,
  p_sold_price numeric default null, p_sold_at timestamptz default null, p_marketplace text default null
) returns boolean language plpgsql security invoker set search_path=pg_catalog,public as $$
declare v_item public.items%rowtype; v_actor uuid=auth.uid(); v_role text=auth.role();
begin
  if p_tenant_id is null or p_item_id is null or p_status is null or p_status not in (
    'new','captured','identifying','identified','researching','researched','assessing','assessed',
    'pricing','priced','listing','listed','active','sold','fulfilled','completed','held','bundled',
    'wholesaled','scrapped','disposed','error','review_required'
  ) or length(coalesce(p_notes,''))>4000 then raise exception 'Invalid item transition' using errcode='22023'; end if;
  if v_role is distinct from 'service_role' and (v_actor is null or not exists(
    select 1 from public.tenant_memberships where tenant_id=p_tenant_id and user_id=v_actor
  )) then raise exception 'Item access denied' using errcode='42501'; end if;
  select * into v_item from public.items where id=p_item_id and tenant_id=p_tenant_id for update;
  if not found then raise exception 'Item not found or not authorized' using errcode='42501'; end if;
  if v_role is distinct from 'service_role' and not public.swish_can_access_niche(p_tenant_id,public.swish_specialist_niche(v_item.specialist_id)) then
    raise exception 'Verified niche access required' using errcode='42501'; end if;
  if p_status in ('listed','active') and not exists (
    select 1 from public.listings where item_id=p_item_id and tenant_id=p_tenant_id
    and status in ('active','live') and nullif(btrim(external_listing_id),'') is not null and ended_at is null
  ) then raise exception 'Confirmed marketplace listing required' using errcode='22023'; end if;
  if v_item.status in ('sold','fulfilled','completed') and p_status not in ('sold','fulfilled','completed') then
    raise exception 'Sold item requires a reviewed reconciliation, not a generic transition' using errcode='22023'; end if;
  if p_sold_price is not null and (p_status<>'sold' or p_sold_price<0 or p_sold_price::text in ('NaN','Infinity','-Infinity')) then
    raise exception 'Invalid sale amount' using errcode='22023'; end if;
  if v_item.status=p_status and p_sold_price is not distinct from v_item.sold_price then return true; end if;
  if v_item.status=p_status and p_sold_price is null then return true; end if;
  update public.items set status=p_status,
    sold_price=coalesce(p_sold_price,sold_price),
    sold_at=case when p_status='sold' then coalesce(sold_at,p_sold_at,now()) else sold_at end,
    marketplace=coalesce(p_marketplace,marketplace),updated_at=now()
  where id=p_item_id and tenant_id=p_tenant_id;
  if not found then raise exception 'Item mutation was not confirmed' using errcode='42501'; end if;
  insert into public.item_lifecycle_events(tenant_id,item_id,from_status,to_status,triggered_by,notes)
    values(p_tenant_id,p_item_id,v_item.status,p_status,case when v_role='service_role' then 'system' else 'user' end,p_notes);
  insert into public.audit_events(tenant_id,user_id,entity_type,entity_id,action,before_state,after_state)
    values(p_tenant_id,v_actor,'item',p_item_id::text,'item_transition',
      jsonb_build_object('status',v_item.status,'sold_price',v_item.sold_price),
      jsonb_build_object('status',p_status,'sold_price',coalesce(p_sold_price,v_item.sold_price),'source',case when v_role='service_role' then 'server_command' else 'user_reported' end));
  return true;
end; $$;
revoke all on function public.swish_transition_item(uuid,uuid,text,text,numeric,timestamptz,text) from public,anon;
grant execute on function public.swish_transition_item(uuid,uuid,text,text,numeric,timestamptz,text) to authenticated,service_role;

create or replace function public.swish_ingest_ebay_message(p_tenant_id uuid,p_message_id text,p_observation jsonb)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_id uuid; v_date timestamptz;
begin
  if p_tenant_id is null or nullif(btrim(p_message_id),'') is null or length(p_message_id)>200
    or jsonb_typeof(p_observation) is distinct from 'object' or length(p_observation::text)>100000 then
    raise exception 'Invalid eBay message observation' using errcode='22023'; end if;
  -- Only the verified server eBay caller can execute this RPC; no client-controlled provider evidence.
  perform pg_advisory_xact_lock(hashtextextended('swish_message:'||p_tenant_id::text||':'||p_message_id,0));
  select id into v_id from public.ebay_messages where tenant_id=p_tenant_id and ebay_message_id=p_message_id order by created_at,id limit 1 for update;
  v_date=coalesce(nullif(p_observation->>'received_at','')::timestamptz,now());
  if v_id is null then
    insert into public.ebay_messages(tenant_id,ebay_message_id,buyer_username,subject,body,item_id,received_at,direction,is_read)
    values(p_tenant_id,p_message_id,coalesce(p_observation->>'sender',''),coalesce(p_observation->>'subject',''),
      coalesce(p_observation->>'body',''),nullif(p_observation->>'item_id',''),v_date,'inbound',coalesce((p_observation->>'is_read')::boolean,false)) returning id into v_id;
  else
    -- Provider refresh preserves local read/replied/archive flags, drafts and retained full body.
    update public.ebay_messages set buyer_username=coalesce(p_observation->>'sender',buyer_username),
      subject=coalesce(p_observation->>'subject',subject),item_id=coalesce(nullif(p_observation->>'item_id',''),item_id),
      body=case when nullif(p_observation->>'body','') is not null then p_observation->>'body' else body end,
      received_at=v_date,updated_at=now() where id=v_id and tenant_id=p_tenant_id;
  end if;
  return v_id;
end; $$;
revoke all on function public.swish_ingest_ebay_message(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.swish_ingest_ebay_message(uuid,text,jsonb) to service_role;
commit;
