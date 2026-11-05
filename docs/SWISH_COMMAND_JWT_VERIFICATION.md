# Approved command/readiness JWT verification

## Current factual status

**Live HTTP verification: BLOCKED.** The operator confirmed that approved owner/subscriber JWT fixtures are not configured. This editing session has no authenticated POST executor, terminal or GitHub workflow-dispatch tool. No real JWT was obtained, no authenticated endpoint request was executed, and no readiness evidence was written by this session.

The public main lookup returned `f010e836c1b4e0db2a2001eb6dabc67fa828a1d5`, containing the previous command-centre change. Read-only database prerequisite inspection returned the existing owner-only SELECT policy for `swish_verification_results`. Those observations are not HTTP authorization acceptance; earlier SQL subject simulations are not substitutes either.

The secure execution path is now implemented in:
- `scripts/verify-command-jwt.mjs` — bounded, sequential existing-endpoint client.
- `scripts/verify-command-jwt.test.mjs` — injected-transport and safety regressions, **authored, not executed in this session**.
- `.github/workflows/command-jwt-verification.yml` — manual main-only workflow using protected environment secrets, no dependencies/build/deployment.
- Existing command-centre CI now includes the credential-free native Node unit tests.

No production data, schema, RLS, auth system, Edge Function, seller credentials or current readiness task status was changed. No live test is marked PASS in this document. No full S1–S7 task is promoted.

## Secure fixture setup — operator required

Do not send JWTs through chat, URLs, workflow inputs, source files, artifacts or issue comments.

1. In `troonvinyl-ux/SWISH` GitHub Settings → Environments create **`swish-approved-jwt-verification`**. Require an authorized reviewer, disallow self-review where available, and limit deployments to protected **main**. These dashboard protection settings cannot be installed by a repository YAML file.
2. Use two **existing designated test accounts** in the existing OnSpace authentication system: a backend-trusted platform owner and a distinct ordinary subscriber with at least one unexpired canonical niche entitlement and at least one unentitled canonical niche. Do not grant owner status or create paid entitlements for the test.
3. Authenticate the accounts through the normal existing application/approved private test client. Store only their short-lived **access JWTs**, not passwords or refresh tokens, as environment secrets. Tokens should have at least 30 minutes of remaining validity when the workflow starts; the runner rejects less than ten minutes. It never signs in, refreshes or manufactures a JWT.
4. Put the following secrets in this protected environment:

| Environment secret | Meaning |
|---|---|
| `SWISH_ANON_KEY` | Existing project's anon client API key, never service role |
| `SWISH_OWNER_JWT` | Approved owner's short-lived access JWT |
| `SWISH_SUBSCRIBER_JWT` | Approved subscriber's short-lived access JWT |
| `SWISH_OWNER_USER_ID` | Expected owner auth user UUID |
| `SWISH_SUBSCRIBER_USER_ID` | Expected subscriber auth user UUID |
| `SWISH_OWNER_TENANT_ID` | Existing tenant the owner actually belongs to |
| `SWISH_SUBSCRIBER_TENANT_ID` | Existing tenant the subscriber actually belongs to |
| `SWISH_FOREIGN_TENANT_ID` | Operator-approved **existing** tenant neither fixture belongs to |

5. Set environment variable **`SWISH_SUBSCRIBER_NICHES`** to the exact comma-separated active canonical entitlement IDs for the subscriber. Example only: `coins,trading_cards`. The runner independently compares this set to the user's server-readable entitlements; it does not infer paid access from client claims or this variable.
6. Keep both test sessions idle during execution so the before/after module-session comparison is meaningful. Fixtures can have different own tenants. No active niche is changed by the runner.

The foreign tenant must be an operator-reviewed existing fixture, not a random UUID or a nonexistent sentinel. The runner verifies its absence from both users' visible memberships; it cannot independently prove existence of an inaccessible tenant without broadening privileged access.

## Execute

After the new workflow is actually present on protected main:

GitHub Actions → **SWISH approved command and readiness JWT checks** → Run workflow → branch **main**.

