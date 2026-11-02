export const FINAL_VALUE_FEE_TYPES = ['FINAL_VALUE_FEE', 'FINAL_VALUE_FEE_FIXED_PER_ORDER'] as const;

export interface EbayFeeTransaction {
  transaction_type?: string | null;
  amount?: number | string | null;
  booking_entry?: string | null;
}

/** Sum every persisted negative final-value-fee component for one order. */
export function aggregateActualEbayFees(rows: readonly EbayFeeTransaction[]): number {
  const total = rows.reduce((sum, row) => {
    if (!FINAL_VALUE_FEE_TYPES.includes(row.transaction_type as typeof FINAL_VALUE_FEE_TYPES[number])) return sum;
    const amount = Number(row.amount);
    const isDebit = row.booking_entry === 'DEBIT' || (!row.booking_entry && amount < 0);
    return Number.isFinite(amount) && isDebit ? sum + Math.abs(amount) : sum;
  }, 0);
  return Math.round((total + Number.EPSILON) * 100) / 100;
}

/** Replace only SWISH's fee-source marker; preserve all user-entered order notes. */
export function withActualEbayFeeNote(notes: string | null | undefined): string {
  const preserved = String(notes ?? '').split(/\s*\|\s*/).map(part => part.trim())
    .filter(part => part.length > 0 && !/^fee_note:/i.test(part));
  return [...preserved, 'fee_note:ACTUAL_EBAY'].join(' | ');
}
/**
 * Extract only non-sensitive, whitelisted fields from an eBay Finances error.
 * Never return raw provider bodies, longMessage, parameters, tokens or credentials.
 */
export function summarizeEbayFinanceError(body: string): string {
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return 'Provider error body was not valid JSON'; }
  if (!parsed || typeof parsed !== 'object') return 'Provider returned an unstructured error response';

  const root = parsed as Record<string, unknown>;
  const first = Array.isArray(root.errors) ? root.errors[0] : root.error && typeof root.error === 'object' ? root.error : root;
  if (!first || typeof first !== 'object') return 'Provider returned an unstructured error response';
  const error = first as Record<string, unknown>;
  const safeText = (value: unknown, max: number): string => typeof value === 'string'
    ? value.replace(/[\\r\\n\\t]+/g, ' ')
      .replace(/Bearer\\s+[A-Za-z0-9._~+\\/-]+=*/gi, 'Bearer [redacted]')
      .replace(/\\b(access_token|refresh_token|client_secret|clientId|password)\\b\\s*[:=]\\s*["']?[^"'\\s,}]+/gi, '$1=[redacted]')
      .replace(/\\beyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\b/g, '[redacted]')
      .slice(0, max)
    : '';
  const id = Number(error.errorId);
  const parts = [
    Number.isSafeInteger(id) && id > 0 ? `errorId=${id}` : '',
    safeText(error.domain, 48),
    safeText(error.category, 32),
    safeText(error.message, 160),
  ].filter(Boolean);
  return parts.length ? parts.join(' | ') : 'Provider returned an unstructured error response';
}
