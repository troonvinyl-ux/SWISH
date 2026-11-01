# SWISH Control — Production Master Register

This file is the canonical human-readable companion to `SWISH_FOUNDATION_MASTER_REGISTER.json`. SWISH Control reads the JSON register and live public GitHub repository metadata. The JSON register is the source of truth for programme stages and task status; GitHub is the source of truth for branches, pull requests, commits and workflow runs.

## Operating contract

- The seven-stage master directive is represented in the JSON register.
- Never mark work VERIFIED without recorded evidence and passing acceptance criteria.
- A PR's mergeable flag is not a substitute for checking current-main ancestry, required checks, review requirements and dependencies.
- A PR is not automatically merged by SWISH Control.
- Failed or blocked work remains visible; new work must not erase the unresolved item.
- Before merging, compare the PR head with the latest main, update/rebase where needed, rerun required checks, and verify the exact head SHA that passed.
- Niche inventory, specialist configuration and app identity must be read from the existing `niche-modules.json`; do not create a duplicate registry.
- Keep existing Supabase/OnSpace backend, auth, database, eBay OAuth/listing/order/message/finance architecture and credential security boundaries.
- No native APK rebuild for ordinary JavaScript/UI work where OTA/web validation is sufficient; build native binaries at release milestones or for native dependency/configuration changes.

## Initial state

The initial task statuses are conservative. Existing handover documentation is evidence of prior work, not proof that every live integration or release gate currently passes. All ten registered niche modules are listed in the JSON-derived dashboard, but none is certified by registration alone.

## Current known release risks

See `knownReleaseRisks` in the JSON register and `docs/SWISH_ENGINEERING_HANDOVER.md`. These are carried forward until a task is explicitly closed with fresh evidence.

## Updating progress

When a builder completes work, it must update the relevant task status and evidence in `SWISH_FOUNDATION_MASTER_REGISTER.json`, append a dated entry to `changeLog`, and include the task IDs in the PR description. A reviewer must verify the evidence before status becomes VERIFIED. If a task is partially complete, keep it IN PROGRESS or TESTING; do not mark the entire stage complete.

## Dashboard limitations in this first slice

The dashboard reads public GitHub REST endpoints for open PRs, recent Actions runs, current main SHA, and the public niche registry. It does not require a client-side GitHub token. It does not have permission to merge, rebase, dispatch workflows, edit the register or bypass branch protection. The current PR warning is intentionally conservative: differing base SHAs trigger a recheck warning, not an automatic claim that a branch is stale. Full per-head comparison/check-run and protected merge-queue integration are follow-up hardening items.
