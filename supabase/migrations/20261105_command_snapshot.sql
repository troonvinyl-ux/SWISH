-- Read-only command reporting on canonical tables. No data or RLS policies changed.
-- Trusted owners may inspect platform aggregates; subscribers must have tenant membership
-- and unexpired server-cached niche entitlements. Module-session state is never mutated.
create or replace function public.swish_command_snapshot(
  p_tenant_id uuid default null, p_platform boolean default false,
  p_section text default 'portfolio', p_niche_id text default null
) returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  v_owner boolean;
  v_ids text[] := array['coins','motocross','bicycles','clothing','trading_cards','antiques','fossils','beauty','tech','surplus_flip','collectibles'];
  v_allowed text[];
  v_week timestamptz := date_trunc('week', now() at time zone 'Europe/London') at time zone 'Europe/London';
  v_month timestamptz := date_trunc('month', now() at time zone 'Europe/London') at time zone 'Europe/London';
  v_result jsonb;
  v_rows jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  v_owner := public.swish_is_platform_owner() is true;
  if p_platform and not v_owner then raise exception 'Trusted platform owner required' using errcode='42501'; end if;
  if p_section <> 'portfolio' and not v_owner then raise exception 'Administrative inspection denied' using errcode='42501'; end if;
  if not p_platform and (p_tenant_id is null or not exists(select 1 from public.tenant_memberships where tenant_id=p_tenant_id and user_id=auth.uid())) then
    raise exception 'Tenant membership required' using errcode='42501';
  end if;
  if p_niche_id is not null and not p_niche_id=any(v_ids) then raise exception 'Unknown canonical niche' using errcode='22023'; end if;
  if v_owner then v_allowed := v_ids;
  else
    select coalesce(array_agg(n),array[]::text[]) into v_allowed from unnest(v_ids) n
    where public.swish_has_niche_entitlement(p_tenant_id,n) and exists(
      select 1 from public.niche_entitlements e where e.user_id=auth.uid() and e.niche_id=n and e.expires_at>now()
    );
  end if;
  if p_niche_id is not null then
    if not p_niche_id=any(v_allowed) then raise exception 'Niche entitlement required' using errcode='42501'; end if;
    v_allowed := array[p_niche_id];
  end if;
  if p_section <> 'portfolio' then
    -- Bounded owner-only inspectors intentionally omit credential refs, tokens,
    -- business settings payloads, buyer addresses and arbitrary error payloads.
    if p_section='users' then
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_rows from
        (select id,username,email from public.user_profiles order by id limit 50) r;
    elsif p_section='memberships' then
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_rows from
        (select user_id,niche_id,expires_at,checked_at from public.niche_entitlements where p_niche_id is null or niche_id=p_niche_id order by checked_at desc limit 50) r;
    elsif p_section='inventory' then
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_rows from
        (select id,tenant_id,canonical_title,specialist_id,status,quantity,updated_at from public.items where (p_platform or tenant_id=p_tenant_id) and public.swish_specialist_niche(specialist_id)=any(v_allowed) order by updated_at desc nulls last limit 50) r;
    elsif p_section='audit' then
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_rows from
        (select id,tenant_id,entity_type,entity_id,action,created_at from public.audit_events where (p_platform or tenant_id=p_tenant_id) order by created_at desc limit 50) r;
    elsif p_section='incidents' then
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_rows from
        (select id,tenant_id,niche_id,function_name,outcome,status_code,error_code,created_at from public.edge_function_logs where (p_platform or tenant_id=p_tenant_id) and status_code>=400 and (p_niche_id is null or niche_id=p_niche_id) order by created_at desc limit 50) r;
    elsif p_section='sync' then
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_rows from
        (select id,tenant_id,sync_type,status,records_fetched,records_created,records_updated,started_at,completed_at from public.ebay_sync_log where (p_platform or tenant_id=p_tenant_id) order by started_at desc limit 50) r;
    elsif p_section='configuration' then
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_rows from
        (select tenant_id,currency,geography,automation_level,min_roi_threshold,min_margin_threshold,onboarding_complete from public.business_config where p_platform or tenant_id=p_tenant_id order by tenant_id limit 50) r;
    else raise exception 'Unsupported inspection section' using errcode='22023'; end if;
    return jsonb_build_object('verifiedOwner',true,'section',p_section,'rows',v_rows,'limit',50,'checkedAt',now(),'readOnly',true);
  end if;
  with scoped_items as materialized (
    select i.*,public.swish_specialist_niche(i.specialist_id) as niche from public.items i
    where (p_platform or i.tenant_id=p_tenant_id) and public.swish_specialist_niche(i.specialist_id)=any(v_allowed)
  ), item_stats as (
    select niche,count(*) as inventory,count(*) filter(where status='sold') as sold,
      count(*) filter(where status in ('review_required','needs_review','review','flagged') or disposition_decision='review') as review
    from scoped_items group by niche
  ), listing_stats as (
    select i.niche,count(distinct l.item_id) filter(where l.status in ('active','live') and l.ended_at is null) as listed_inventory,
      count(*) filter(where l.marketplace_id in ('ebay','EBAY_GB') and l.status in ('active','live') and l.ended_at is null and nullif(l.external_listing_id,'') is not null) as live,
      count(*) filter(where l.status='draft') as drafts,
      sum(l.price*greatest(coalesce(i.quantity,1),0)) filter(where l.status in ('active','live') and l.ended_at is null) as listed_value
    from public.listings l join scoped_items i on i.id=l.item_id and i.tenant_id=l.tenant_id group by i.niche
  ), eligible_sales as materialized (
    select s.*,coalesce(s.niche_id,public.swish_specialist_niche(s.specialist_id),i.niche) as niche,
      row_number() over(partition by s.tenant_id,
        case when nullif(s.external_transaction_id,'') is not null then 'tx:'||s.external_transaction_id||':'||s.item_id::text
          when nullif(s.external_order_id,'') is not null then 'order:'||s.external_order_id||':'||s.item_id::text
          else 'id:'||s.id::text end order by s.sold_at,s.id) as ordinal
    from public.sales s join scoped_items i on i.id=s.item_id and i.tenant_id=s.tenant_id
    where not exists(select 1 from public.orders o where o.tenant_id=s.tenant_id and
      (o.sale_id=s.id or (o.external_order_id=s.external_order_id and o.item_id=s.item_id and nullif(s.external_order_id,'') is not null))
      and (o.status in ('cancelled','canceled','refunded','returned','partially_refunded') or o.fulfilment_status in ('cancelled','canceled','refunded','returned')))
      and not exists(select 1 from public.ebay_returns r where r.tenant_id=s.tenant_id and
        (r.order_id in (select o.id from public.orders o where o.sale_id=s.id) or (r.ebay_order_id=s.external_order_id and nullif(s.external_order_id,'') is not null))
        and (coalesce(r.refund_amount,0)>0 or r.refund_issued_at is not null))
  ), sale_stats as (
    select niche,count(*) filter(where ordinal=1) as completed_sales,
      count(distinct item_id) filter(where ordinal=1 and sold_at>=v_week) as sold_week,
      coalesce(sum(sale_price) filter(where ordinal=1 and sold_at>=v_week),0) as sales_week,
      coalesce(sum(sale_price) filter(where ordinal=1 and sold_at>=v_month),0) as sales_month,
      coalesce(sum(sale_price) filter(where ordinal=1),0) as realised_total,
      count(*) filter(where ordinal>1) as duplicate_sales
    from eligible_sales where niche=any(v_allowed) group by niche
  ), order_stats as (
    select i.niche,count(*) filter(where o.status not in ('cancelled','canceled','refunded','returned','completed','delivered') and
      (o.requires_action is true or o.fulfilment_status in ('awaiting_dispatch','packing','packed'))) as outstanding
    from public.orders o join scoped_items i on i.id=o.item_id and i.tenant_id=o.tenant_id group by i.niche
  ), tenants_in_scope as (
    select distinct tenant_id,niche from scoped_items
    union select p_tenant_id,n from unnest(v_allowed) n where not p_platform
  ), connector_stats as (
    select t.niche,count(c.id) as configured,
      count(c.id) filter(where c.status='connected') as connected,
      count(c.id) filter(where nullif(c.last_error,'') is not null or c.status in ('error','failed') or z.status in ('failed','error','partial','incomplete')) as failed,
      max(z.completed_at) filter(where z.status in ('success','completed')) as last_sync
    from tenants_in_scope t left join public.marketplace_connectors c on c.tenant_id=t.tenant_id and c.marketplace_id='ebay'
    left join lateral (select status,completed_at from public.ebay_sync_log z where z.tenant_id=t.tenant_id order by started_at desc limit 1) z on true group by t.niche
  ), ai_stats as (
    select n.niche,l.outcome,l.status_code,l.created_at from unnest(v_allowed) as n(niche)
    left join lateral (select outcome,status_code,created_at from public.edge_function_logs l where (p_platform or l.tenant_id=p_tenant_id) and l.niche_id=n.niche and l.function_name in ('swish-identify','swish-islamic-identify','swish-market-value') order by created_at desc limit 1) l on true
  ), currencies as (
    select distinct coalesce(nullif(b.currency,''),'UNKNOWN') as currency from
      (select distinct tenant_id from scoped_items) t left join public.business_config b on b.tenant_id=t.tenant_id
  ), module_rows as (
    select n.id,coalesce(i.inventory,0) as inventory,coalesce(i.sold,0) as sold_total,coalesce(i.review,0) as review,
      coalesce(l.listed_inventory,0) as listed_inventory,coalesce(l.live,0) as live,coalesce(l.drafts,0) as drafts,
      coalesce(l.listed_value,0) as listed_value,coalesce(s.sold_week,0) as sold_week,coalesce(s.sales_week,0) as sales_week,
      coalesce(s.sales_month,0) as sales_month,coalesce(s.realised_total,0) as realised_total,coalesce(s.completed_sales,0) as completed_sales,
      coalesce(s.duplicate_sales,0) as duplicate_sales,coalesce(o.outstanding,0) as outstanding,
      case when coalesce(c.failed,0)>0 then 'failed' when coalesce(c.connected,0)=0 then 'not_connected'
        when c.last_sync>now()-interval '24 hours' then 'recorded_success' else 'attention' end as ebay_status,
      c.last_sync as last_sync,
      case when a.status_code>=400 then 'failed' when a.status_code between 200 and 299 and a.created_at>now()-interval '24 hours' then 'recorded_success' else 'unknown' end as ai_status,
      a.created_at as ai_checked_at
    from unnest(v_allowed) as n(id) left join item_stats i on i.niche=n.id left join listing_stats l on l.niche=n.id
    left join sale_stats s on s.niche=n.id left join order_stats o on o.niche=n.id left join connector_stats c on c.niche=n.id left join ai_stats a on a.niche=n.id
  ) select jsonb_build_object(
    'verifiedOwner',v_owner,'scope',case when p_platform then 'platform' else 'tenant' end,
    'tenantId',case when p_platform then null else p_tenant_id end,'checkedAt',now(),'weekStart',v_week,'monthStart',v_month,'timezone','Europe/London',
    'currencies',(select coalesce(jsonb_agg(currency),'[]'::jsonb) from currencies),
    'modules',(select coalesce(jsonb_agg(to_jsonb(m)),'[]'::jsonb) from module_rows m),
    'registeredUsers',case when p_platform then (select count(*) from public.user_profiles) else null end,
    'activeSubscribers',case when p_platform then (select count(distinct user_id) from public.niche_entitlements where expires_at>now()) else null end,
    'subscriptionRevenue',null,
    'aiActivity',(select jsonb_build_object('identifications',count(*) filter(where function_name in ('swish-identify','swish-islamic-identify')),'valuations',count(*) filter(where function_name='swish-market-value'),'failures',count(*) filter(where status_code>=400)) from public.edge_function_logs where (p_platform or tenant_id=p_tenant_id) and niche_id=any(v_allowed) and created_at>=v_week),
    'activity',(select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) from (select tenant_id,niche_id,function_name,outcome,status_code,created_at from public.edge_function_logs where (p_platform or tenant_id=p_tenant_id) and niche_id=any(v_allowed) order by created_at desc limit 12) a),
    'limitations',jsonb_build_array('Listed value is recorded asking price times remaining quantity, not revenue.','Realised sales use the canonical ledger; known cancellations/refunds are excluded. Duplicate external sale identities are counted once. Partial refunds are excluded until reconciled.','Sold this week counts distinct canonical items, not units or order lines.','Currency follows recorded tenant configuration; unknown or mixed currencies cannot be summed as GBP.','eBay and AI signals are dated stored outcomes, not live provider health.','Active subscribers are distinct users with unexpired cached entitlements, not Stripe billing certification. Subscription revenue is unavailable.','Orders without canonical item links and legacy unclassified items are excluded; they require separate reconciliation.')
  ) into v_result;
  return v_result;
end;
$$;
-- Default PUBLIC execute is removed on the NEW function only. Existing grants unchanged.
revoke all on function public.swish_command_snapshot(uuid,boolean,text,text) from public, anon;
grant execute on function public.swish_command_snapshot(uuid,boolean,text,text) to authenticated;
comment on function public.swish_command_snapshot(uuid,boolean,text,text) is 'Read-only canonical portfolio and bounded owner inspectors. No credential fields or module changes.';
