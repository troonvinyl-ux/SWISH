# Collectibles Quick List identification 403 repair

## Confirmed diagnosis

The supplied screenshot reports `Specialist belongs to another module.` The swish-identify invocation logs contain the same response with HTTP 403 at 2026-11-06 20:42:07 and three earlier attempts. This is the module allow-list rejection, before photo analysis runs, not a Numista, background-removal or eBay failure.

`identifyQuickPhotos` was sending `curiosities_collectibles` from the Collectibles workspace. The canonical client/backend registries authorize `collectibles` for that module and intentionally exclude the generic legacy catch-all from every production niche.

## Focused changes

- `services/quickListService.ts`: select the default specialist from the existing canonical module registry for both Collectibles and Coins. The same retained originals, measurements, provider call and tenant are passed through.
- `supabase/functions/_shared/identifySpecialistCompatibility.ts`: normalize only the outdated `curiosities_collectibles` request to `collectibles` when the trusted active server module is Collectibles and the operation is swish-identify.
- `supabase/functions/_shared/moduleScope.ts`: apply that compatibility rule to camel-case and snake-case specialist inputs before the existing allow-list, entitlement and resource checks. Forward the canonical identity to the existing identification handler.
- `services/__tests__/quickListSpecialistScope.test.ts`: mocked client call and pure compatibility regression coverage, including other niches, other operations, malformed inputs, unchanged originals and retained authorization boundaries.

No database migration, record rewrite, registry expansion, authentication replacement, entitlement relaxation, credential change, automatic publication or scanner reset is introduced. Legacy generic inventory remains unclassified; new identification uses the canonical Collectibles profile and downstream inventory/valuation identity.

## Verification status

- Existing live error inspected: confirmed above.
- Regression tests added: not executed in this editor (no test runner tool).
- Existing Quick List CI runs all service tests and checks the affected Edge Functions, including their shared dependency imports.
- Deploy the affected function/shared dependencies and deliver the client update through the existing release path. Deployed-revision and device verification are still required.

Suggested regression command:

```sh
npx jest --config jest.config.ci.js --runInBand services/__tests__/quickListSpecialistScope.test.ts services/__tests__/quickListContracts.test.ts services/__tests__/nicheIsolation.test.ts services/__tests__/collectiblesEntry.test.ts
deno check supabase/functions/swish-identify/index.ts
```

## Device retest

1. Keep the two existing photographs in Quick List; do not start a new item.
2. Tap **Retry with retained photos** after the updated function/client is available.
3. Verify the call no longer receives the specialist mismatch and any successful identification returns `specialistId: collectibles`.
4. Verify any saved item appears only in Collectibles inventory. Coin identification must continue using `coins`.
5. A Coins request in Collectibles and an unentitled or cross-tenant request must remain rejected.

No successful identification, live eBay publication or under-60-second target is claimed from this repair alone.
