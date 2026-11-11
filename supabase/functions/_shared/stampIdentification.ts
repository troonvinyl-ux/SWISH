// Pure evidence guard for the existing shared identifier. No external catalogue is fabricated.
const scalar = (value: unknown): string => typeof value === 'string' || typeof value === 'number' ? String(value).trim().slice(0, 500) : '';
const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const uncertainKeys = ['sg_number', 'scott_number', 'michel_number', 'catalogue_edition', 'perforation', 'watermark', 'paper', 'gum', 'completeness', 'stamp_count', 'provenance'];
/** Known values are seller claims, not independently verified catalogue evidence. */
export function guardStampIdentification(raw: Record<string, any>, known: Record<string, any> = {}) {
  const result: Record<string, any> = { ...raw, attributes: { ...object(raw.attributes) }, attributesConfirmed: { ...object(raw.attributesConfirmed) }, attributesInferred: { ...object(raw.attributesInferred) } };
  const sourceAnalysis = object(raw.specialistAnalysis);
  const fields = Object.fromEntries(Object.entries(object(sourceAnalysis.fields)).map(([key, entry]) => [key, { ...object(entry) }]));
  const warnings: string[] = Array.isArray(raw.warnings) ? raw.warnings.filter((value: unknown): value is string => typeof value === 'string') : [];
  const suggestions: Record<string, string> = {};
  const notes = typeof known.customNotes === 'string' ? known.customNotes.slice(0, 8000) : '';
  const supplied = (key: string) => {
    const direct = scalar(known[key]); if (direct) return direct;
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = notes.match(new RegExp('(?:^|\\n)' + escaped + ': (.+?) \\(seller supplied; cross-check against photographs\\)', 'i'));
    return scalar(match?.[1]);
  };
  // These precise or hidden attributes cannot become observed facts solely on model authority.
  for (const key of uncertainKeys) {
    const value = scalar(result.attributesConfirmed[key] ?? result.attributes[key] ?? fields[key]?.value);
    const sellerValue = supplied(key);
    if (sellerValue) {
      result.attributes[key] = sellerValue; result.attributesConfirmed[key] = sellerValue;
      delete result.attributesInferred[key]; delete result.attributes[`_inferred_${key}`];
      fields[key] = { value: sellerValue, basis: 'user_supplied', reason: 'Seller claim or physical check; not independent certification.' };
    } else if (value) {
      suggestions[key] = value; delete result.attributesConfirmed[key]; delete result.attributes[key];
      result.attributesInferred[key] = value; result.attributes[`_inferred_${key}`] = value;
      fields[key] = { value, basis: 'inferred', reason: 'AI proposal only; inspect or check an independent catalogue before using.' };
    }
  }
  result.attributes._stamp_suggestions = suggestions;
  result.attributes.catalogue_status = 'unverified';
  delete result.attributesConfirmed.catalogue_status;
  fields.catalogue_status = { value: 'unverified', basis: 'observed', reason: 'No independent stamp catalogue lookup was performed by this call.' };
  result.specialistAnalysis = { ...sourceAnalysis, fields };
  result.conditionGrade = '';
  result.specialistId = 'stamps';
  result.identificationSource = 'inferred';
  result.identificationState = raw.identificationState === 'observation_only' ? 'observation_only' : 'candidate';
  result.valuationLow = 0; result.valuationMid = 0; result.valuationHigh = 0; result.saleProb30d = null;
  result.valuationConfidence = 'insufficient_data';
  const uncheckedMnh = !/^(yes|true)$/i.test(supplied('gum_checked')) && /mnh|never hinged|unmounted mint/i.test([raw.canonicalTitle, raw.condition, raw.conditionNotes, suggestions.gum].join(' '));
  if (uncheckedMnh) {
    const removeClaim = (value: unknown) => scalar(value).replace(/\b(?:MNH|mint never hinged|never hinged|unmounted mint)\b/gi, 'gum not checked');
    result.canonicalTitle = removeClaim(raw.canonicalTitle);
    result.condition = removeClaim(raw.condition); result.conditionNotes = removeClaim(raw.conditionNotes);
    result.attributes.gum = 'Not checked'; delete result.attributesConfirmed.gum;
    fields.gum = { value: 'Not checked', basis: 'inferred', reason: 'MNH cannot be established without inspection of the reverse.' };
    warnings.push('Check the reverse for gum and hinge traces before describing this as mint never hinged.');
  }
  if (suggestions.sg_number || suggestions.scott_number || suggestions.michel_number) {
    result.canonicalTitle = scalar(result.canonicalTitle).replace(/\b(?:SG|Scott|Michel)\s*#?\s*\d+[a-z]?\b/gi, '').replace(/\s{2,}/g, ' ').trim();
    warnings.push('Catalogue numbers are AI suggestions, not verified references. Confirm the catalogue and edition.');
  }
  warnings.push('Stamp issue is AI-suggested; exact variety, authenticity and catalogue value are not independently verified.');
  result.warnings = [...new Set(warnings)];
  return result;
}
