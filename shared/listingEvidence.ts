/**
 * SWISH evidence-led listing safeguards.
 * Main app is the authority; the web adapter mirrors these pure contracts.
 * Never treat catalogue data or an AI guess as physical-copy confirmation.
 * No database queries, publication calls or alternate storage.
 */
export type ListingClaimOrigin = 'photo_observation' | 'seller_reported' | 'catalogue' | 'suggestion' | 'unknown';
export interface ListingClaim {
  value: string;
  origin: ListingClaimOrigin;
  reviewed: boolean;
}
export function listingClaimState(claim: ListingClaim): 'reported' | 'catalogue' | 'unconfirmed' | 'unknown' {
  if (!claim.value.trim() || claim.origin === 'unknown') return 'unknown';
  if (claim.origin === 'catalogue') return 'catalogue';
  if (claim.origin === 'suggestion' || !claim.reviewed) return 'unconfirmed';
  // Reviewing a statement confirms only the seller's report, not authenticity.
  return 'reported';
}

function discNumber(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const raw = String(value).trim();
  if (!/^\d{1,3}$/.test(raw)) return null;
  const count = Number(raw);
  return count > 0 && count <= 999 ? count : null;
}
export interface MusicContentsEvidence {
  expected: number | null;
  observed: number | null;
  status: 'incomplete' | 'count_matches' | 'extra' | 'unknown';
  disclosure: string;
  unit: 'records' | 'discs';
}
/** A release's catalogue quantity never supplies the seller's physical count. */
export function musicContentsEvidence(expected: unknown, observed: unknown, format = ''): MusicContentsEvidence {
  const e = discNumber(expected), o = discNumber(observed);
  const unit = /\b(vinyl|lp|record|records)\b/i.test(format) ? 'records' : 'discs';
  const status = e !== null && o !== null
    ? (o < e ? 'incomplete' : o > e ? 'extra' : 'count_matches') : 'unknown';
  const disclosure = status === 'incomplete'
    ? `Incomplete — ${o} of ${e} ${unit} included`
    : status === 'extra'
      ? `Seller reports ${o} ${unit}; selected catalogue release lists ${e}. Contents need checking.`
      : status === 'count_matches'
        ? `Seller reports ${o} ${unit}; catalogue lists ${e}. Exact disc identities not independently verified.`
        : `Physical ${unit} included: ${o === null ? 'unknown' : o}. Catalogue quantity: ${e === null ? 'unknown' : e}. Exact contents not established.`;
  return {expected:e,observed:o,status,disclosure,unit};
}
/**
 * A missing physical disc must not be described as included. The caller must
 * supply safe description copy, without an unverified whole-release tracklist.
 */
export function protectMusicListingCopy(title: string, description: string, evidence: MusicContentsEvidence): {title: string; description: string} {
  const prefix = evidence.status === 'incomplete' ? evidence.disclosure : '';
  const cleanTitle = title.trim().replace(/^Incomplete\s*[—-]\s*\d+\s+of\s+\d+\s+(?:records|discs)\s+included\s*[|:-]?\s*/i, '');
  const combined = prefix ? `${prefix} — ${cleanTitle}` : cleanTitle;
  const safeTitle = combined.length <= 80 ? combined : combined.slice(0, 81).replace(/\s+\S*$/, '').slice(0, 80);
  const line = `Included contents: ${evidence.disclosure}`;
  const safeDescription = description.includes(evidence.disclosure) ? description : `${line}\nMissing disc identity is not assumed from catalogue track positions.\n\n${description}`;
  return {title:safeTitle,description:safeDescription};
}
/** Unattributed drafts must not repeat an unsupported historical attribution. */
export function unattributedCoinCopy(weight: unknown, diameter: unknown): {title:string;description:string} {
  const measured = (value:unknown, unit:string) => {
    if (typeof value !== 'string' && typeof value !== 'number') return 'unknown';
    const number=String(value).trim();
    return /^\d+(?:\.\d+)?$/.test(number) && Number(number)>0 ? `${number} ${unit} (seller-measured)` : 'unknown';
  };
  return {
    title:'Unattributed coin — see actual photographs',
    description:[
      'Item', 'Unattributed coin shown in the seller’s own photographs. No issuer, date, denomination or historical culture is confirmed.',
      '', 'Included contents', 'The photographed coin only.',
      '', 'Condition and faults', 'Inspect the actual photographs for wear, marks and surface faults. The coin has not been independently authenticated.',
      '', 'Measurements', `Weight: ${measured(weight,'g')}`, `Diameter: ${measured(diameter,'mm')}`,
      '', 'Unknowns', 'Issuer, denomination, date, origin and authenticity are not established.',
    ].join('\n'),
  };
}
/** Classification must be anchored to the physical object, not its cover art. */
export function physicalCategory(physicalObject: string, depictedSubject: string): 'books' | 'coins' | 'unknown' {
  const physical = physicalObject.trim().toLowerCase();
  if (/\b(book|hardback|hardcover|paperback|bound volume)\b/.test(physical)) return 'books';
  if (/\b(coin|numismatic coin|token)\b/.test(physical)) return 'coins';
  // A subject such as "Greek coins" provides no category evidence.
  void depictedSubject;
  return 'unknown';
}
