-- Optional auction-page links. Preserve account/niche RLS and all existing records.
alter table public.watched_lots add column if not exists auction_url text
  check (auction_url is null or (length(auction_url) between 12 and 2048
    and auction_url ~ '^https://[a-zA-Z0-9.-]+(:[0-9]{1,5})?([/?#][^[:space:]\\]*)?$'
    and auction_url !~ '[[:cntrl:]]'));
