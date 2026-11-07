-- Schema-only child-resource isolation: preserve tenant policies and service-role workflows.
-- Parent queries use caller RLS; no production rows, ownership or media are changed.
begin;
set local lock_timeout='5s';
do $migration$
declare table_name text;operation text;policy_name text;predicate text;
begin
 for table_name in select unnest(array['item_lifecycle_events','listing_verifications','shipments']) loop
  predicate:=case table_name
   when 'item_lifecycle_events' then 'exists(select 1 from public.items i where i.id=item_lifecycle_events.item_id and i.tenant_id=item_lifecycle_events.tenant_id)'
   when 'listing_verifications' then 'exists(select 1 from public.items i where i.tenant_id=listing_verifications.tenant_id and (i.id=listing_verifications.item_id or (listing_verifications.item_id is null and exists(select 1 from public.listings l where l.id=listing_verifications.listing_id and l.item_id=i.id and l.tenant_id=i.tenant_id))) and (listing_verifications.listing_id is null or exists(select 1 from public.listings l where l.id=listing_verifications.listing_id and l.item_id=i.id and l.tenant_id=i.tenant_id)))'
   when 'shipments' then 'exists(select 1 from public.orders o where o.id=shipments.order_id and o.tenant_id=shipments.tenant_id)'
  end;
  for operation in select unnest(array['select','insert','update','delete']) loop
   policy_name:='authenticated_'||operation||'_active_niche_parent';
   if not exists(select 1 from pg_policies where schemaname='public' and tablename=table_name and policyname=policy_name) then
    execute format('create policy %I on public.%I as restrictive for %s to authenticated %s',policy_name,table_name,operation,
     case operation when 'insert' then 'with check ('||predicate||')' when 'update' then 'using ('||predicate||') with check ('||predicate||')' else 'using ('||predicate||')' end);
   end if;
  end loop;
 end loop;
end $migration$;
notify pgrst,'reload schema';
commit;
