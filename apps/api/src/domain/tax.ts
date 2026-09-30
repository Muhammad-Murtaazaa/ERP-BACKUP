/**
 * Pure tax computation (TAX-*). HALF_UP to the currency scale per line; inclusive prices
 * extract tax as amount − amount / (1 + rate), so net + tax always equals the gross line.
 */
import { Money } from '@omnysync/financial-engine';

export interface TaxLineInput {
  amount: string;
  rate: string;
  inclusive?: boolean;
}
export interface TaxLineResult {
  net: string;
  tax: string;
  gross: string;
}

export function computeTax(line: TaxLineInput, scale = 2): TaxLineResult {
  const amt = new Money(line.amount);
  const r = new Money(line.rate).div(100);
  if (line.inclusive) {
    const gross = amt.round(scale);
    const net = gross.div(r.add(1)).round(scale);
    const tax = gross.sub(net);
    return { net: net.toFixed(scale), tax: tax.toFixed(scale), gross: gross.toFixed(scale) };
  }
  const net = amt.round(scale);
  const tax = net.mul(r).round(scale);
  return { net: net.toFixed(scale), tax: tax.toFixed(scale), gross: net.add(tax).toFixed(scale) };
}

/** Picks the tax code version effective on `date` (effective_to inclusive). */
export function effectiveCode<T extends { effective_from: string; effective_to?: string | null; status?: string }>(versions: T[], date: string): T | null {
  const d = date.slice(0, 10);
  const hits = versions
    .filter((v) => v.status !== 'RETIRED' && String(v.effective_from).slice(0, 10) <= d && (!v.effective_to || String(v.effective_to).slice(0, 10) >= d))
    .sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from)));
  return hits[0] || null;
}

/** True when two [from, to] windows (to = null means open-ended) overlap. */
export function windowsOverlap(aFrom: string, aTo: string | null | undefined, bFrom: string, bTo: string | null | undefined): boolean {
  const aEnd = aTo || '9999-12-31';
  const bEnd = bTo || '9999-12-31';
  return aFrom.slice(0, 10) <= bEnd.slice(0, 10) && bFrom.slice(0, 10) <= aEnd.slice(0, 10);
}
