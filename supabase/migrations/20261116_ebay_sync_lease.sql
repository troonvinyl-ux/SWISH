-- Reuse existing ebay_sync_log for account-wide overlap protection; no new queue/table.
-- Only the server may claim after existing moduleScope checks. No user data is changed by this migration.
begin;
create or replace function public.swish_claim_ebay_sync(p_tenant_id uuid,p_run_id uuid,p_niche_id text,p_mode text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public set statement_timeout='5s' as $$
declare previous public.ebay_sync_log%rowtype;active_run public.ebay_sync_log%rowtype;
begin
 if p_tenant_id is null or p_run_id is null or p_niche_id is null or p_mode not in ('full','data_only','refresh_token_only') then raise exception 'Invalid sync identity' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('swish-ebay-sync:'||p_tenant_id::text,0));
 select * into previous from public.ebay_sync_log where id=p_run_id;
 if found then
  if previous.tenant_id is distinct from p_tenant_id or previous.metadata->>'nicheId' is distinct from p_niche_id or previous.metadata->>'mode' is distinct from p_mode then raise exception 'Sync identity scope differs' using errcode='42501';end if;
  if previous.status='completed' and previous.metadata ? 'result' then return jsonb_build_object('acquired',false,'replay',true,'result',previous.metadata->'result');end if;
  return jsonb_build_object('acquired',false,'replay',false,'retryAfterMs',3000,'previous',true);
 end if;
 select * into active_run from public.ebay_sync_log where tenant_id=p_tenant_id and sync_type='inventory_v2' and status='running' and started_at>now()-interval '180 seconds' order by started_at desc limit 1;
 if found then return jsonb_build_object('acquired',false,'replay',false,'retryAfterMs',greatest(1000,ceil(extract(epoch from active_run.started_at+interval '180 seconds'-now())*1000))::bigint);end if;
 insert into public.ebay_sync_log(id,tenant_id,sync_type,status,metadata) values(p_run_id,p_tenant_id,'inventory_v2','running',jsonb_build_object('nicheId',p_niche_id,'mode',p_mode,'leaseSeconds',180));
 return jsonb_build_object('acquired',true,'replay',false);
end;$$;
revoke all on function public.swish_claim_ebay_sync(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.swish_claim_ebay_sync(uuid,uuid,text,text) to service_role;
notify pgrst,'reload schema';
commit;