Explicitly approve both:
- Authenticated read-only command/authorization probes.
- Diagnostic evidence retention by the existing `swish-verification` **programme** action.

The latter is necessary to verify persisted references: the endpoint inserts only diagnostic rows into the existing verification table. The run is **not zero-write**, but makes no inventory, listing, order, seller, AI or module-session writes. There are no automatic retries, fixture creation, cleanup, deployment or APK requests.

The workflow verifies credential-free runner tests before releasing environment credentials to the execution step. It pins checkout and evidence to `GITHUB_SHA`, and checks that source against current public main. Expired/revoked JWTs, missing secrets, changed main, gateway failures and malformed responses remain blocked or failed, not passing.

This editor cannot configure environment secrets/reviewers or dispatch the workflow. Providing the configuration and running it is still required; authoring YAML is not execution evidence.

## Exact live checks

1. Server `/auth/v1/user` validates each actual token and matches its approved expected user ID. Local JWT decoding is only a preflight, never authentication authority.
2. Existing `swish_is_platform_owner` returns true for owner and false for subscriber. Existing membership and entitlement reads validate fixture scopes.
3. Owner platform command RPC returns all 11 canonical niche IDs; owner tenant reporting remains tenant-bound. Subscriber reporting returns exactly its tenant/niches, no platform user/subscriber counts, and no foreign tenant/niche activity.
4. Explicit subscriber niche filtering returns only that niche. These checks cover aggregate scope, **not independent numerical ledger reconciliation**.
5. Subscriber platform reporting and each owner inspector with both platform and tenant arguments must return **HTTP 403 / SQLSTATE 42501**. Owner/subscriber nonmember tenant reporting and subscriber unentitled niche reporting must do the same. A 200 empty response or 401 unauthenticated response does not satisfy a 403 check.
6. Existing readiness `list` and `programme` actions reject subscriber JWTs with HTTP 403 and UUID error references. Owner readiness access to a nonmember tenant is also denied. Denial references are request correlation IDs, not persisted PASS evidence.
7. Only after the read boundaries pass, run **one** owner `programme/ALL` request against the existing endpoint, with `platform: unknown` (CI is not a device). The two limited DB/registry probes must pass; every original S1–S7 full-task record must remain BLOCKED. The runner does not fabricate acceptance or call AI/eBay tests.
8. Verify every returned diagnostic ID, timestamp and common reference through the existing owner history endpoint and a separate owner caller-RLS SELECT from `swish_verification_results`. Compare the returned evidence/result fields, not merely existence of an HTTP response.
9. Subscriber caller-RLS SELECT for the new owner reference must return HTTP 200 with no visible rows. This proves visibility denial, not absence of the persisted owner rows. A denial reference's lack of readable rows is **not** treated as proof that no row exists outside the caller's scope.
10. Read each caller's existing module session again and compare to the preflight baseline; never call `swish_open_module`.

## Evidence and interpretation

Artifact: **`command-jwt-evidence-<tested SHA>`**, file **`command-jwt-evidence.json`**. Retention: seven days.

It contains normalized check IDs, PASS/FAIL/BLOCKED, observed HTTP statuses, timestamps, tested source SHA, and sanitized diagnostic UUID references only. It never includes JWTs, API keys, user/tenant IDs, emails, inventory rows, HTTP bodies, provider errors or headers. HTTP redirects are refused, bodies are bounded to 1 MB, and every request must match a fixed endpoint/method/action allowlist.

- Nonzero exit: at least one required check failed or was blocked.
- `acceptancePassed: true`: this limited JWT/aggregate/diagnostic-reference suite passed, **not** full production readiness.
- `productionReady: false`: always; no register task or release is certified here.
- The tested deployed contract is observed, but a server deployment/source digest is not attested.
- Database/provider/device/write/ledger/startup acceptance beyond this scope remains open.

The artifact becomes actual evidence **only after the workflow executes**. Inspect it and the same-reference database rows before reporting live acceptance. Share the run URL or sanitized artifact, never the fixtures. Remove/rotate expired environment JWT secrets after the run; retain diagnostic history without automated deletion.
