-- Run only in a transaction with approved authenticated test JWT context.
-- No fixture creation, inventory writes, seller calls or credential reads.
begin;
select has_function_privilege('anon','public.swish_open_module(uuid,text)','execute') as anonymous_can_activate_module;
select has_table_privilege('authenticated','public.swish_platform_owners','insert') as client_can_grant_owner;
select has_table_privilege('authenticated','public.swish_module_sessions','update') as client_can_edit_scope;
select has_function_privilege('authenticated','public.swish_owner_for_user(uuid)','execute') as client_can_query_arbitrary_owner;
-- Owner/operator supplies real JWT context in the authorized test harness, not hardcoded identities.
-- After module activation, query public.items as authenticated and compare each returned
-- specialist's canonical niche to public.swish_current_module()->>'niche_id'.
-- Repeat Coins/Threads and all-membership sessions; missing JWT/scope is NOT a test pass.
rollback;
