-- Durable niche attribution for SWISH's own eBay sales history.
-- This augments the existing sales ledger; it does not create a second ledger.
-- Values are nullable so historical/unmatched records remain valid and are never guessed.

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS niche_id text,
  ADD COLUMN IF NOT EXISTS specialist_id text,
  ADD COLUMN IF NOT EXISTS category_id text;

CREATE INDEX IF NOT EXISTS sales_tenant_niche_sold_at_idx
  ON public.sales (tenant_id, niche_id, sold_at);

-- Backfill only from explicit existing item/listing relationships.
-- Ambiguous or unknown specialists remain NULL rather than being assigned by guesswork.
UPDATE public.sales AS s
SET
  specialist_id = COALESCE(s.specialist_id, i.specialist_id),
  category_id = COALESCE(s.category_id, l.category_id::text),
  niche_id = COALESCE(
    s.niche_id,
    CASE
      WHEN i.specialist_id IN ('coins', 'islamic_silver', 'banknotes', 'gold', 'silver',
        'jewellery_precious_metals', 'ancient_artefacts', 'coins_uk', 'coins_world',
        'coins_currency', 'numismatic') THEN 'coins'
      WHEN i.specialist_id IN ('motocross', 'mx') THEN 'motocross'
      WHEN i.specialist_id IN ('bicycles', 'bikes', 'cycling') THEN 'bicycles'
      WHEN i.specialist_id IN ('clothing', 'trainers_sneakers', 'clothing_specialist',
        'threads', 'threads_flip') THEN 'clothing'
      WHEN i.specialist_id IN ('pokemon_cards', 'trading_cards', 'cards') THEN 'trading_cards'
      WHEN i.specialist_id IN ('antiques', 'books') THEN 'antiques'
      WHEN i.specialist_id = 'fossils' THEN 'fossils'
      WHEN i.specialist_id = 'beauty' THEN 'beauty'
      WHEN i.specialist_id IN ('tech', 'retro_games', 'retro_consoles') THEN 'tech'
      WHEN i.specialist_id IN ('surplus_trader', 'surplus_flip') THEN 'surplus_flip'
      ELSE NULL
    END
  )
FROM public.items AS i
LEFT JOIN public.listings AS l
  ON l.id = s.listing_id
 AND l.tenant_id = s.tenant_id
WHERE i.id = s.item_id
  AND i.tenant_id = s.tenant_id
  AND (s.specialist_id IS NULL OR s.category_id IS NULL OR s.niche_id IS NULL);
