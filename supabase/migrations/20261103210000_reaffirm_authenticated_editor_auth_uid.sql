-- Re-assert the minimal auth identity helper permissions required by the
-- SECURITY INVOKER listing editor RPC. This is intentionally narrow:
-- authenticated clients can call auth.uid(), but cannot read auth tables.
-- Idempotent so environments that already applied the earlier grant remain safe.
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
