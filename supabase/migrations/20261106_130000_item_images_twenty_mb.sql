-- SWISH: allow high-resolution original product photographs without re-encoding.
-- Keep the existing public item-images bucket, MIME allow-list and Storage policies.
-- The client verifies original bytes before accepting the immutable content-addressed URL.

begin;

update storage.buckets
set file_size_limit = 20971520
where id = 'item-images';

do $$
begin
  if not exists (
    select 1 from storage.buckets
    where id = 'item-images' and file_size_limit >= 20971520
  ) then
    raise exception 'item-images bucket was not found or its 20 MB limit could not be applied';
  end if;
end $$;

commit;
