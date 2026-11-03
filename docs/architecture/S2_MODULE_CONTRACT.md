# S2 — Core/module contracts

Implementation date: 2026-11-02. IMPLEMENTED, not CI-VERIFIED.

## Identity and dependency ownership

`niche-modules.json` is the only editable product registry. Contract version 1 adds explicit scanner routes and core service ownership. IDs/types and production lists derive from this file; aliases are read-only compatibility. `shared/moduleContracts.ts` defines portable scope, result and evidence contracts without creating clients/providers/data stores. These contracts are extension interfaces, not a claim that all legacy APIs already return the new result envelope.

The existing `supabase/functions/_shared/niche-modules.json` is a generated deployment mirror for existing order/sync imports. Run `node scripts/sync-backend-registry.mjs` after editing the root registry. The `--check` option and foundation validator fail on drift. Never edit backend identity independently.

## Existing shared core

| Capability | Authoritative implementation |
|---|---|
| Auth/session | Existing template AuthProvider/useAuth, one getSupabaseClient |
| Tenant/provisioning | tenantService, AppContext, existing provisioning RPC/RLS |
| Capture/media | aiIdentificationService, captureDraftService, useGenericCapture, existing item-images bucket |
| Identity/evidence | itemService, shared/specialistIntelligence, existing identify/market-value Edge Functions |
| Inventory/lifecycle | itemService, inventoryTabQueryService, inventory view/RLS, existing marketplace status command |
| Listing | listingService/listingEditorService, existing draft/editor/publish commands |
| Marketplace | marketplaceAdapter, existing server eBay OAuth/list/order/message/finance/sync functions |
| Commercial | profitEngine, commercialEngine and existing order/sales/financial tables |
| Settings/audit | businessConfigService/autonomyService, AppContext and audit_events |

## Allowed module extensions

A niche owns brand/terms, specialist evidence/capture requirements, fields, listing mappings, risk guidance and optional UI. It must use the existing core for tenant/session, canonical item UUID, uploads, listing publish, marketplace credentials, financial transactions and audit. Product selection is not an authorization grant.

Dependencies: portable shared contracts -> services -> hooks -> UI. Context providers live in the root layout; components consume them through hooks. Services must not import React or UI/state. Platform adapters (camera/files/linking) may use React Native/Expo APIs, but not React state or JSX. Shared contracts must be platform-independent. Client code must not import server-only modules.

`node scripts/validate-foundation.mjs` checks all ten products, unique aliases/specialist ownership/package identities, route existence, generated backend parity and dependency rules. Existing direct data calls in large screens remain explicit S3 migration debt; this gate does not pretend those paths have all been moved.

## Repairs

Removed nonexistent Antiques guide/restoration/condition/value routes from registered active routes and home shortcuts. The existing canonical item editor provides condition and market valuation. Added antique-capture as an adapter to the existing adaptive capture screen. No stub specialist tools, duplicate AI implementation or new inventory created.

## Acceptance

Run foundation validator, full Jest, lint, TypeScript, server tests, branded Android/web exports. Source inspection alone does not establish runtime or production verification. New tests and gates have been authored; this editor has no command executor to run them.
