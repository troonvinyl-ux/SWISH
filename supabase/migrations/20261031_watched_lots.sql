-- Persistent private watched-lot shortlist. Separate from purchased inventory.
create table if not exists public.watched_lots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  niche_id text not null check (niche_id in ('coins','motocross','bicycles','clothing','surplus_flip','trading_cards','antiques','fossils','beauty','tech')),
  manifest_key text not null check (manifest_key ~ '^[a-f0-9]{64}$'),
  name text not null check (length(name) between 1 and 200),
  product_count integer not null check (product_count between 1 and 500),
  unit_count bigint not null check (unit_count between 0 and 5000000000),
  base_valuation jsonb not null check (jsonb_typeof(base_valuation) = 'object' and octet_length(base_valuation::text) <= 16000),
  engine_version text not null,
  snapshot_path text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, tenant_id, niche_id, manifest_key),
  check (snapshot_path like user_id::text || '/' || tenant_id::text || '/' || niche_id || '/' || manifest_key || '/%'
    and snapshot_path ~ '^[a-f0-9-]+/[a-f0-9-]+/[a-z_]+/[a-f0-9]{64}/[a-f0-9-]+\.json$')
);
alter table public.watched_lots enable row level security;
create index if not exists idx_watched_lots_scope on public.watched_lots(user_id,tenant_id,niche_id,updated_at desc);
revoke all on public.watched_lots from anon;
grant select, insert, update, delete on public.watched_lots to authenticated;
-- Each operation checks account ownership plus verified tenant/niche access.
create policy authenticated_select_own_watched_lots on public.watched_lots for select to authenticated using (user_id = auth.uid() and public.swish_can_access_niche(tenant_id,niche_id));
create policy authenticated_insert_own_watched_lots on public.watched_lots for insert to authenticated with check (user_id = auth.uid() and public.swish_can_access_niche(tenant_id,niche_id));
create policy authenticated_update_own_watched_lots on public.watched_lots for update to authenticated using (user_id = auth.uid() and public.swish_can_access_niche(tenant_id,niche_id)) with check (user_id = auth.uid() and public.swish_can_access_niche(tenant_id,niche_id));
create policy authenticated_delete_own_watched_lots on public.watched_lots for delete to authenticated using (user_id = auth.uid() and public.swish_can_access_niche(tenant_id,niche_id));
create trigger set_watched_lots_updated_at before update on public.watched_lots for each row execute function public.swish_set_updated_at();
-- Large manifests live in private Storage, never a database JSON column.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values ('watched-lot-manifests','watched-lot-manifests',false,5242880,array['application/json']) on conflict(id) do nothing;
create or replace function public.swish_can_access_watched_manifest(p_name text)
returns boolean language sql stable security invoker set search_path=pg_catalog,public as $$
  select auth.uid() is not null
    and p_name ~ '^[a-f0-9-]+/[a-f0-9-]+/[a-z_]+/[a-f0-9]{64}/[a-f0-9-]+\.json$'
    and split_part(p_name,'/',1) = auth.uid()::text
    and exists (select 1 from public.tenant_memberships m where m.user_id = auth.uid()
      and m.tenant_id::text = split_part(p_name,'/',2)
      and public.swish_can_access_niche(m.tenant_id,split_part(p_name,'/',3)));
$$;
revoke all on function public.swish_can_access_watched_manifest(text) from public,anon;
grant execute on function public.swish_can_access_watched_manifest(text) to authenticated;
-- Separate private-bucket operation policies; immutable snapshot uploads.
create policy authenticated_select_own_watched_manifest on storage.objects for select to authenticated using (bucket_id = 'watched-lot-manifests' and public.swish_can_access_watched_manifest(name));
create policy authenticated_insert_own_watched_manifest on storage.objects for insert to authenticated with check (bucket_id = 'watched-lot-manifests' and public.swish_can_access_watched_manifest(name));
create policy authenticated_delete_own_watched_manifest on storage.objects for delete to authenticated using (bucket_id = 'watched-lot-manifests' and public.swish_can_access_watched_manifest(name));
-- Defense in depth: unrelated Storage policies cannot expose watched manifests.
create policy authenticated_select_watched_manifest_boundary on storage.objects as restrictive for select to authenticated using (bucket_id <> 'watched-lot-manifests' or public.swish_can_access_watched_manifest(name));
create policy authenticated_insert_watched_manifest_boundary on storage.objects as restrictive for insert to authenticated with check (bucket_id <> 'watched-lot-manifests' or public.swish_can_access_watched_manifest(name));
create policy authenticated_update_watched_manifest_boundary on storage.objects as restrictive for update to authenticated using (bucket_id <> 'watched-lot-manifests') with check (bucket_id <> 'watched-lot-manifests');
create policy authenticated_delete_watched_manifest_boundary on storage.objects as restrictive for delete to authenticated using (bucket_id <> 'watched-lot-manifests' or public.swish_can_access_watched_manifest(name));
create policy anon_select_watched_manifest_boundary on storage.objects as restrictive for select to anon using (bucket_id <> 'watched-lot-manifests');
create policy anon_insert_watched_manifest_boundary on storage.objects as restrictive for insert to anon with check (bucket_id <> 'watched-lot-manifests');
create policy anon_update_watched_manifest_boundary on storage.objects as restrictive for update to anon using (bucket_id <> 'watched-lot-manifests') with check (bucket_id <> 'watched-lot-manifests');
create policy anon_delete_watched_manifest_boundary on storage.objects as restrictive for delete to anon using (bucket_id <> 'watched-lot-manifests');
