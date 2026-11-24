/** Numista reference data is not proof of the owned coin's identity or authenticity. */
export const coinReviewVersion = 'numista-physical-v1';
export const numistaReferenceTtlMs = 6 * 60 * 60 * 1000;
export interface NumistaCoinReference {
  id: number; title: string; url: string; weightGrams: number | null; diameterMm: number | null;
  issuer: string; denomination: string; composition: string; obverse: string; reverse: string; fetchedAt: number;
}
export interface CoinMeasurementReview {
  version: string; referenceId: number; catalogueWeightGrams: number | null; catalogueDiameterMm: number | null;
  actualWeightGrams: number; actualDiameterMm: number; identityConfirmed: boolean; measurementsConfirmed: boolean;
  mismatchAcknowledged: boolean; mismatchNotes: string; recordedAt: string; confirmedDate?: string;
}
export function normalizeNumistaNumber(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  const match = text.match(/^(?:N\s*#?\s*)?([1-9]\d{0,8})$/i) ?? text.match(/^https:\/\/(?:[a-z]{2}\.)?numista\.com\/(?:catalogue\/pieces)?([1-9]\d{0,8})(?:\.html)?\/?$/i);
  return match ? Number(match[1]) : null;
}
export function positiveCoinMeasurement(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const text = String(value).trim().replace(',', '.');
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) && number > 0 && number <= 100000 ? number : null;
}
const name = (value: unknown): string => {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim().slice(0, 500);
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    return name(row.name ?? row.title ?? row.material ?? row.description ?? row.value);
  }
  return '';
};
export function mapNumistaCoinReference(raw: unknown, requestedId: number, now = Date.now()): NumistaCoinReference {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Numista returned an invalid catalogue record.');
  const row = raw as Record<string, any>;
  if (Number(row.id) !== requestedId || !name(row.title)) throw new Error('Numista returned a different or incomplete reference. Nothing was confirmed.');
  const category = name(row.category).toLowerCase();
  if (category && !['coin', 'coins'].includes(category)) throw new Error('This Numista reference is not a coin. Use the appropriate specialist.');
  return { id: requestedId, title: name(row.title), url: `https://en.numista.com/${requestedId}`,
    weightGrams: positiveCoinMeasurement(row.weight), diameterMm: positiveCoinMeasurement(row.diameter ?? row.size),
    issuer: name(row.issuer), denomination: name(row.value ?? row.denomination ?? row.min_unit), composition: name(row.composition),
    obverse: name(row.obverse?.description), reverse: name(row.reverse?.description), fetchedAt: now };
}
export function readNumistaCoinReference(answers: Record<string, string>, now = Date.now()): NumistaCoinReference | null {
  try {
    const row = JSON.parse(answers._numista_record || 'null') as NumistaCoinReference | null;
    if (!row || row.id !== normalizeNumistaNumber(answers.catalogue_number) || !row.title || !Number.isFinite(row.fetchedAt) || now < row.fetchedAt || now - row.fetchedAt > numistaReferenceTtlMs) return null;
    return row;
  } catch { return null; }
}
export function compareCoinMeasurements(reference: Pick<NumistaCoinReference, 'weightGrams' | 'diameterMm'>, weight: unknown, diameter: unknown) {
  const actualWeight = positiveCoinMeasurement(weight), actualDiameter = positiveCoinMeasurement(diameter);
  const warnings: string[] = []; let major = false;
  const standardWeight = positiveCoinMeasurement(reference.weightGrams), standardDiameter = positiveCoinMeasurement(reference.diameterMm);
  if (actualWeight !== null && standardWeight !== null) {
    const difference = Math.abs(actualWeight - standardWeight), percent = difference / standardWeight * 100;
    if (difference > Math.max(0.05, standardWeight * 0.01) + 1e-9) warnings.push(`Weight differs: actual ${actualWeight} g; Numista ${standardWeight} g (${percent.toFixed(1)}% difference).`);
    if (percent > 12 + 1e-9) major = true;
  }
  if (actualDiameter !== null && standardDiameter !== null) {
    const difference = Math.abs(actualDiameter - standardDiameter);
    if (difference > 0.5 + 1e-9) warnings.push(`Diameter differs: actual ${actualDiameter} mm; Numista ${standardDiameter} mm (${difference.toFixed(2)} mm difference).`);
    if (difference > 3 + 1e-9) major = true;
  }
  if (standardWeight === null) warnings.push('Numista has no standard weight for this type; weight comparison is unavailable.');
  if (standardDiameter === null) warnings.push('Numista has no standard diameter for this type; size comparison is unavailable.');
  return { actualWeight, actualDiameter, warnings, major };
}
export function coinConfirmationKey(reference: NumistaCoinReference, answers: Record<string, string>): string {
  const date = (answers.year ?? '').trim();
  return JSON.stringify([reference.id, reference.weightGrams, reference.diameterMm, positiveCoinMeasurement(answers.weight_g), positiveCoinMeasurement(answers.diameter_mm), ...(date ? [date] : [])]);
}
/** Explain prerequisites on tap instead of leaving a silent disabled date/type checkbox. */
export function coinIdentityConfirmationIssue(reference: NumistaCoinReference | null, answers: Record<string, string>, photos: Array<{ slotId: string; uri: string }>): string | null {
  if (!reference) return 'Load your Numista reference before confirming the date and type.';
  const obverse = photos.find(photo => /obverse|front/i.test(photo.slotId));
  const reverse = photos.find(photo => /reverse|back/i.test(photo.slotId));
  if (!obverse || !reverse || obverse.uri === reverse.uri) return 'Add separate front (obverse) and back (reverse) photographs before confirming the date and type.';
  const comparison = compareCoinMeasurements(reference, answers.weight_g, answers.diameter_mm);
  if (!comparison.actualWeight || !comparison.actualDiameter) return 'Enter your actual weight and diameter before confirming the date and type.';
  if (comparison.major) return 'Recheck the reference and measurements: a major mismatch must be corrected before confirmation.';
  return null;
}
export function usesNumistaCoinEntry(answers: Record<string, string>, specialistId: string): boolean {
  return specialistId !== 'banknotes' && answers._coin_entry !== 'photo';
}
export function numistaCoinEntryIssue(answers: Record<string, string>): string | null {
  const reference = readNumistaCoinReference(answers);
  if (!reference) return 'Enter and load a valid Numista N# number. Resumed scans must reload the catalogue reference.';
  const comparison = compareCoinMeasurements(reference, answers.weight_g, answers.diameter_mm);
  if (!comparison.actualWeight || !comparison.actualDiameter) return 'Enter the actual coin weight in grams and diameter in millimetres, measured without its holder.';
  const key = coinConfirmationKey(reference, answers);
  if (answers._coin_measured_confirmed !== key) return 'Confirm that weight and diameter were physically measured, not copied from Numista.';
  if (comparison.major) return 'Major measurement mismatch. Recheck the Numista type and measurements before listing (over 12% weight or 3 mm diameter difference).';
  if (comparison.warnings.length && (answers._coin_mismatch_ack !== key || !answers._coin_mismatch_notes?.trim())) return 'Review the measurement warning and add a discrepancy note before continuing.';
  if (answers._numista_identity_confirmed !== key) return 'Compare both coin faces with the Numista reference and confirm the type. This is not an authenticity certificate.';
  return null;
}
/** Only an item-specific comparison audit is persisted; never the catalogue text/photos. */
export function makeCoinMeasurementReview(reference: NumistaCoinReference, answers: Record<string, string>): CoinMeasurementReview {
  const compared = compareCoinMeasurements(reference, answers.weight_g, answers.diameter_mm), key = coinConfirmationKey(reference, answers);
  if (!compared.actualWeight || !compared.actualDiameter) throw new Error('Actual coin measurements are required.');
  return { version: coinReviewVersion, referenceId: reference.id, catalogueWeightGrams: reference.weightGrams, catalogueDiameterMm: reference.diameterMm,
    actualWeightGrams: compared.actualWeight, actualDiameterMm: compared.actualDiameter, identityConfirmed: answers._numista_identity_confirmed === key,
    measurementsConfirmed: answers._coin_measured_confirmed === key, mismatchAcknowledged: answers._coin_mismatch_ack === key,
    mismatchNotes: (answers._coin_mismatch_notes ?? '').trim().slice(0, 500), recordedAt: new Date().toISOString(), confirmedDate: (answers.year ?? '').trim() || undefined };
}
export function coinPublicationIssue(attributes: Record<string, unknown>): string | null {
  if (!attributes._coin_measurement_review) return null; // Historical/photo-only records keep their existing review rules.
  const review = attributes._coin_measurement_review as CoinMeasurementReview;
  if (review.version !== coinReviewVersion || !normalizeNumistaNumber(review.referenceId) || normalizeNumistaNumber(attributes.catalogue_number) !== review.referenceId) return 'Numista reference changed. Recheck this coin before publishing.';
  if (review.confirmedDate !== undefined && (typeof review.confirmedDate !== 'string' || String(attributes.year ?? '').trim() !== review.confirmedDate)) return 'The confirmed coin date changed. Recheck the date and type before publishing.';
  const actualWeight = positiveCoinMeasurement(attributes.supplied_weight_g ?? attributes.weight_g), actualDiameter = positiveCoinMeasurement(attributes.supplied_diameter_mm ?? attributes.diameter_mm);
  if (!actualWeight || !actualDiameter || actualWeight !== review.actualWeightGrams || actualDiameter !== review.actualDiameterMm || review.measurementsConfirmed !== true || review.identityConfirmed !== true) return 'Actual coin measurements or identity need confirmation. Return to the coin capture review.';
  const compared = compareCoinMeasurements({ weightGrams: review.catalogueWeightGrams, diameterMm: review.catalogueDiameterMm }, actualWeight, actualDiameter);
  if (compared.major) return 'Major Numista measurement mismatch. Correct the reference or measurements before publishing.';
  if (compared.warnings.length && (review.mismatchAcknowledged !== true || !review.mismatchNotes?.trim())) return 'Review and document the Numista measurement discrepancy before publishing.';
  return null;
}
