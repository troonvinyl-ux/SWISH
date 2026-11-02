-- Allow signed-in app sessions to resolve the identity helper used by
-- SECURITY INVOKER database commands. USAGE does not grant access to auth tables.
-- No client access to auth.users or other auth-schema objects is added.
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;

-- Keep anonymous sessions unable to resolve or execute the identity helper.
revoke all on function auth.uid() from public, anon;
