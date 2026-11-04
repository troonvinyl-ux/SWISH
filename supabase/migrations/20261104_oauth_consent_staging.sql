-- Additive consent staging in the existing session table; no seller tokens modified.
begin;
alter table public.oauth_sessions add column if not exists pending_credential_ref text;
comment on column public.oauth_sessions.pending_credential_ref is 'AES-256-GCM consent-attempt credentials; server-only.';
revoke all on public.oauth_sessions from anon,authenticated;
grant select,insert,update on public.oauth_sessions to service_role;
commit;
