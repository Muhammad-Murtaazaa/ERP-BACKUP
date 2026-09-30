/**
 * Decimal-safe display and arithmetic helpers for the web client. Money and quantities
 * arrive from the API as decimal strings; these never go through binary floats
 * (PRD money rule), so totals shown in the UI match the ledger to the last paisa.
 */
import { Money } from '@omnysync/financial-engine';

type Num = string | number | null | undefined;

const toMoney = (v: Num): Money | null => {
  if (v === null || v === undefined || v === '') return Money.zero();
  try {
    return new Money(String(v).replace(/,/g, '').trim());
  } catch {
    return null;
  }
};

const group = (fixed: string) => {
  const [int, dec] = fixed.split('.');
  const neg = int.startsWith('-');
  const digits = (neg ? int.slice(1) : int).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sign = neg && !/^[0.,]*$/.test(digits + (dec || '')) ? '-' : '';
  return `${sign}${digits}${dec !== undefined ? `.${dec}` : ''}`;
};

/** 1234567.5 → "1,234,567.50" (HALF_UP, grouped). Invalid input is shown verbatim. */
export function fmtMoney(v: Num, scale = 2): string {
  const m = toMoney(v);
  return m ? group(m.toFixed(scale)) : String(v);
}

/** Fixed decimals without grouping, e.g. rates: fmtDec("278.5", 4) → "278.5000". */
export function fmtDec(v: Num, scale = 2): string {
  const m = toMoney(v);
  if (!m) return String(v);
  const s = m.toFixed(scale);
  return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s;
}

/** Quantity with grouping and trailing zeros trimmed: "1500.000" → "1,500". */
export function fmtQty(v: Num, maxScale = 3): string {
  const m = toMoney(v);
  if (!m) return String(v);
  const fixed = m.toFixed(maxScale).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return group(fixed);
}

export function isPositive(v: Num): boolean {
  const m = toMoney(v);
  return !!m && m.isPositive() && !m.isZero();
}

export function isNegative(v: Num): boolean {
  const m = toMoney(v);
  return !!m && m.isNegative();
}

/** Exact decimal sum of strings/numbers → fixed string. */
export function sumDec(values: Num[], scale = 2): string {
  return values.reduce<Money>((acc, v) => acc.add(toMoney(v) || Money.zero()), Money.zero()).toFixed(scale);
}

export function mulDec(a: Num, b: Num, scale = 2): string {
  return (toMoney(a) || Money.zero()).mul(toMoney(b) || Money.zero()).toFixed(scale);
}

export function cmpDec(a: Num, b: Num): -1 | 0 | 1 {
  const x = toMoney(a) || Money.zero();
  const y = toMoney(b) || Money.zero();
  return x.gt(y) ? 1 : x.lt(y) ? -1 : 0;
}
