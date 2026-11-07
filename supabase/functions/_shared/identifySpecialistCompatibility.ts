// Request compatibility only; does not register the generic catch-all or migrate stock.
// The caller supplies the trusted, server-resolved module and operation, never body.nicheId.
export function normalizeIdentifySpecialist(
  authorizedNicheId: string,
  operation: string,
  requestedSpecialist: unknown,
): unknown {
  // Older Quick List builds sent the generic specialist for Collectibles. Translate
  // that one input to the canonical specialist BEFORE the unchanged allow-list,
  // entitlement and resource checks. Every other module/operation stays fail-closed.
  if (authorizedNicheId === 'collectibles' && operation === 'swish-identify' && requestedSpecialist === 'curiosities_collectibles') {
    return 'collectibles';
  }
  return requestedSpecialist;
}
