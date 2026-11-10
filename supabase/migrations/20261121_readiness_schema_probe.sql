-- Owner-only schema diagnostics for S1/S3/S7; no data changes or entitlement grants.
create or replace function public.swish_readiness_schema_probe()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_missing text[]; v_rls boolean; v_limit bigint;
begin
 if auth.uid() is null or not public.swish_is_platform_owner() then raise exception 'Trusted owner required' using errcode='42501'; end if;
 select coalesce(array_agg(niche),'{}'::text[]) into v_missing from unnest(array['coins','motocross','bicycles','clothing','trading_cards','antiques','fossils','beauty','tech','surplus_flip','collectibles','tunes_flip']) as niche
 where exists(select 1 from pg_constraint c where c.conrelid='public.niche_entitlements'::regclass and c.contype='c' and pg_get_constraintdef(c.oid) like '%niche_id%' and pg_get_constraintdef(c.oid) like '%ANY%' and position(quote_literal(niche) in pg_get_constraintdef(c.oid))=0);
 select count(*)=4 and bool_and(relrowsecurity) into v_rls from pg_class where oid in ('public.items'::regclass,'public.listings'::regclass,'public.orders'::regclass,'public.sales'::regclass);
 select file_size_limit into v_limit from storage.buckets where id='item-images';
 return jsonb_build_object('inventoryRls',coalesce(v_rls,false),'unsupportedNiches',v_missing,'imageBucketLimit',v_limit,'readOnly',true);
end;$$;
revoke all on function public.swish_readiness_schema_probe() from public,anon;
grant execute on function public.swish_readiness_schema_probe() to authenticated;
notify pgrst,'reload schema';
