// Validate ALL compatibility aliases before privileged handlers consume a body.
// Checking only camelCase ?? snake_case lets a second identity evade the resource guard.
export const MODULE_RESOURCE_ALIASES = [
  ['items', 'itemId', 'item_id'], ['listings', 'listingId', 'listing_id'],
  ['orders', 'orderId', 'order_id'], ['ebay_messages', 'messageId', 'message_id'],
] as const;
export function moduleRequestAliasIssue(body: Record<string, unknown>): string | null {
  for (const [left, right] of [
    ['tenantId', 'tenant_id'], ['nicheId', 'niche_id'], ['specialistId', 'specialist_id'],
    ['externalListingId', 'external_listing_id'],
    ...MODULE_RESOURCE_ALIASES.map(([, left, right]) => [left, right]),
  ]) {
    if (body[left] != null && body[right] != null && body[left] !== body[right]) return 'Conflicting request identities; reopen the active workspace.';
  }
  for (const [left, right] of [['itemIds', 'item_ids'], ['listingIds', 'listing_ids']]) {
    if (body[left] == null || body[right] == null) continue;
    const a = body[left], b = body[right];
    if (!Array.isArray(a) || !Array.isArray(b) || a.some(value => typeof value !== 'string') || b.some(value => typeof value !== 'string')) return 'Invalid resource identity set.';
    const keys = (values: unknown[]) => JSON.stringify([...new Set(values as string[])].sort());
    if (keys(a) !== keys(b)) return 'Conflicting resource identity sets.';
  }
  return null;
}
