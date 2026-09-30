/**
 * Pick allocation (WMS). Allocates each requested quantity across bins: PICK bins before
 * BULK, then the largest quantity first, then bin code (deterministic). Never allocates more
 * than a bin holds; unallocated remainder is reported as a shortage line (bin = null).
 */
import { Money } from '@omnysync/financial-engine';

export interface BinQty {
  bin_id: string;
  bin_code: string;
  bin_type: string;
  quantity: string;
}
export interface Allocation {
  bin_id: string | null;
  quantity: string;
}

export function allocatePick(requested: string, bins: BinQty[]): { allocations: Allocation[]; shortage: string } {
  let remaining = new Money(requested);
  const rank = (t: string) => (t === 'PICK' ? 0 : t === 'BULK' ? 1 : 2);
  const usable = bins
    .filter((b) => (b.bin_type === 'PICK' || b.bin_type === 'BULK') && new Money(b.quantity).isPositive())
    .sort((a, b) => rank(a.bin_type) - rank(b.bin_type) || new Money(b.quantity).toDecimal().comparedTo(new Money(a.quantity).toDecimal()) || a.bin_code.localeCompare(b.bin_code));
  const allocations: Allocation[] = [];
  for (const b of usable) {
    if (!remaining.isPositive()) break;
    const take = Money.min(remaining, b.quantity);
    allocations.push({ bin_id: b.bin_id, quantity: take.toFixed(8) });
    remaining = remaining.sub(take);
  }
  if (remaining.isPositive()) allocations.push({ bin_id: null, quantity: remaining.toFixed(8) });
  return { allocations, shortage: remaining.isPositive() ? remaining.toFixed(8) : '0' };
}
