# Discogs listing gate removal

## Implemented in source
- Removed the additional Discogs agreement/provenance denial in `supabase/functions/_shared/moduleScope.ts`. Existing music items with `discogs_release_id` can reach listing generation and eBay handlers without `DISCOGS_COMMERCIAL_USE_APPROVED` being set.
- This covers generation, publication, revision and ending through the shared listing endpoints. No eBay API operation was executed by this change.
- `supabase/functions/swish-create-checkout/index.ts` still rejects Tunes Flip and its aliases before Stripe customer/session creation. Its message now explicitly describes the owner's free rollout until an agreement is obtained and subscriptions are explicitly enabled. The agreement flag cannot automatically turn on charging.
- Added `services/__tests__/discogsListingAccess.test.ts`: 7 source regression cases, including two parameterized wrapper checks.

## Preserved
Authentication, tenant membership, active niche/session binding, resource ownership, RLS, existing module entitlements, seller confirmation/condition checks, and eBay policy/category checks are unchanged. No tables, stored item metadata, original image roles, credentials or subscriptions were modified. This change does not unlock other modules or introduce free membership grants.

Discogs catalogue access and its owner-only setup/health checks retain their existing permissions. Removing a SWISH listing gate does not establish legal permission to use Discogs data. Free software alone does not establish compliance with all provider terms; agreement status remains accurately unapproved until recorded by the owner.

## Verification
- Code inspected; runtime tests not executed in this editor (no command runner available).
- Tests authored: 7; executed: 0; pass/fail counts: not available.
- CI's existing full Jest suite includes the new test automatically. Command: `npx jest --config jest.config.ci.js --runInBand services/__tests__/discogsListingAccess.test.ts services/__tests__/tunesFlip.test.ts services/__tests__/paidNicheAuthorization.test.ts`.
- Deployment and running-app verification are not confirmed. The shared module file must be included in both `swish-list-generate` and `swish-ebay-list` deployed bundles. Refresh the checkout bundle for the revised message. Do not infer deployment from file existence.
- Retest using an existing confirmed music item and draft; confirm no Discogs agreement error, original photographs retained, and no duplicate item/draft. Publication remains subject to real eBay acceptance.
