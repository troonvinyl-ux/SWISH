-- Repair authenticated inventory photo updates blocked by schema auth resolution.
-- The existing guard_item_specialist_identity trigger calls auth.role() as invoker.
-- USAGE allows name resolution only: no auth-table privileges, RLS bypass, or data writes.
-- Existing tenant/module checks and immutable specialist identity remain unchanged.
grant usage on schema auth to authenticated;
