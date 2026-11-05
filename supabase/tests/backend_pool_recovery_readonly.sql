-- Live SQL verification. Read-only: no users, modules, inventory or entitlements changed.
-- Authenticated-role simulations use an existing stored module session only inside this transaction.
begin;
set local statement_timeout='8s';
select jsonb_build_object('items',count(*),'hash',md5(string_agg(to_jsonb(i)::text,'|' order by id))) from public.items i;
select application_name,state,count(*) as connections,max(now()-query_start) as oldest_query from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() group by application_name,state;
select name,setting from pg_settings where name in ('max_connections','statement_timeout','idle_in_transaction_session_timeout');
select niche,(select count(*) from public.items i where swish_specialist_niche(i.specialist_id)=niche) as items,(select count(*) from public.swish_inventory_tab_rows v where swish_specialist_niche(v.specialist_id)=niche) as projection_rows from unnest(array['antiques','coins','clothing','motocross','bicycles','surplus_flip','trading_cards','fossils','beauty','tech','collectibles']) niche;
-- Multiple listing rows are not duplicate physical items. All cards still use items.id.
explain (analyze,buffers) select count(*) from public.swish_inventory_tab_rows where tenant_id='53d169c0-8d37-4378-b8ef-84fbb3991661' and specialist_id in ('antiques','books') and inventory_tab='live';
select set_config('request.jwt.claims',(select jsonb_build_object('sub',user_id,'role','authenticated','session_id',session_id)::text from public.swish_module_sessions where niche_id='antiques' and tenant_id='53d169c0-8d37-4378-b8ef-84fbb3991661' order by updated_at desc limit 1),true) is not null as simulation_ready;
set local role authenticated;
select swish_can_access_niche('53d169c0-8d37-4378-b8ef-84fbb3991661','antiques') as authorized,swish_inventory_tab_counts('53d169c0-8d37-4378-b8ef-84fbb3991661','antiques') as tabs,swish_inventory_status_counts('53d169c0-8d37-4378-b8ef-84fbb3991661',array['antiques','books']) as statuses;
select count(*) as cross_niche_visible from public.items where swish_specialist_niche(specialist_id) is distinct from 'antiques';
select count(*) as cross_tenant_visible from public.items where tenant_id<>'53d169c0-8d37-4378-b8ef-84fbb3991661';
rollback;
-- The transaction timeout is diagnostic only, not a deployment of managed PostgREST timeout settings.
