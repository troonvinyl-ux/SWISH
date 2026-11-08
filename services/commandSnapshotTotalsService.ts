// One scope-checked physical total contract for both owner workspace and platform reports.
import { parseCanonicalCounts } from './canonicalInventoryService';
import { sumCommandModules, type CommandModule, type CommandSnapshot } from './commandCentreService';
export function commandSnapshotTotals(snapshot: CommandSnapshot, modules: readonly CommandModule[]) {
  const totals = sumCommandModules(modules);
  if (snapshot.canonicalCounts == null) return snapshot.scope === 'platform' ? null : totals;
  try {
    const c = parseCanonicalCounts(snapshot.canonicalCounts);
    // Canonical totals may include unclassified history, never fewer than the scoped ledger.
    const unclassified = snapshot.unclassifiedInventory ?? 0;
    if (c.total !== totals.inventory + unclassified || c.stock < totals.stock || c.draft < totals.drafts || c.live < totals.liveItems || c.liveListings < totals.live || c.sold < totals.sold || c.units < totals.units) return null;
    return { ...totals, inventory: c.total, stock: c.stock, drafts: c.draft, live: c.liveListings, liveItems: c.live, sold: c.sold, archived: c.archived, units: c.units };
  } catch { return null; }
}
