-- SWISH: explicitly expose the existing niche-access check to authenticated clients.
-- Apply after 20261105_unified_shell.sql. No tables, inventory rows or entitlements are changed.
begin;

do $$
begin
  if to_regprocedure('public.swish_can_access_niche(uuid,text)') is null then
    raise exception 'Required function public.swish_can_access_niche(uuid,text) is missing. Apply 20261105_unified_shell.sql first.';
  end if;
end;
$$;

revoke all on function public.swish_can_access_niche(uuid,text) from public, anon;
grant execute on function public.swish_can_access_niche(uuid,text) to authenticated, service_role;

-- Keep the helper private; it is called internally by SECURITY DEFINER functions.
revoke all on function public.swish_has_niche_entitlement(uuid,text) from public, anon, authenticated;
grant execute on function public.swish_has_niche_entitlement(uuid,text) to service_role;

notify pgrst, 'reload schema';
commit;
