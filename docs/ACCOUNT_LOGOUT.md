# Account logout and sign-in switching

## Source baseline

Latest GitHub main observed for this change: `96c47f2a35be50d6b277fe9dc6dc6c89a3d6f01c` (2 November 2026). The touched workspace header and account screen were checked against this pinned GitHub source. This is not a claim of a whole-repository or deployed-build sync.

## Usage

1. In Surplus Flip, tap **Log out** at the top beside Watched lots.
2. Confirm logout. If the current lot has unwatched changes, cancel and watch it first to keep them.
3. Sign in with the existing Coins account using its own email and password.
4. In the shared SWISH application, existing per-account niche preferences apply. If no niche is selected, use the existing niche selector to choose Coins, subject to the account's entitlements.

A branded Surplus Flip installation remains fixed to Surplus Flip. Signing in with a different account does not turn that installation into Coin Flipper or grant Coins access. Use the existing Coin Flipper application for Coins in that case. No build identity, entitlement or routing guard has been overridden.

## Behaviour and safety

- Existing AuthProvider/useAuth logout and the canonical backend are reused; no new auth client or mock login.
- Confirmation and errors use cross-platform SWISH alerts.
- Duplicate submissions and stale-account confirmations are guarded; logout is disabled while the manifest workflow is busy.
- Navigation history is dismissed only after successful logout and observed signed-out auth state. The root AuthRouter handles login and the next authenticated destination.
- Existing AppProvider, manifest and watched-lot scopes handle account changes; no global storage clear is performed.
- Saved inventory, watched lots, preferences, eBay connections and subscription records are not deleted by this feature.
- Existing Surplus content, niche artwork, colours, tab layout and GitHub design changes are preserved. The existing account sign-out row now uses the same guarded workflow.
- No database schema, Edge Function, secrets, native build configuration, OTA workflow or Foundation Master Register changes.

## Validation limits

Added pure service result tests and source-contract regressions in `services/__tests__/accountLogout.test.ts`. No test runner, authenticated account logout/login, installed-device test, native build or explicit deployment was run in this editor session. Latest source is not represented as deployed or production-verified.

Suggested existing-runner command:

```sh
npx jest --config jest.config.ci.js --runInBand services/__tests__/accountLogout.test.ts
```

Manual acceptance: test cancel; successful logout and relogin with a second approved account; no old inventory/manifest on the new account; correct account-specific niche selection; network failure and retry; rapid repeated taps; and Back after logout on installed iOS/Android and shared browser preview. Check fixed-branded installation behaviour separately.
