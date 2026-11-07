-- Fix successful eBay publication followed by service-role lifecycle RPC 403.
-- USAGE resolves invoker auth.uid()/auth.role(); it grants no auth-table access.
-- Tenant/niche checks, lifecycle validation, RLS and server-only claims are unchanged.
-- No inventory or listing rows are changed by applying this migration.
grant usage on schema auth to service_role;
grant execute on function auth.uid() to service_role;
grant execute on function auth.role() to service_role;
