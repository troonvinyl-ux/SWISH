-- Read-only deployment acceptance. Does not impersonate users, grant access or mutate fixtures.
begin read only;
select 'oauth_stage_server_only' as check_name,
 exists(select 1 from information_schema.columns where table_schema='public' and table_name='oauth_sessions' and column_name='pending_credential_ref')
 and not has_table_privilege('authenticated','public.oauth_sessions','select') as passed;
select 'order_boundary_present' as check_name,
 (select count(*)=3 from pg_policies where schemaname='public' and tablename='orders' and policyname like 'authenticated_%_paid_order_resource') as passed;
select 'telemetry_rls' as check_name,(select relrowsecurity from pg_class where oid=to_regclass('public.edge_function_logs')) as passed;
select 'collectibles_mapping' as check_name,public.swish_specialist_niche('collectibles')='collectibles' as passed;
select 'canonical_sale_metadata' as check_name,
 (select count(*)=3 from information_schema.columns where table_schema='public' and table_name='sales' and column_name in ('niche_id','specialist_id','category_id')) as passed;
rollback;
