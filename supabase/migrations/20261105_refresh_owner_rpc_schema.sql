-- Repair the existing trusted-owner RPC contract and refresh PostgREST's schema cache.
-- Uses the existing owner table and identity rules; creates no tables or grants to anon.
begin;

create or replace function public.swish_owner_for_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path=pg_catalog,public
as $$
  select exists (
    select 1
    from public.swish_platform_owners r
    join auth.users u on u.id=r.user_id
    where r.user_id=p_user_id
      and lower(u.email)='troonvinyl@gmail.com'
      and u.email_confirmed_at is not null
  );
$$;
revoke all on function public.swish_owner_for_user(uuid) from public,anon,authenticated;
grant execute on function public.swish_owner_for_user(uuid) to service_role;

create or replace function public.swish_is_platform_owner()
returns boolean
language sql
stable
security definer
set search_path=pg_catalog,public
as $$
  select auth.uid() is not null
    and public.swish_owner_for_user(auth.uid());
$$;
revoke all on function public.swish_is_platform_owner() from public,anon;
grant execute on function public.swish_is_platform_owner() to authenticated,service_role;

-- PostgREST otherwise may continue serving a stale function signature cache.
notify pgrst, 'reload schema';
commit;
