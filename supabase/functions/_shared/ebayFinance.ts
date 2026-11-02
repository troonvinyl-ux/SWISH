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