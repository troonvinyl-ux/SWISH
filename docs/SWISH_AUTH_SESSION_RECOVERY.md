# Shared SWISH authentication-session recovery

## Observed failure

OnSpace Auth logs on 2026-11-11 at 02:18–02:20 UTC reported `/auth/v1/user` returning 403: `Session from session_id claim in JWT does not exist`. `swish-check-subscription` consequently returned 401 `Invalid or expired authentication`. This is a stale/revoked sign-in session, not evidence of unpaid membership or an unverified email. A subsequent subscription request returned 200 at 02:21:06; that does not verify the affected installed device.

## Repair

- Only the existing read-only `swish-check-subscription` call can recover automatically: use the current access JWT explicitly, refresh the existing client's session once after an authentication rejection, and perform at most one fresh server verification.
- Concurrent recovery requests for the same rejected JWT share one refresh. Auth recovery has an 8-second deadline; each governed verification has its existing 20-second deadline. There is no indefinite retry loop.
- Missing/revoked refresh credentials or another 401 leave all grants closed and display **Sign in again**. The user's action clears only this client's local sign-in through the existing Supabase client. The existing AuthProvider event listener and root AuthRouter own login state/routing.
- Root and protected routes use the same recovery panel; protected navigation remains mounted but inaccessible. On local sign-out, protected routes return declaratively to the root AuthRouter.
- Network/auth service outages offer connection retry, not forced logout. HTTP 402/403 membership or permission denials do not refresh credentials or sign out.
- Replacement login/session changes during recovery cannot inherit a prior request's authorization. No token/session is manually set and no additional Supabase client is created.
- Inventory, photos, other app storage, backend permissions, subscription rules and eBay workflows are unchanged. Checkout, publication, identification and marketplace mutations are never replayed by this repair.

## Verification status

Read-only backend inspection confirms RLS remains enabled for items, tenant memberships, niche entitlements and module sessions. Regression cases are provided in `services/__tests__/authSessionRecovery.test.ts`, with a dedicated CI workflow including TypeScript checks. No test execution or installed-device acceptance is claimed in this editor session (no shell/device runner available).

### Installed-device acceptance

1. Existing valid login: open SWISH, verify access without a new login.
2. Expired access JWT with usable refresh token: one refresh and one fresh verified read; no duplicate inventory/listing work.
3. Revoked/missing backend session: Sign in again must open the existing login page, not repeat a membership error. Sign in normally and confirm inventory/photos are still present.
4. Background/foreground transition and each niche: the same recovery behavior applies.
5. Disable networking: a connection retry is offered and sign-in is not deliberately discarded.
6. Genuine forbidden/unpaid membership: denied access remains denied; recovery must not unlock another niche.
7. Concurrent retry taps and account switch during recovery: no parallel refresh storm, no stale grant, no clearing another login.

The backend cannot legitimately recreate a revoked session from its access JWT; a fresh login is required when refresh credentials are no longer usable.
