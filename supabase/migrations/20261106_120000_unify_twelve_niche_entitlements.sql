-- SWISH: reconcile canonical niche entitlements after Collectibles and Tunes Flip registration.
-- Safe additive migration: preserves all existing entitlement rows, users, inventory and grants.
-- Does not create entitlement grants or alter Stripe billing state.

begin;

do $migration$
declare
  v_constraint text;
  v_definition text;
  v_updated text;
begin
  -- Replace the legacy product CHECK only after installing and validating the current
  -- canonical 12-niche CHECK. Existing rows are not rewritten or deleted.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.niche_entitlements'::regclass
      and conname = 'niche_entitlement_known_product_unified'
  ) then
    alter table public.niche_entitlements
      add constraint niche_entitlement_known_product_unified
      check (niche_id in (
        'coins','motocross','bicycles','clothing','trading_cards','antiques',
        'fossils','beauty','tech','surplus_flip','collectibles','tunes_flip'
      )) not valid;
  end if;

  alter table public.niche_entitlements
    validate constraint niche_entitlement_known_product_unified;

  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.niche_entitlements'::regclass
      and conname = 'niche_entitlement_known_product'
  ) then
    alter table public.niche_entitlements
      drop constraint niche_entitlement_known_product;
  end if;

  -- The server-only verified entitlement cache must accept the same 12 canonical
  -- products. Modify the existing function in place; preserve its locking,
  -- validation, expiry reconciliation, SECURITY DEFINER and grants.
  v_definition := pg_get_functiondef(
    'public.swish_cache_verified_niches(uuid,timestamp with time zone,jsonb)'::regprocedure
  );
  v_updated := replace(v_definition, 'jsonb_array_length(p_grants)>11',
                                    'jsonb_array_length(p_grants)>12');
  v_updated := replace(v_updated, 'jsonb_array_length(p_grants) > 11',
                                    'jsonb_array_length(p_grants) > 12');
  if v_updated = v_definition and position('jsonb_array_length(p_grants)>12' in v_definition) = 0
     and position('jsonb_array_length(p_grants) > 12' in v_definition) = 0 then
    raise exception 'Entitlement cache limit did not match the reviewed 11-niche definition; inspect before applying';
  end if;
  if v_updated <> v_definition then execute v_updated; end if;

  -- Keep the existing read-only command snapshot registry aligned with the
  -- canonical server registry. Do not change its access checks or output.
  v_definition := pg_get_functiondef(
    'public.swish_command_snapshot(uuid,boolean,text,text)'::regprocedure
  );
  v_updated := replace(
    v_definition,
    '''surplus_flip'',''collectibles'']',
    '''surplus_flip'',''collectibles'',''tunes_flip'']'
  );
  if v_updated = v_definition
     and position('''tunes_flip''' in v_definition) = 0 then
    raise exception 'Command snapshot niche registry did not match the reviewed 11-niche definition; inspect before applying';
  end if;
  if v_updated <> v_definition then execute v_updated; end if;
end
$migration$;

notify pgrst, 'reload schema';

commit;
