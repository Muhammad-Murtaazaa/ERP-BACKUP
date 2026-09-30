import type { Express, Request, Response } from 'express';
import crypto from 'node:crypto';
import { Money } from '@omnysync/financial-engine';
import { AccountingPurpose, ErrorCode, Permission } from '@omnysync/contracts';
import { db, auditLogger, outboxService, authenticate, requirePermission, requireAnyPermission } from '../context.js';
import { ok } from '../lib/http.js';
import { ApiError, validationError } from '../lib/errors.js';
import { arrayOf, dateOnly, decimal, optionalStr, pagination, str, todayIso, toIsoDate, uuid } from '../lib/validate.js';
import { requireOrgRow } from '../lib/scope.js';
import { transition } from '../lib/state.js';
import { postJournal } from '../lib/posting.js';
import { nextDocumentNumber } from '../lib/numbering.js';
import { requireParty } from '../lib/trading.js';

type Kind = 'RECEIPT' | 'DISBURSEMENT';

async function requireCashAccount(q: any, org: string, id: string) {
  const r = await q.query(`SELECT * FROM accounts WHERE id = $1 AND organization_id = $2`, [id, org]);
  const a = r.rows[0];
  if (!a || Number(a.level) !== 4 || !a.is_active || !(a.control_type === 'BANK' || String(a.code).startsWith('1110'))) {
    throw validationError('bank_account_id must be an active bank/cash posting account', { field: 'bank_account_id' });
  }
  return a;
}

/**
 * Records a customer receipt or supplier payment with allocations. Invoice rows are
 * locked FOR UPDATE so two concurrent payments cannot over-allocate the same invoice;
 * allocations can never exceed outstanding or the payment amount; the unapplied
 * remainder stays on the party control account and is tracked on the payment.
 */
