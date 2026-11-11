-- Read-only acceptance: supply an authenticated trusted-owner JWT/session externally.
-- Open a niche first. Never changes module sessions, rows, marketplace state or photos.
begin;
set local statement_timeout='10s';
set local role authenticated;
do $test$
declare m jsonb:=public.swish_current_module(); c jsonb; h jsonb; s jsonb; r jsonb; n bigint; denied boolean:=false; other_niche text;
begin
 if m is null or not public.swish_is_platform_owner() then raise exception 'Open a niche in a verified owner session before this read-only test'; end if;
 c:=public.swish_inventory_tab_counts((m->>'tenant_id')::uuid,m->>'niche_id');
 h:=public.swish_niche_listing_metrics((m->>'tenant_id')::uuid,m->>'niche_id');
 s:=public.swish_command_snapshot((m->>'tenant_id')::uuid,false);
 select x into r from jsonb_array_elements(s->'modules') x where x->>'id'=m->>'niche_id';
 if r->'inventory' is distinct from c->'total' or r->'stock_total' is distinct from c->'stock'
   or r->'drafts' is distinct from c->'draft' or r->'live' is distinct from c->'live_listings'
   or r->'sold_total' is distinct from c->'sold' or h->'inventory_counts' is distinct from c then
   raise exception 'Current-workspace inventory/report/Hub parity failed';
 end if;
 select sum((x->>'inventory')::bigint) into n from jsonb_array_elements(s->'modules') x;
 if (s->'canonicalCounts'->>'total')::bigint<>n+(s->>'unclassifiedInventory')::bigint then raise exception 'Unclassified workspace history was not preserved'; end if;
 begin perform public.swish_niche_listing_metrics('00000000-0000-4000-8000-000000000001',m->>'niche_id'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Other-workspace count was not denied'; end if;
 denied:=false;
 other_niche:=case when m->>'niche_id'='coins' then 'tech' else 'coins' end;
 begin perform public.swish_niche_listing_metrics((m->>'tenant_id')::uuid,other_niche); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Inactive-module count was not denied'; end if;
 if has_function_privilege('anon','public.swish_niche_listing_metrics(uuid,text)','execute') then raise exception 'Anonymous count access exposed'; end if;
 if (select prosecdef from pg_proc where oid='public.swish_niche_listing_metrics(uuid,text)'::regprocedure) then raise exception 'Listing count RPC must be invoker RLS'; end if;
end $test$;
select 'passed: scoped counts, retained history and authorization denials' as outcome;
rollback;
