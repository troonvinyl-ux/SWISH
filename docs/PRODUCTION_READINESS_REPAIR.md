# Production readiness control repair

## Built and changed
- Owner-only Production Control navigation from Master Admin, with return navigation and auth/tenant-loading protection.
- Restored the missing `master-admin-app` route root already referenced by existing Expo configuration and APK workflows. Its thin routes reuse canonical auth, providers and screens; it does not contain a second backend or inventory. The isolated launcher opens installed niche apps by their existing registry schemes instead of navigating to absent tab routes.
- Service/hook separation for repository operations. Bundled register is explicitly labelled offline; failed refreshes retain evidence without claiming a live pass.
- Register and niche registry are read from the same resolved main commit. Invalid JSON/schema, unfinished verified stages, and unsupported certification records fail closed.
- Workflow discovery uses canonical workflow filenames and main-branch runs rather than searching the latest 20 runs by display name. Older-commit results remain visible but are not current-main acceptance.
- Workflow jobs and artifacts load independently. Skipped, cancelled, pending and failed results are distinct. Export artifacts do not certify deployment or installed devices.
- PR enrichment reads actual mergeability, comparison against the pinned main SHA, check runs and commit statuses. Missing/truncated evidence and moving heads cannot appear review-ready. Only the two newest open PRs are enriched to control public GitHub API consumption.
- Refresh coalescing, five-minute caching, one-minute forced-refresh cooldown, 15-second request timeouts, a local 45-request/hour API budget and GitHub rate-limit backoff prevent refresh storms.
- Optional per-niche certification records replace the hard-coded zero matrix. Each verified area requires resolved evidence, full commit SHA and verification timestamp; older/offline evidence requires recheck.
- Read-only register validator and regression tests cover failure cases. No automatic status promotion, PR merge, workflow trigger, API-key exposure or release action was added.

## Certification record contract
The canonical register can optionally contain `nicheCertification.records[nicheId][requiredArea]`:

```json
{
  "status": "VERIFIED",
  "evidence": "docs/acceptance-report.md#case-with-recorded-results",
  "commitSha": "<full 40-character tested main commit SHA>",
  "verifiedAt": "<past ISO timestamp>"
}
```

This is a format example, not acceptance evidence. Do not insert placeholder values or promote a record without completed tests. Missing records remain NOT STARTED. Verified records for earlier commits are RECHECK REQUIRED; historical programme tasks remain separately visible. Amend records through repository review, not a green toggle in the app.

## Unchanged
Canonical backend, database, auth, tenancy, entitlements, storage, AI, eBay operations, native build identities, OTA publishing and marketplace state are unchanged. No migration, secret or external marketplace operation is required by this read-only repair. Existing programme task statuses and release blockers are retained.

## Tests and results
Source was reviewed for snapshot source pairing, response classification, lifecycle cleanup and access gating. Added unit, mocked-network and validator subprocess regression cases. This editor has no shell/test execution tool: no local Jest, typecheck, lint, APK or installed-device pass is claimed. GitHub Actions must execute the suites before acceptance.

Commands:
- `node scripts/validate-production-register.mjs`
- `npx jest --config jest.config.ci.js --runInBand services/__tests__/productionControlEvidence.test.ts services/__tests__/productionControlService.test.ts services/__tests__/productionRegisterValidation.test.ts`
- `npx tsc --noEmit`
- `SWISH_MASTER_ADMIN=1 npx expo export --platform android --output-dir dist-ci-master`

## Known limitations / next step
Public GitHub API limits are shared by IP and can be consumed by other users or applications. The local budget only covers this running client; server 403/429 backoff is authoritative. No private-repository token is embedded. The dashboard reads publicly available evidence and cannot prove referenced documents are genuine or independently validate production integration/device tests. Cached/bundled data is not a fresh release verdict. Verify owner access, pull-to-refresh, airplane mode, GitHub errors and narrow/landscape layout on installed iOS/Android. Perform actual per-niche acceptance and retain reports before adding VERIFIED certification records.
