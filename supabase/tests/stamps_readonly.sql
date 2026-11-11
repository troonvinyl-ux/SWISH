-- Read-only Stamp Flipper deployment checks. No entitlement grants, seller calls or user-data changes.
select public.swish_specialist_niche('stamps') as stamps_owner,
       public.swish_specialist_niche('coins') as coins_owner,
       public.swish_specialist_niche('collectibles') as collectibles_owner;
select pg_get_functiondef('public.swish_cache_verified_niches(uuid,timestamptz,jsonb)'::regprocedure)
       ~ 'jsonb_array_length\(p_grants\)\s*>\s*13' as cache_accepts_thirteen;
select position('''stamps''' in pg_get_functiondef('public.swish_command_snapshot(uuid,boolean,text,text)'::regprocedure)) > 0
       as command_snapshot_registered;
-- Every enforced product CHECK must allow Stamps; an old 10-product CHECK means subscriber rollout is still blocked.
select conname, pg_get_constraintdef(oid) as definition,
       position('''stamps''' in pg_get_constraintdef(oid)) > 0 as includes_stamps
from pg_constraint where conrelid='public.niche_entitlements'::regclass and contype='c';
-- Preserve authenticated-only module activation and service-only entitlement cache writes.
select has_function_privilege('authenticated','public.swish_open_module(uuid,text)','execute') as authenticated_module_activation,
       has_function_privilege('anon','public.swish_open_module(uuid,text)','execute') as anonymous_module_activation,
       has_function_privilege('authenticated','public.swish_cache_verified_niches(uuid,timestamptz,jsonb)','execute') as client_can_write_entitlements;
