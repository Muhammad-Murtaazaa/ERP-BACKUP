import { DbClient } from '@omnysync/platform';
import { Money } from '@omnysync/financial-engine';
import { ErrorCode } from '@omnysync/contracts';
import { ApiError, validationError } from './errors.js';
import { arrayOf, decimal, optionalStr, uuid } from './validate.js';

export interface DocLineInput {
  item_id: string;
  quantity: string;
  unit_price: string;
  description: string | null;
  source_line_id?: string | null;
}

export interface PricedLine extends DocLineInput {
  line_number: number;
  line_total: string;
  tax_rate: string;
  tax_amount: string;
  item: any;
}

/** Parses and validates document lines (qty > 0, price >= 0, <= 500 lines). */
export function parseLines(raw: unknown, field = 'lines'): DocLineInput[] {
  return arrayOf<any>(raw, field, { min: 1, max: 500 }).map((l, i) => ({
    item_id: uuid(l?.item_id, `${field}[${i}].item_id`),
    quantity: decimal(l?.quantity, `${field}[${i}].quantity`, { sign: 'positive' }),
    unit_price: decimal(l?.unit_price, `${field}[${i}].unit_price`, { sign: 'nonNegative' }),
    description: optionalStr(l?.description, `${field}[${i}].description`, 1000),
    source_line_id: l?.source_line_id ?? l?.line_id ?? null,
  }));
}

/**
 * Resolves items within the organisation and prices each line with exact decimals:
 * line_total = round2(qty * price); tax = round2(line_total * item.tax_rate / 100).
 */
export async function priceLines(q: DbClient, organizationId: string, lines: DocLineInput[]) {
  const priced: PricedLine[] = [];
  let subtotal = Money.zero();
  let tax = Money.zero();
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const r = await q.query(`SELECT * FROM items WHERE id = $1 AND organization_id = $2`, [l.item_id, organizationId]);
    const item = r.rows[0];
    if (!item) throw validationError(`Item ${l.item_id} not found`, { field: `lines[${i}].item_id` });
    if (!item.is_active) throw validationError(`Item ${item.code} is inactive`, { field: `lines[${i}].item_id` });
    const lineTotal = new Money(l.quantity).mul(l.unit_price).roundToCurrency();
    const rate = new Money(item.tax_rate ?? '0');
    const lineTax = lineTotal.mul(rate).div(100).roundToCurrency();
    subtotal = subtotal.add(lineTotal);
    tax = tax.add(lineTax);
    priced.push({ ...l, line_number: i + 1, line_total: lineTotal.toFixed(8), tax_rate: rate.toFixed(4), tax_amount: lineTax.toFixed(8), item });
  }
  return { lines: priced, subtotal: subtotal.toFixed(8), tax_amount: tax.toFixed(8), total_amount: subtotal.add(tax).toFixed(8) };
}

/** Party must belong to the org, be active and be of the right role. */
export async function requireParty(q: DbClient, organizationId: string, partyId: string, role: 'CUSTOMER' | 'VENDOR') {
  const r = await q.query(`SELECT * FROM parties WHERE id = $1 AND organization_id = $2`, [partyId, organizationId]);
  const p = r.rows[0];
  if (!p) throw validationError('Party not found', { field: 'party_id' });
  if (!p.is_active) throw validationError(`Party ${p.code} is inactive`, { field: 'party_id' });
  if (p.party_type !== role && p.party_type !== 'BOTH') {
    throw validationError(`Party ${p.code} is not a ${role.toLowerCase()}`, { field: 'party_id' });
  }
  return p;
}

/** Credit-limit check (limit 0 = unlimited). Open AR + open orders + new amount. */
export async function assertCreditLimit(q: DbClient, organizationId: string, party: any, additional: string, excludeOrderId?: string) {
  const limit = new Money(party.credit_limit || '0');
  if (!limit.isPositive()) return;
  const ar = await q.query(
    `SELECT COALESCE(SUM(outstanding_amount), 0)::text AS t FROM ar_invoices
     WHERE organization_id = $1 AND party_id = $2 AND status IN ('POSTED', 'PARTIALLY_PAID')`,
    [organizationId, party.id],
  );
  const so = await q.query(
    `SELECT COALESCE(SUM(total_amount), 0)::text AS t FROM sales_orders
     WHERE organization_id = $1 AND party_id = $2 AND status IN ('CONFIRMED', 'FULFILLED') AND id::text <> $3`,
    [organizationId, party.id, excludeOrderId || ''],
  );
  const exposure = new Money(ar.rows[0].t).add(so.rows[0].t).add(additional);
  if (exposure.gt(limit)) {
    throw new ApiError(409, ErrorCode.CREDIT_LIMIT_EXCEEDED, `Credit limit exceeded for ${party.code}: exposure ${exposure.format()} > limit ${limit.format()}`, {
      exposure: exposure.format(),
      credit_limit: limit.format(),
    });
  }
}

export async function accountByCode(q: DbClient, organizationId: string, code: string): Promise<string> {
  const r = await q.query(`SELECT id FROM accounts WHERE organization_id = $1 AND code = $2`, [organizationId, code]);
  if (!r.rows[0]) throw new ApiError(400, ErrorCode.MAPPING_MISSING, `Required GL account ${code} is not configured`);
  return r.rows[0].id;
}
