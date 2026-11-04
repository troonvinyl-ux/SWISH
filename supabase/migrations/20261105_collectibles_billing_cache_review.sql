-- REVIEWED SOURCE ONLY: extend the existing billing cache to eleven canonical niches.
-- Not executed by the editor SQL tool: replacing the old CHECK requires authorized migration execution.
-- Constraint replacement does not delete inventory, account records or existing entitlements.
begin;
alter table public.niche_entitlements add constraint niche_entitlement_known_product_unified
check(niche_id in ('coins','motocross','bicycles','clothing','trading_cards','antiques','fossils','beauty','tech','surplus_flip','collectibles')) not valid;
alter table public.niche_entitlements validate constraint niche_entitlement_known_product_unified;
-- Remove only the superseded ten-product constraint after replacement validation succeeds.
alter table public.niche_entitlements drop constraint niche_entitlement_known_product;
create or replace function public.swish_cache_verified_niches(p_user_id uuid,p_checked_at timestamptz,p_grants jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_last timestamptz; v_grant jsonb;
begin
 if p_user_id is null or p_checked_at is null or p_checked_at>clock_timestamp()+interval '5 seconds' or jsonb_typeof(p_grants) is distinct from 'array' or jsonb_array_length(p_grants)>11 then raise exception 'Invalid verified entitlement snapshot' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('swish_entitlements:'||p_user_id::text,0));
 select checked_at into v_last from public.niche_entitlement_checks where user_id=p_user_id;
 if v_last is not null and v_last>=p_checked_at then return true; end if;
 for v_grant in select value from jsonb_array_elements(p_grants) loop
  if public.swish_specialist_niche(v_grant->>'niche_id') is distinct from (v_grant->>'niche_id') or (v_grant->>'expires_at')::timestamptz<=p_checked_at or (v_grant->>'expires_at')::timestamptz>p_checked_at+interval '5 minutes' then raise exception 'Invalid entitlement validity' using errcode='22023'; end if;
 end loop;
 -- Only verified server billing refreshes expire/reconcile cache entries; never invoked by this task.
 update public.niche_entitlements set expires_at=p_checked_at,checked_at=p_checked_at where user_id=p_user_id;
 for v_grant in select value from jsonb_array_elements(p_grants) loop
  insert into public.niche_entitlements(user_id,niche_id,expires_at,checked_at) values(p_user_id,v_grant->>'niche_id',(v_grant->>'expires_at')::timestamptz,p_checked_at)
  on conflict(user_id,niche_id) do update set expires_at=excluded.expires_at,checked_at=excluded.checked_at;
 end loop;
 insert into public.niche_entitlement_checks(user_id,checked_at) values(p_user_id,p_checked_at) on conflict(user_id) do update set checked_at=excluded.checked_at;
 return true;
end; $$;
revoke all on function public.swish_cache_verified_niches(uuid,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.swish_cache_verified_niches(uuid,timestamptz,jsonb) to service_role;
commit;
