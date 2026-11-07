-- Read-only installed niche isolation assertions. No stock creation, JWT impersonation or provider calls.
do $checks$
declare resource text;policy_total bigint;
begin
 if public.swish_specialist_niche('collectibles') is distinct from 'collectibles' then raise exception 'Collectibles identity drift';end if;
 if public.swish_specialist_niche('coins') is distinct from 'coins' then raise exception 'Coin identity drift';end if;
 if public.swish_specialist_niche('curiosities_collectibles') is not null then raise exception 'Generic catch-all owns production stock';end if;
 if exists(select 1 from public.listings l join public.items i on i.id=l.item_id where l.tenant_id<>i.tenant_id) then raise exception 'Cross-tenant listing link';end if;
 if exists(select 1 from public.swish_inventory_canonical_rows group by tenant_id,item_id having count(*)>1) then raise exception 'Duplicate canonical projection';end if;
 foreach resource in array array['item_lifecycle_events','listing_verifications','shipments'] loop
  select count(*) into policy_total from pg_policies where schemaname='public' and tablename=resource and permissive='RESTRICTIVE' and policyname like 'authenticated_%_active_niche_parent';
  if policy_total<>4 then raise exception 'Missing parent policy for %',resource;end if;
 end loop;
 if auth.uid() is null and (public.swish_can_access_niche('00000000-0000-0000-0000-000000000001','coins') is true or public.swish_can_access_niche('00000000-0000-0000-0000-000000000001','collectibles') is true) then raise exception 'No-session niche access';end if;
end $checks$;
select public.swish_specialist_niche(specialist_id) niche,count(*) canonical_items,count(*) filter(where coalesce(cardinality(media),0)>0) with_media from public.items group by 1 order by 1;
-- The admin SELECT above observes existing records only. It is not a subscriber-role/device test.
