-- Prepared registration extension for the existing backend; not executed by this editor.
-- IMPORTANT: existing niche_entitlement_known_product must be replaced through an
-- owner-controlled reviewed migration. Do not execute this file alone as proof of paid access.
-- No item reclassification, credential changes or entitlement grants are performed here.
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
-- Recovery: retain the previous function definition and constraint before the reviewed
-- migration. Existing data is preserved. Expanding the known-product check and the
-- server-only snapshot limit from ten to eleven must preserve all existing grants.