async function recordPayment(req: Request, kind: Kind) {
  const org = req.session!.organization_id;
  const party_id = uuid(req.body?.party_id, 'party_id');
  const amount = decimal(req.body?.amount, 'amount', { sign: 'positive', scale: 2 });
  const bank_account_id = uuid(req.body?.bank_account_id, 'bank_account_id');
  const payment_date = dateOnly(req.body?.payment_date, 'payment_date', { defaultValue: todayIso() });
  const reference = optionalStr(req.body?.reference, 'reference', 255);
  const allocations = arrayOf<any>(req.body?.allocations ?? [], 'allocations', { min: 0, max: 500 }).map((a, i) => ({
    invoice_id: uuid(a?.invoice_id, `allocations[${i}].invoice_id`),
    amount: decimal(a?.amount, `allocations[${i}].amount`, { sign: 'positive', scale: 2 }),
  }));
  if (new Set(allocations.map((a) => a.invoice_id)).size !== allocations.length) throw validationError('Each invoice may appear only once in allocations', { field: 'allocations' });
  await requireParty(db, org, party_id, kind === 'RECEIPT' ? 'CUSTOMER' : 'VENDOR');
  await requireCashAccount(db, org, bank_account_id);
  const invoiceTable = kind === 'RECEIPT' ? 'ar_invoices' : 'ap_invoices';
  const invoiceType = kind === 'RECEIPT' ? 'AR' : 'AP';
  let allocTotal = Money.zero();
  for (const a of allocations) allocTotal = allocTotal.add(a.amount);
  if (allocTotal.gt(amount)) throw new ApiError(409, ErrorCode.OVER_ALLOCATION, `Allocations (${allocTotal.format()}) exceed payment amount (${new Money(amount).format()})`);

  return db.transaction(async (tx) => {
    const paymentId = crypto.randomUUID();
    const paymentNumber = optionalStr(req.body?.payment_number, 'payment_number', 64) || (await nextDocumentNumber(tx, org, kind === 'RECEIPT' ? 'RCPT' : 'PAY', payment_date));
    const sorted = [...allocations].sort((a, b) => a.invoice_id.localeCompare(b.invoice_id));
    const invoices: any[] = [];
    for (const a of sorted) {
      const inv = (await tx.query(`SELECT * FROM ${invoiceTable} WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [a.invoice_id, org])).rows[0];
      if (!inv) throw validationError(`Invoice ${a.invoice_id} not found`, { field: 'allocations' });
      if (inv.party_id !== party_id) throw validationError(`Invoice ${inv.invoice_number} belongs to a different party`, { field: 'allocations' });
      if (!['POSTED', 'PARTIALLY_PAID'].includes(inv.status)) throw new ApiError(409, ErrorCode.INVALID_STATE, `Invoice ${inv.invoice_number} is ${inv.status} and cannot receive allocations`);
      if (toIsoDate(inv.invoice_date) > payment_date) throw validationError(`Payment date is before invoice ${inv.invoice_number} date`, { field: 'payment_date' });
      if (new Money(a.amount).gt(inv.outstanding_amount)) {
        throw new ApiError(409, ErrorCode.OVER_ALLOCATION, `Allocation ${new Money(a.amount).format()} exceeds outstanding ${new Money(inv.outstanding_amount).format()} on ${inv.invoice_number}`);
      }
      invoices.push({ inv, amount: a.amount });
    }
    const unallocated = new Money(amount).sub(allocTotal);
    await tx.query(
      `INSERT INTO payments (id, organization_id, legal_entity_id, party_id, payment_type, payment_number, payment_date, bank_account_id, amount, currency, reference, status, created_by, unallocated_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PKR', $10, 'POSTED', $11, $12)`,
      [paymentId, org, req.session!.legal_entity_id, party_id, kind, paymentNumber, payment_date, bank_account_id, amount, reference, req.session!.user_id, unallocated.toFixed(8)],
    );
    for (const { inv, amount: amt } of invoices) {
      const outstanding = new Money(inv.outstanding_amount).sub(amt);
      await tx.query(`INSERT INTO allocations (id, organization_id, payment_id, invoice_id, invoice_type, allocated_amount, allocated_date) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [
        crypto.randomUUID(),
        org,
        paymentId,
        inv.id,
        invoiceType,
        amt,
        payment_date,
      ]);
      await tx.query(`UPDATE ${invoiceTable} SET outstanding_amount = $1, status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`, [
        outstanding.toFixed(8),
        outstanding.isZero() ? 'PAID' : 'PARTIALLY_PAID',
        inv.id,
      ]);
    }
    const lines =
      kind === 'RECEIPT'
        ? [
            { account_id: bank_account_id, debit: amount, description: `Receipt ${paymentNumber}` },
            { account_code: '112001', credit: amount, description: `AR settlement ${paymentNumber}` },
          ]
        : [
            { account_code: '211001', debit: amount, description: `AP settlement ${paymentNumber}` },
            { account_id: bank_account_id, credit: amount, description: `Payment ${paymentNumber}` },
          ];
    const posted = await postJournal(tx, auditLogger, outboxService, {
      organizationId: org,
      legalEntityId: req.session!.legal_entity_id,
      userId: req.session!.user_id,
      postingDate: payment_date,
      purpose: kind === 'RECEIPT' ? AccountingPurpose.CUSTOMER_PAYMENT : AccountingPurpose.SUPPLIER_PAYMENT,
      description: `${kind === 'RECEIPT' ? 'Customer receipt' : 'Supplier payment'} ${paymentNumber}${reference ? ` (${reference})` : ''}`,
      sourceType: 'PAYMENT',
      sourceId: paymentId,
      sourceKey: `PAYMENT:${paymentId}`,
      numberPrefix: kind === 'RECEIPT' ? 'JV-RCPT' : 'JV-PAY',
      correlationId: req.correlationId,
      lines,
    });
    await tx.query(`UPDATE payments SET posted_journal_id = $1 WHERE id = $2`, [posted?.journalId ?? null, paymentId]);
    await auditLogger.record(
      { organization_id: org, user_id: req.session!.user_id, action: `PAYMENT_${kind}_POSTED`, entity_type: 'PAYMENT', entity_id: paymentId, after_state: { payment_number: paymentNumber, amount, allocated: allocTotal.format(), unallocated: unallocated.format() }, correlation_id: req.correlationId },
      tx,
    );
    return { id: paymentId, payment_number: paymentNumber, status: 'POSTED', amount: new Money(amount).format(), allocated_amount: allocTotal.format(), unallocated_amount: unallocated.format(), posted_journal_id: posted?.journalId ?? null };
  });
}

export function registerPaymentsRoutes(app: Express): void {
  const payRead = requireAnyPermission(Permission.PAYMENT_MANAGE, Permission.AR_INVOICE_MANAGE, Permission.AP_INVOICE_MANAGE, Permission.FINANCE_REPORTS_VIEW, Permission.TREASURY_BANK_RECONCILE);

  app.get('/api/payments', authenticate, payRead, async (req: Request, res: Response) => {
    const { limit, offset } = pagination(req.query as any);
    const r = await db.query(
      `SELECT pm.*, p.name as party_name, p.code as party_code, a.name as bank_account_name
       FROM payments pm JOIN parties p ON p.id = pm.party_id LEFT JOIN accounts a ON a.id = pm.bank_account_id
       WHERE pm.organization_id = $1 ORDER BY pm.payment_date DESC, pm.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      [req.session!.organization_id],
    );
    return ok(req, res, r.rows, 200, { total_count: r.rows.length, limit, offset });
  });

  app.post('/api/payments/receipt', authenticate, requirePermission(Permission.PAYMENT_MANAGE), async (req: Request, res: Response) => ok(req, res, await recordPayment(req, 'RECEIPT'), 201));
  app.post('/api/payments/disbursement', authenticate, requirePermission(Permission.PAYMENT_MANAGE), async (req: Request, res: Response) => ok(req, res, await recordPayment(req, 'DISBURSEMENT'), 201));

  /** Cancel a payment: reverses its journal and allocations; invoices re-open. */
  app.post('/api/payments/:id/cancel', authenticate, requirePermission(Permission.PAYMENT_MANAGE), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const reason = str(req.body?.reason, 'reason', { max: 500 });
    const reversal_date = dateOnly(req.body?.reversal_date, 'reversal_date', { defaultValue: todayIso() });
    const out = await db.transaction(async (tx) => {
      const pm = await requireOrgRow(tx, 'payments', req.params.id, org, 'Payment', { forUpdate: true });
      if (reversal_date < toIsoDate(pm.payment_date)) throw validationError('reversal_date cannot be before the payment date', { field: 'reversal_date' });
      await transition(tx, { table: 'payments', id: pm.id, organizationId: org, from: ['POSTED'], to: 'CANCELLED', label: 'Payment', set: { cancelled_by: req.session!.user_id } });
      const table = pm.payment_type === 'RECEIPT' ? 'ar_invoices' : 'ap_invoices';
      const allocs = (await tx.query(`SELECT * FROM allocations WHERE payment_id = $1 AND reversed_at IS NULL ORDER BY invoice_id`, [pm.id])).rows;
      for (const a of allocs) {
        const inv = (await tx.query(`SELECT * FROM ${table} WHERE id = $1 FOR UPDATE`, [a.invoice_id])).rows[0];
        const outstanding = new Money(inv.outstanding_amount).add(a.allocated_amount);
        const status = outstanding.gte(inv.total_amount) ? 'POSTED' : 'PARTIALLY_PAID';
        await tx.query(`UPDATE ${table} SET outstanding_amount = $1, status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`, [outstanding.toFixed(8), status, inv.id]);
        await tx.query(`UPDATE allocations SET reversed_at = CURRENT_TIMESTAMP WHERE id = $1`, [a.id]);
      }
      let reversalId: string | null = null;
      if (pm.posted_journal_id) {
        const lines = (await tx.query(`SELECT * FROM journal_lines WHERE journal_id = $1 ORDER BY line_number`, [pm.posted_journal_id])).rows;
        const posted = await postJournal(tx, auditLogger, outboxService, {
          organizationId: org,
          legalEntityId: pm.legal_entity_id,
          userId: req.session!.user_id,
          postingDate: reversal_date,
          purpose: AccountingPurpose.REVERSAL,
          description: `Reversal of payment ${pm.payment_number}: ${reason}`,
          sourceType: 'PAYMENT',
          sourceId: pm.id,
          sourceKey: `PAYMENT_REVERSAL:${pm.id}`,
          numberPrefix: 'JV-REV',
          reversalOfJournalId: pm.posted_journal_id,
          correlationId: req.correlationId,
          lines: lines.map((l: any) => ({ account_id: l.account_id, debit: l.base_credit, credit: l.base_debit, description: `Reversal: ${l.description || ''}` })),
        });
        reversalId = posted?.journalId ?? null;
        if (reversalId) {
          await tx.query(`UPDATE journals SET status = 'REVERSED', reversed_by_journal_id = $1 WHERE id = $2 AND status = 'POSTED'`, [reversalId, pm.posted_journal_id]);
        }
      }
      await tx.query(`UPDATE payments SET reversal_journal_id = $1 WHERE id = $2`, [reversalId, pm.id]);
      await auditLogger.record({ organization_id: org, user_id: req.session!.user_id, action: 'PAYMENT_CANCELLED', entity_type: 'PAYMENT', entity_id: pm.id, after_state: { reason, reversal_journal_id: reversalId }, correlation_id: req.correlationId }, tx);
      return { id: pm.id, status: 'CANCELLED', reversal_journal_id: reversalId };
    });
    return ok(req, res, out);
  });
}
