// Dependency-free Antique policy; the Edge mirror is generated from this file.
export interface AntiqueSpecific { name: string; value: string }
export interface AntiqueAspect {
  name: string; required: boolean; values: string[]; mode: string; maxLength: number;
  cardinality: string; variations: boolean; raw: Record<string, any>;
}
export function normalizeAntiqueAspects(input: unknown): AntiqueAspect[] {
  if (!Array.isArray(input)) throw new Error('Category requirements are not an array.');
  return input.map((row: any) => {
    const constraint = row?.aspectConstraint ?? {};
    const name = String(row?.localizedAspectName ?? row?.aspectName ?? row?.name ?? '').trim();
    if (!name) throw new Error('Marketplace returned an unnamed item-specific field.');
    return { name, required: constraint.aspectRequired === true || row.required === true,
      values: Array.isArray(row.aspectValues) ? row.aspectValues.map((value: any) => String(value.localizedValue ?? '')).filter(Boolean) : (row.values ?? []),
      mode: constraint.aspectMode ?? row.mode ?? 'FREE_TEXT', maxLength: Number(constraint.aspectMaxLength ?? row.maxLength ?? 65),
      cardinality: constraint.itemToAspectCardinality ?? row.cardinality ?? 'SINGLE', variations: constraint.aspectEnabledForVariations === true,
      raw: row };
  });
}
export function validateAntiqueSpecifics(specifics: AntiqueSpecific[], aspects: AntiqueAspect[]): string | null {
  const supplied = specifics.filter(row => row.name.trim() && row.value.trim());
  const key = (value: string) => value.trim().toLowerCase();
  if (supplied.some(row => row.name.trim().length > 65 || row.value.trim().length > 65)) return 'Each specific name/value supports at most 65 characters; none were truncated.';
  if (supplied.length > 25) return 'SWISH supports at most 25 populated item specifics; none were truncated.';
  if (new Set(supplied.map(row => key(row.name))).size !== supplied.length) return 'Item-specific names must be unique.';
  for (const aspect of aspects) {
    const value = supplied.find(row => key(row.name) === key(aspect.name))?.value.trim();
    if (!value && aspect.required) return `Complete required item specific: ${aspect.name}.`;
    if (!value) continue;
    if (value.length > Math.min(65, aspect.maxLength > 0 ? aspect.maxLength : 65)) return `${aspect.name} exceeds the supported value length; it was not truncated.`;
    if (aspect.mode === 'SELECTION_ONLY' && !aspect.values.includes(value)) return `Choose an eBay-supported value for ${aspect.name}.`;
    const selected = aspect.raw.aspectValues?.find((row: any) => row.localizedValue === value);
    for (const dependency of selected?.valueConstraints ?? []) {
      const other = supplied.find(row => key(row.name) === key(dependency.applicableForLocalizedAspectName ?? ''))?.value;
      if (!dependency.applicableForLocalizedAspectValues?.includes(other)) return `${aspect.name} is not available for the selected ${dependency.applicableForLocalizedAspectName}.`;
    }
  }
  return null;
}
export function seedAntiqueSpecifics(saved: AntiqueSpecific[], aspects: AntiqueAspect[], attributes: Record<string, any>): AntiqueSpecific[] {
  const result = saved.map(row => ({ ...row }));
  const aliases: Record<string, string[]> = { type: ['object_type','type'], brand: ['brand','maker','manufacturer'], maker: ['maker'], material: ['material'], colour: ['colour','color'], style: ['style'], pattern: ['pattern'], age: ['age'], 'time period': ['period'], 'country/region of manufacture': ['country_of_origin','country_manufacture'], 'country of origin': ['country_of_origin'], 'original/reproduction': ['original_reproduction'], 'production technique': ['production_technique'] };
  for (const aspect of aspects) {
    if (result.some(row => row.name.trim().toLowerCase() === aspect.name.toLowerCase())) continue;
    let value = '';
    for (const key of aliases[aspect.name.toLowerCase()] ?? [aspect.name]) {
      const assessment = attributes._specialist_analysis?.fields?.[key];
      if (assessment?.basis === 'inferred' || attributes[`_inferred_${key}`] != null) continue;
      const candidate = attributes[key];
      if (typeof candidate === 'string' && candidate.trim() && !/^(unknown|not established|not supplied|not visible)$/i.test(candidate.trim())) { value = candidate.trim(); break; }
    }
    if (value && validateAntiqueSpecifics([{ name: aspect.name, value }], [{ ...aspect, required: false }])) value = '';
    if (value || aspect.required) result.push({ name: aspect.name, value });
  }
  return result;
}
export interface AntiqueConditionPolicy { categoryId: string; itemConditionRequired: boolean; itemConditions: { conditionId: string; conditionDescription: string; conditionHelpText?: string }[] }
export function selectAntiqueCondition(policy: AntiqueConditionPolicy, selected: string): { id: string; error: string | null } {
  if (!Array.isArray(policy.itemConditions)) return { id: '', error: 'Condition metadata unavailable.' };
  if (!policy.itemConditions.length && policy.itemConditionRequired === false) return { id: '', error: null };
  if (!selected || !policy.itemConditions.some(row => String(row.conditionId) === selected)) return { id: '', error: 'Select a supported eBay condition for this category. Cosmetic wear is not refurbished condition.' };
  return { id: selected, error: null };
}
export function validateAntiqueListingBasics(input: { title: string; description: string; price: number; quantity: number; media: string[] }): string | null {
  if (input.title.trim().length < 3 || input.title.length > 80) return 'Use a meaningful eBay title of 3–80 characters.';
  if (!input.description.trim()) return 'A factual item description is required.';
  if (!Number.isFinite(input.price) || input.price <= 0) return 'Choose a positive listing price.';
  if (!Number.isInteger(input.quantity) || input.quantity < 1) return 'Choose a positive whole quantity.';
  if (!input.media.length || input.media.length > 12 || input.media.some(url => !url.startsWith('https://'))) return 'Select 1–12 original, permanent HTTPS inventory photographs.';
  return null;
}
