import { Money, sumMoney } from './money.js';

/**
 * A signed accounting intent line proposed by a source module. Either side may be
 * given; the engine nets them to one non-negative side per FINANCIAL-CONTROLS.md
 * ("No line may contain both debit and credit or a negative debit/credit. Zero
 * lines are omitted").
 */
export interface PostingIntentLine {
  account_id?: string | null;
  account_code?: string | null;
  debit?: string | Money | null;
  credit?: string | Money | null;
  description?: string | null;
  party_id?: string | null;
  project_id?: string | null;
  cost_center_id?: string | null;
  branch_id?: string | null;
}

export interface NormalizedPostingLine {
  account_id?: string | null;
  account_code?: string | null;
  debit: string;
  credit: string;
  description: string | null;
  party_id: string | null;
  project_id: string | null;
  cost_center_id: string | null;
  branch_id: string | null;
}

export interface NormalizedPosting {
  lines: NormalizedPostingLine[];
  totalDebit: Money;
  totalCredit: Money;
  balanced: boolean;
}

function asMoney(v: string | Money | null | undefined): Money {
  if (v === null || v === undefined || v === '') return Money.zero();
  return v instanceof Money ? v : new Money(v);
}

export class PostingEngine {
  /**
   * Nets each intent line to a single non-negative debit or credit at the working
   * scale, drops zero lines and reports whether the result balances exactly.
   * The input is never rounded silently: amounts beyond `scale` decimals are
   * rejected so callers must apply their own documented rounding first.
   */
  static normalize(lines: PostingIntentLine[], scale = 8): NormalizedPosting {
    const out: NormalizedPostingLine[] = [];
    for (const l of lines) {
      const net = asMoney(l.debit).sub(asMoney(l.credit));
      if (net.toDecimal().decimalPlaces() > scale) {
        throw new Error(`Posting amount ${net.toString()} exceeds working scale ${scale}; round explicitly before posting`);
      }
      if (net.isZero()) continue;
      out.push({
        account_id: l.account_id ?? null,
        account_code: l.account_code ?? null,
        debit: net.isPositive() ? net.toFixed(scale) : new Money(0).toFixed(scale),
        credit: net.isNegative() ? net.abs().toFixed(scale) : new Money(0).toFixed(scale),
        description: l.description ?? null,
        party_id: l.party_id ?? null,
        project_id: l.project_id ?? null,
        cost_center_id: l.cost_center_id ?? null,
        branch_id: l.branch_id ?? null,
      });
    }
    const totalDebit = sumMoney(out.map((l) => l.debit));
    const totalCredit = sumMoney(out.map((l) => l.credit));
    return { lines: out, totalDebit, totalCredit, balanced: totalDebit.eq(totalCredit) };
  }

  /**
   * Rounds an amount to currency minor units (half-up) and returns the residual
   * that must be posted to an explicit rounding account (never hidden in a plug).
   */
  static roundToCurrency(amount: Money | string, currencyScale = 2): { rounded: Money; residual: Money } {
    const m = amount instanceof Money ? amount : new Money(amount);
    const rounded = new Money(m.toDecimal().toDecimalPlaces(currencyScale));
    return { rounded, residual: m.sub(rounded) };
  }

  /**
   * Allocates `total` across weights so the parts sum exactly to `total` at the
   * given scale; the residual goes to the largest weight (deterministic, traceable).
   */
  static allocate(total: Money | string, weights: (Money | string)[], scale = 2): Money[] {
    const t = total instanceof Money ? total : new Money(total);
    if (weights.length === 0) return [];
    const ws = weights.map((w) => (w instanceof Money ? w : new Money(w)));
    if (ws.some((w) => w.isNegative())) throw new Error('Allocation weights cannot be negative');
    const sumW = sumMoney(ws);
    if (sumW.isZero()) throw new Error('Allocation weights sum to zero');
    const parts = ws.map((w) => new Money(t.mul(w).div(sumW).toDecimal().toDecimalPlaces(scale, 1 /* ROUND_DOWN */)));
    const residual = t.sub(sumMoney(parts));
    let maxIdx = 0;
    ws.forEach((w, i) => {
      if (w.gt(ws[maxIdx])) maxIdx = i;
    });
    parts[maxIdx] = parts[maxIdx].add(residual);
    return parts;
  }
}
