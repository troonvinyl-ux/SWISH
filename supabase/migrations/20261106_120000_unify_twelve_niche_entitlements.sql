-- SWISH: reconcile the canonical 12-niche specialist and entitlement registry.
-- Preserves existing entitlement rows, users, inventory, credentials, RLS and grants.
-- Does not create entitlement grants or alter Stripe billing state.

begin;

-- Make the database's canonical specialist resolver agree with the current
-- application/Edge Function registry. Keep legacy aliases mapped to their
-- owning niche; Collectibles and Tunes Flip each retain one canonical identity.
create or replace function public.swish_specialist_niche(p_specialist text)
returns text language sql immutable set search_path=pg_catalog,public as $$
 select niche from (values
  ('coins','coins'),('islamic_silver','coins'),('banknotes','coins'),('gold','coins'),('silver','coins'),('jewellery_precious_metals','coins'),('ancient_artefacts','coins'),('coins_uk','coins'),('coins_world','coins'),('coins_currency','coins'),('numismatic','coins'),
  ('motocross','motocross'),('mx','motocross'),
  ('bicycles','bicycles'),('bikes','bicycles'),('cycling','bicycles'),
  ('clothing','clothing'),('trainers_sneakers','clothing'),('clothing_specialist','clothing'),('threads','clothing'),('threads_flip','clothing'),
  ('pokemon_cards','trading_cards'),('trading_cards','trading_cards'),('cards','trading_cards'),
  ('antiques','antiques'),('books','antiques'),
  ('fossils','fossils'),('beauty','beauty'),
  ('tech','tech'),('retro_games','tech'),('retro_consoles','tech'),
  ('surplus_trader','surplus_flip'),('surplus_flip','surplus_flip'),
  ('collectibles','collectibles'),
  ('vinyl_records','tunes_flip'),('tunes_flip','tunes_flip')
 ) as mapping(specialist,niche) where specialist=p_specialist;
$$;

do $migration$
declare
  v_constraint_def text;
  v_definition text;
  v_updated text;
begin
  -- Ensure the unified constraint is the complete current 12-niche allow-list.
  select pg_get_constraintdef(oid) into v_constraint_def
  from pg_constraint
  where conrelid='public.niche_entitlements'::regclass
    and conname='niche_entitlement_known_product_unified';

  if v_constraint_def is not null
     and (position('tunes_flip' in v_constraint_def)=0
       or position('collectibles' in v_constraint_def)=0) then
    alter table public.niche_entitlements
      drop constraint niche_entitlement_known_product_unified;
    v_constraint_def := null;
  end if;

  if v_constraint_def is null then
    alter table public.niche_entitlements
      add constraint niche_entitlement_known_product_unified
      check (niche_id in (
        'coins','motocross','bicycles','clothing','trading_cards','antiques',
        'fossils','beauty','tech','surplus_flip','collectibles','tunes_flip'
      )) not valid;
  end if;

  alter table public.niche_entitlements
    validate constraint niche_entitlement_known_product_unified;

  -- Drop the superseded legacy CHECK only after the replacement validates.
  if exists (
    select 1 from pg_constraint
    where conrelid='public.niche_entitlements'::regclass
      and conname='niche_entitlement_known_product'
  ) then
    alter table public.niche_entitlements
      drop constraint niche_entitlement_known_product;
  end if;

  -- Extend the existing server-only entitlement snapshot limit from 11 to 12.
  -- All other function logic and its existing EXECUTE grants are preserved.
  v_definition := pg_get_functiondef(
    'public.swish_cache_verified_niches(uuid,timestamptz,jsonb)'::regprocedure
  );
  v_updated := replace(v_definition,'jsonb_array_length(p_grants)>11',
                                   'jsonb_array_length(p_grants)>12');
  v_updated := replace(v_updated,'jsonb_array_length(p_grants) > 11',
                                   'jsonb_array_length(p_grants) > 12');
  if v_updated=v_definition
     and position('jsonb_array_length(p_grants)>12' in v_definition)=0
     and position('jsonb_array_length(p_grants) > 12' in v_definition)=0 then
    raise exception 'Entitlement cache limit differs from reviewed definition; inspect before applying';
  end if;
  if v_updated<>v_definition then execute v_updated; end if;

  -- Extend the existing read-only command snapshot's canonical list.
  v_definition := pg_get_functiondef(
    'public.swish_command_snapshot(uuid,boolean,text,text)'::regprocedure
  );
  v_updated := replace(v_definition,
    '''surplus_flip'',''collectibles'']',
    '''surplus_flip'',''collectibles'',''tunes_flip'']');
  if v_updated=v_definition and position('''tunes_flip''' in v_definition)=0 then
    raise exception 'Command snapshot registry differs from reviewed definition; inspect before applying';
  end if;
  if v_updated<>v_definition then execute v_updated; end if;
end
$migration$;

notify pgrst,'reload schema';

commit;
