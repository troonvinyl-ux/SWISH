-- Add Collectibles Flipper to the existing paid-niche authorization model.
-- No new tables, database, auth system or item migration.
begin;

alter table public.niche_entitlements
  drop constraint if exists niche_entitlement_known_product;
alter table public.niche_entitlements
  add constraint niche_entitlement_known_product
  check (niche_id in ('coins','motocross','bicycles','clothing','trading_cards','antiques','fossils','beauty','tech','surplus_flip','collectibles'));

create or replace function public.swish_specialist_niche(p_specialist text)
returns text language sql immutable set search_path=pg_catalog,public as $$
  select niche from (values
    ('coins','coins'),('islamic_silver','coins'),('banknotes','coins'),('gold','coins'),('silver','coins'),('jewellery_precious_metals','coins'),('ancient_artefacts','coins'),('coins_uk','coins'),('coins_world','coins'),('coins_currency','coins'),('numismatic','coins'),
    ('motocross','motocross'),('mx','motocross'),('bicycles','bicycles'),('bikes','bicycles'),('cycling','bicycles'),
    ('clothing','clothing'),('trainers_sneakers','clothing'),('clothing_specialist','clothing'),('threads','clothing'),('threads_flip','clothing'),
    ('pokemon_cards','trading_cards'),('trading_cards','trading_cards'),('cards','trading_cards'),
    ('antiques','antiques'),('books','antiques'),('fossils','fossils'),('beauty','beauty'),('tech','tech'),('retro_games','tech'),('retro_consoles','tech'),
    ('surplus_trader','surplus_flip'),('surplus_flip','surplus_flip'),('collectibles','collectibles')
  ) as mapping(specialist,niche) where specialist=p_specialist;
$$;

-- The entitlement snapshot limit must include all eleven registered niches.
create or replace function public.swish_cache_verified_niches(p_user_id uuid,p_checked_at timestamptz,p_grants jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_last timestamptz; v_grant jsonb;
begin
  if p_user_id is null or p_checked_at is null or p_checked_at>clock_timestamp()+interval '5 seconds'
    or jsonb_typeof(p_grants) is distinct from 'array' or jsonb_array_length(p_grants)>11 then
    raise exception 'Invalid verified entitlement snapshot' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('swish_entitlements:'||p_user_id::text,0));
  select checked_at into v_last from public.niche_entitlement_checks where user_id=p_user_id;
  if v_last is not null and v_last>=p_checked_at then return true; end if;
  for v_grant in select value from jsonb_array_elements(p_grants) loop
    if public.swish_specialist_niche(v_grant->>'niche_id') is distinct from (v_grant->>'niche_id')
      or (v_grant->>'expires_at')::timestamptz<=p_checked_at
      or (v_grant->>'expires_at')::timestamptz>p_checked_at+interval '5 minutes' then
      raise exception 'Invalid entitlement validity' using errcode='22023';
    end if;
  end loop;
  update public.niche_entitlements set expires_at=p_checked_at,checked_at=p_checked_at where user_id=p_user_id;
  for v_grant in select value from jsonb_array_elements(p_grants) loop
    insert into public.niche_entitlements(user_id,niche_id,expires_at,checked_at)
      values(p_user_id,v_grant->>'niche_id',(v_grant->>'expires_at')::timestamptz,p_checked_at)
      on conflict(user_id,niche_id) do update set expires_at=excluded.expires_at,checked_at=excluded.checked_at;
  end loop;
  insert into public.niche_entitlement_checks(user_id,checked_at) values(p_user_id,p_checked_at)
    on conflict(user_id) do update set checked_at=excluded.checked_at;
  return true;
end;
$$;

commit;
