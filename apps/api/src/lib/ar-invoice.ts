/**
 * Creates and posts a customer invoice from an operational source (service work order,
 * subscription period). Same accounting as a manual AR invoice post (DR AR control / CR revenue
 * per item account / CR output tax), inside the caller's unit of work, keyed by `sourceKey` so
 * the same source can never be billed twice (DUPLICATE_SOURCE_PURPOSE / ALREADY_BILLED).
 */
import crypto from 'node:crypto';
import { AccountingPurpose, ErrorCode } from '@omnysync/contracts';
import { Money } from '@omnysync/financial-engine';
import { auditLogger, outboxService } from '../context.js';
import { postJournal } from './posting.js';
import { nextDocumentNumber } from './numbering.js';
import { ApiError } from './errors.js';
import type { Ctx } from './resource.js';
import { computeTax } from '../domain/tax.js';

export interface SourceInvoiceLine {
  item_id: string;
  description: string;
  quantity: string;
  unit_price: string;
  tax_rate: string;
  revenue_account_code?: string;
}

export async function createPostedSourceInvoice(
  ctx: Ctx,
  input: { party_id: string; invoice_date: string; due_days?: number; lines: SourceInvoiceLine[]; sourceType: string; sourceId: string; sourceKey: string; notes?: string; purpose?: string; prefix?: string },
) {
  const dup = await ctx.tx.query(`SELECT id FROM journals WHERE organization_id = $1 AND source_key = $2`, [ctx.org, input.sourceKey]);
  if (dup.rows.length) throw new ApiError(409, ErrorCode.ALREADY_BILLED, `Source ${input.sourceKey} has already been invoiced`);
  const priced = input.lines.map((l) => {
    const net = new Money(l.quantity).mul(l.unit_price).round(2).toFixed(2);
    const t = computeTax({ amount: net, rate: l.tax_rate });
    return { ...l, line_total: t.net, tax_amount: t.tax };
  });
  const subtotal = priced.reduce((a, l) => a.add(l.line_total), Money.zero());
  const tax = priced.reduce((a, l) => a.add(l.tax_amount), Money.zero());
  const total = subtotal.add(tax);
  if (!total.isPositive()) return null;
  const id = crypto.randomUUID();
  const number = await nextDocumentNumber(ctx.tx, ctx.org, input.prefix || 'INV', input.invoice_date);
  const due = new Date(Date.parse(input.invoice_date) + (input.due_days ?? 30) * 86400000).toISOString().slice(0, 10);
  await ctx.tx.query(
    `INSERT INTO ar_invoices (id, organization_id, legal_entity_id, party_id, invoice_number, invoice_date, due_date, status, subtotal, tax_amount, total_amount, outstanding_amount, notes, created_by, posted_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'POSTED',$8,$9,$10,$10,$11,$12,$12)`,
    [id, ctx.org, ctx.le, input.party_id, number, input.invoice_date, due, subtotal.toFixed(8), tax.toFixed(8), total.toFixed(8), input.notes || null, ctx.user],
  );
  let n = 1;
  const revenue = new Map<string, Money>();
  for (const l of priced) {
    await ctx.tx.query(
      `INSERT INTO ar_invoice_lines (id, invoice_id, line_number, item_id, quantity, unit_price, line_total, tax_amount, description) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [crypto.randomUUID(), id, n++, l.item_id, l.quantity, l.unit_price, l.line_total, l.tax_amount, l.description],
    );
    const acc = l.revenue_account_code || '411002';
    revenue.set(acc, (revenue.get(acc) || Money.zero()).add(l.line_total));
  }
  const jLines: any[] = [{ account_code: '112001', debit: total.toFixed(8), party_id: input.party_id, description: `AR ${number}` }];
  for (const [code, amt] of revenue) if (amt.isPositive()) jLines.push({ account_code: code, credit: amt.toFixed(8), description: `Revenue ${number}` });
  if (tax.isPositive()) jLines.push({ account_code: '212001', credit: tax.toFixed(8), description: `Output tax ${number}` });
  const posted = await postJournal(ctx.tx, auditLogger, outboxService, {
    organizationId: ctx.org, legalEntityId: ctx.le, userId: ctx.user, postingDate: input.invoice_date, purpose: input.purpose || AccountingPurpose.SALES_INVOICE,
    description: `Customer invoice ${number}`, sourceType: input.sourceType, sourceId: input.sourceId, sourceKey: input.sourceKey, numberPrefix: 'JV-AR', correlationId: ctx.req.correlationId, lines: jLines,
  });
  await ctx.tx.query(`UPDATE ar_invoices SET posted_journal_id = $1 WHERE id = $2`, [posted?.journalId ?? null, id]);
  return { id, invoice_number: number, subtotal: subtotal.toFixed(2), tax_amount: tax.toFixed(2), total_amount: total.toFixed(2), journal_number: posted?.journalNumber ?? null };
}
