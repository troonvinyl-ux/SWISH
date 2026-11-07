-- Read-only export safety verification. No provider calls, JWT impersonation or user-data writes.
begin;
do $test$
begin
 if has_function_privilege('anon','public.swish_performance_export()','execute') then raise exception 'Anonymous export execute must be denied';end if;
 if not has_function_privilege('authenticated','public.swish_performance_export()','execute') then raise exception 'Missing authenticated RPC entry';end if;
 if auth.uid() is not null then raise exception 'Run negative checks without a signed-in session';end if;
 begin
  perform public.swish_performance_export();
  raise exception 'No-session export unexpectedly allowed';
 exception when insufficient_privilege then null;
 end;
end $test$;
-- Administrative SELECT compilation is not an owner JWT/device acceptance result.
do $aggregate$
declare d text;q text;r jsonb;
begin
 select prosrc into d from pg_proc where oid='public.swish_performance_export()'::regprocedure;
 q:=substring(d from position('with edge_rows as materialized (' in d));
 q:=substring(q from 1 for position(' into result;' in q)-1);
 if length(q)<1000 or q ~* '\m(insert|update|delete|truncate)\M' then raise exception 'Unreviewed export SELECT';end if;
 execute q into r;
 if r->>'version' is distinct from 'swish-performance-export-v1' then raise exception 'Missing export contract';end if;
 if r::text ~ 'access_token|credential|canonical_title|image_urls|snapshot_path' then raise exception 'Sensitive output';end if;
 if (r->'captureToLive'->>'samples')::integer=0 and (r->'captureToLive'->>'medianMs' is not null or r->'captureToLive'->>'p90Ms' is not null) then raise exception 'Empty timings must stay null';end if;
end $aggregate$;
rollback;
