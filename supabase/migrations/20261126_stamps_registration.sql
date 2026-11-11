-- Stamp Flipper schema registration. Preserves every user, item, listing, membership and billing record.
-- Mapping/quota/snapshot changes were applied in the editor; this migration is idempotent.
-- Entitlement CHECK replacement requires authorised migration deployment; it is not run via the editor SQL tool.
begin;
do $migration$
declare v_definition text;v_updated text;v_constraint record;
begin
 v_definition:=pg_get_functiondef('public.swish_specialist_niche(text)'::regprocedure);
 if public.swish_specialist_niche('stamps') is distinct from 'stamps' then
  v_updated:=regexp_replace(v_definition,'\(values','(values (''stamps'',''stamps''),','i');
  if v_updated=v_definition then raise exception 'Unrecognized specialist mapping';end if;
  execute v_updated;
 end if;
 v_definition:=pg_get_functiondef('public.swish_cache_verified_niches(uuid,timestamptz,jsonb)'::regprocedure);
 v_updated:=regexp_replace(v_definition,'jsonb_array_length\(p_grants\)\s*>\s*(10|11|12)(\D)','jsonb_array_length(p_grants)>13\2','g');
 if v_updated=v_definition and v_definition !~ 'jsonb_array_length\(p_grants\)\s*>\s*13' then raise exception 'Unrecognized quota bound';end if;
 if v_updated<>v_definition then execute v_updated;end if;
 v_definition:=pg_get_functiondef('public.swish_command_snapshot(uuid,boolean,text,text)'::regprocedure);
 if position('''stamps''' in v_definition)=0 then
  v_updated:=replace(v_definition,'''collectibles'',''tunes_flip'']','''collectibles'',''tunes_flip'',''stamps'']');
  if v_updated=v_definition then raise exception 'Unrecognized command registry';end if;
  execute v_updated;
 end if;
 if not exists(select 1 from pg_constraint where conrelid='public.niche_entitlements'::regclass and conname='niche_entitlement_known_product_stamps') then
  alter table public.niche_entitlements add constraint niche_entitlement_known_product_stamps
  check(niche_id in ('coins','motocross','bicycles','clothing','trading_cards','antiques','fossils','beauty','tech','surplus_flip','collectibles','tunes_flip','stamps')) not valid;
 end if;
 alter table public.niche_entitlements validate constraint niche_entitlement_known_product_stamps;
 for v_constraint in select conname from pg_constraint where conrelid='public.niche_entitlements'::regclass and contype='c'
  and conname in ('niche_entitlement_known_product','niche_entitlement_known_product_unified') loop
  -- Schema-only constraint replacement, not data deletion. The validated 13-product CHECK remains enforced.
  execute format('alter table public.niche_entitlements drop constraint %I',v_constraint.conname);
 end loop;
end $migration$;
notify pgrst,'reload schema';
commit;
