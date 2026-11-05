// Seller-facing projection only. eBay validation and persisted values are unchanged.
export interface ListingSpecificValue { name: string; value: string }
export interface ListingAspectSummary { name: string; required: boolean; values: string[]; mode?: string }
export const SPECIFIC_PICKER_LIMIT = 30;
const nameKey = (value: string) => value.trim().toLowerCase();

export function missingRequiredSpecifics(aspects: ListingAspectSummary[], specifics: ListingSpecificValue[]): ListingAspectSummary[] {
  const supplied = new Set(specifics.map(row => nameKey(row.name)));
  const seen = new Set<string>();
  return aspects.filter(aspect => {
    const key = nameKey(aspect.name);
    if (!aspect.required || !key || supplied.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function availableSpecificFields(aspects: ListingAspectSummary[], specifics: ListingSpecificValue[], query: string): string[] {
  const supplied = new Set(specifics.map(row => nameKey(row.name)));
  const filter = nameKey(query);
  const seen = new Set<string>();
  return aspects.filter(aspect => {
    const key = nameKey(aspect.name);
    if (!key || supplied.has(key) || seen.has(key) || (filter && !key.includes(filter))) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => Number(b.required) - Number(a.required)).map(aspect => aspect.name);
}

export function suggestedSpecificValues(aspect: ListingAspectSummary | undefined, query: string): { values: string[]; hasMore: boolean } {
  const filter = nameKey(query);
  const values: string[] = [];
  const seen = new Set<string>();
  for (const value of aspect?.values ?? []) {
    const key = nameKey(value);
    if (!key || seen.has(key) || (filter && !key.includes(filter))) continue;
    seen.add(key);
    if (values.length === SPECIFIC_PICKER_LIMIT) return { values, hasMore: true };
    values.push(value);
  }
  return { values, hasMore: false };
}
