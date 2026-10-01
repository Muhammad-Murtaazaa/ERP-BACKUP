/**
 * LND — customer instalment financing. Loans are applied for (DRAFT), submitted, approved with
 * segregation of duties, then disbursed: the schedule is generated and DR 112004 loans receivable /
 * CR 111002 bank posts once. Repayments are allocated oldest instalment first, interest before
 * principal, and post DR bank / CR 411006 interest income / CR 112004. Interest is recognised on
 * a cash basis when collected (no period-end accrual). Instalments unpaid after `lnd.grace_days`
 * are charged one flat late fee (`lnd.late_fee_flat`); fees are collected first and credited to
 * 411005 when collected.
 */
import { getSetting } from './config.js';
import type { Express, Request, Response } from 'express';
import { Permission, ErrorCode, AccountingPurpose } from '@omnysync/contracts';
import { Money } from '@omnysync/financial-engine';
import { db, authenticate, requireAnyPermission, auditLogger, outboxService } from '../context.js';
import { ok } from '../lib/http.js';
import { ApiError, validationError } from '../lib/errors.js';
import { defineResource, loadRow, unitOfWork, audit, emit } from '../lib/resource.js';
import { requireModule } from '../lib/modules.js';
import { dateOnly, toIsoDate, todayIso } from '../lib/validate.js';
import { postJournal } from '../lib/posting.js';
import { addMonths } from './subscriptions.js';

const VIEW = [Permission.LOAN_VIEW, Permission.LOAN_MANAGE, Permission.LOAN_APPROVE, Permission.LOAN_POST];

export interface Instalment { seq: number; due_date: string; principal: string; interest: string; }

/** Amortisation schedule; the final instalment absorbs all rounding so principal sums exactly. */
export function amortise(principal: string, annualRate: string, months: number, firstDue: string, method: 'ANNUITY' | 'EQUAL_PRINCIPAL' = 'ANNUITY'): Instalment[] {
  const P = new Money(principal).round(2);
  const r = Number(annualRate) / 1200;
  const pay = r === 0 ? P.div(months).round(2) : new Money((Number(P.toFixed(2)) * r) / (1 - Math.pow(1 + r, -months))).round(2);
  const flat = P.div(months).round(2);
  let bal = P;
  const out: Instalment[] = [];
  for (let k = 1; k <= months; k++) {
    const interest = new Money(bal.toFixed(2)).mul(String(r)).round(2);
    let prin = method === 'ANNUITY' ? pay.sub(interest) : flat;
    if (k === months || prin.gt(bal)) prin = bal;
    if (prin.isNegative()) prin = Money.zero();
    bal = bal.sub(prin);
    out.push({ seq: k, due_date: addMonths(firstDue, k - 1), principal: prin.toFixed(2), interest: interest.toFixed(2) });
  }
  return out;
}

/** Allocates a payment over open instalments (oldest first): per instalment late fee, then interest, then principal. */
export function allocate(rows: { id: string; principal: string; interest: string; paid_principal: string; paid_interest: string; late_fee?: string; paid_late_fee?: string }[], amount: string) {
  let left = new Money(amount);
  let interest = Money.zero();
  let principal = Money.zero();
  let fees = Money.zero();
  const updates: { id: string; interest: string; principal: string; fee: string }[] = [];
  for (const r of rows) {
    if (!left.isPositive()) break;
    const fDue = new Money(r.late_fee ?? '0').sub(r.paid_late_fee ?? '0');
    const fPay = fDue.lt(left) ? fDue : left;
    left = left.sub(fPay);
    const iDue = new Money(r.interest).sub(r.paid_interest);
    const iPay = iDue.lt(left) ? iDue : left;
    left = left.sub(iPay);
    const pDue = new Money(r.principal).sub(r.paid_principal);
    const pPay = pDue.lt(left) ? pDue : left;
    left = left.sub(pPay);
    if (fPay.isPositive() || iPay.isPositive() || pPay.isPositive()) updates.push({ id: r.id, interest: iPay.toFixed(2), principal: pPay.toFixed(2), fee: fPay.toFixed(2) });
    interest = interest.add(iPay);
    principal = principal.add(pPay);
    fees = fees.add(fPay);
  }
  return { interest: interest.toFixed(2), principal: principal.toFixed(2), fees: fees.toFixed(2), unapplied: left.toFixed(2), updates };
}

/** Charges one flat late fee on each instalment still unpaid after the grace period (idempotent per instalment). Shared by the route and the LND-LATE-FEES job. */
export async function assessLateFees(ctx: Parameters<typeof audit>[0], asOf: string) {
  const fee = new Money(await getSetting<string>(ctx.tx, ctx.org, 'lnd.late_fee_flat'));
  const grace = Number(await getSetting<number>(ctx.tx, ctx.org, 'lnd.grace_days'));
  if (!fee.isPositive()) return { as_of: asOf, assessed: 0, fees: '0.00', instalments: [] };
  const due = (
    await ctx.tx.query(
      `SELECT s.id, s.seq, s.due_date, l.number FROM lnd_schedule s JOIN lnd_loans l ON l.id = s.loan_id
       WHERE s.organization_id = $1 AND l.status = 'ACTIVE' AND s.late_fee_assessed_on IS NULL AND (s.paid_principal < s.principal OR s.paid_interest < s.interest)
         AND s.due_date + ($2::int) < $3::date ORDER BY l.number, s.seq FOR UPDATE OF s`,
      [ctx.org, grace, asOf],
    )
  ).rows;
  for (const r of due) await ctx.tx.query(`UPDATE lnd_schedule SET late_fee = $2, late_fee_assessed_on = $3 WHERE id = $1`, [r.id, fee.toFixed(8), asOf]);
  if (due.length) await audit(ctx, 'LATE_FEES_ASSESSED', 'LOAN', ctx.org, undefined, { as_of: asOf, count: due.length, fee: fee.toFixed(2) });
  return { as_of: asOf, assessed: due.length, fees: fee.mul(due.length).toFixed(2), instalments: due.map((r: any) => `${r.number}#${r.seq}`) };
}

export function registerLendingRoutes(app: Express): void {
  defineResource(app, {
    path: '/api/lnd/loans',
    table: 'lnd_loans',
    label: 'Loan',
    event: 'LOAN',
    module: 'LND',
    view: VIEW,
    create: Permission.LOAN_MANAGE,
    update: Permission.LOAN_MANAGE,
    fields: {
      party_id: { type: 'ref', table: 'parties', required: true, label: 'party_id' },
      purpose: { type: 'text' },
      principal: { type: 'decimal', required: true, sign: 'positive', scale: 2 },
      annual_rate: { type: 'decimal', required: true, scale: 4 },
      term_months: { type: 'int', required: true, min: 1, max: 360 },
      method: { type: 'enum', values: ['ANNUITY', 'EQUAL_PRINCIPAL'], default: 'ANNUITY' },
      application_date: { type: 'date', defaultToday: true },
    },
    editable: ['purpose', 'principal', 'annual_rate', 'term_months', 'method'],
    editableIn: ['DRAFT'],
    numbering: { column: 'number', prefix: 'LN', dateField: 'application_date' },
    initialStatus: 'DRAFT',
    select: `t.*, p.name AS party_name,
      (SELECT COALESCE(SUM(principal - paid_principal + interest - paid_interest),0) FROM lnd_schedule s WHERE s.loan_id = t.id AND s.due_date < CURRENT_DATE) AS overdue_amount,
      (SELECT MIN(due_date) FROM lnd_schedule s WHERE s.loan_id = t.id AND (s.paid_principal < s.principal OR s.paid_interest < s.interest)) AS next_due_date`,
    joins: 'JOIN parties p ON p.id = t.party_id',
    search: ['number', 'p.name'],
    filters: ['party_id'],
    beforeCreate: async (_c, v) => {
      if (new Money(v.annual_rate).isNegative() || new Money(v.annual_rate).gt(100)) throw validationError('annual_rate must be between 0 and 100', { field: 'annual_rate' });
    },
    beforeUpdate: async (_c, _r, v) => {
      if (v.annual_rate !== undefined && (new Money(v.annual_rate).isNegative() || new Money(v.annual_rate).gt(100))) throw validationError('annual_rate must be between 0 and 100', { field: 'annual_rate' });
    },
    detail: async (q, row) => {
      const schedule = (await q.query(`SELECT * FROM lnd_schedule WHERE loan_id = $1 ORDER BY seq`, [row.id])).rows;
      return {
        schedule: schedule.length ? schedule : amortise(row.principal, row.annual_rate, row.term_months, addMonths(toIsoDate(row.application_date), 1), row.method).map((s) => ({ ...s, preview: true })),
        repayments: (await q.query(`SELECT r.*, j.journal_number FROM lnd_repayments r LEFT JOIN journals j ON j.id = r.journal_id WHERE r.loan_id = $1 ORDER BY r.payment_date DESC, r.created_at DESC`, [row.id])).rows,
      };
    },
    commands: {
      submit: { from: ['DRAFT'], to: 'SUBMITTED', permission: Permission.LOAN_MANAGE, run: async (ctx) => ({ set: { submitted_by: ctx.user } }) },
      approve: { from: ['SUBMITTED'], to: 'APPROVED', permission: Permission.LOAN_APPROVE, sodColumn: 'submitted_by', fields: { decision_note: { type: 'text' } }, run: async (ctx, _r, i) => ({ set: { approved_by: ctx.user, decision_note: i.decision_note ?? null } }) },
      reject: { from: ['SUBMITTED'], to: 'REJECTED', permission: Permission.LOAN_APPROVE, fields: { decision_note: { type: 'text', required: true } }, run: async (_c, _r, i) => ({ set: { decision_note: i.decision_note } }) },
      disburse: {
        from: ['APPROVED'],
        to: 'ACTIVE',
        permission: Permission.LOAN_POST,
        sodColumn: 'approved_by',
        fields: { disbursement_date: { type: 'date', defaultToday: true }, first_due_date: { type: 'date' } },
        run: async (ctx, row, i) => {
          const d = String(i.disbursement_date || todayIso());
          const first = i.first_due_date ? String(i.first_due_date) : addMonths(d, 1);
          if (first <= d) throw validationError('first_due_date must be after the disbursement date', { field: 'first_due_date' });
          const amt = new Money(row.principal).toFixed(8);
          const j = await postJournal(ctx.tx, auditLogger, outboxService, {
            organizationId: ctx.org, legalEntityId: ctx.le, userId: ctx.user, postingDate: d, purpose: AccountingPurpose.LOAN_DISBURSEMENT,
            description: `Loan ${row.number} disbursed`, sourceType: 'LOAN', sourceId: row.id, sourceKey: `LND_DISB:${row.id}`, numberPrefix: 'JV-LND', correlationId: ctx.req.correlationId,
            lines: [
              { account_code: '112004', debit: amt, party_id: row.party_id, description: `Loan receivable ${row.number}` },
              { account_code: '111002', credit: amt, description: `Disbursement ${row.number}` },
            ],
          });
          for (const s of amortise(row.principal, row.annual_rate, row.term_months, first, row.method)) {
            await ctx.tx.query(`INSERT INTO lnd_schedule (organization_id, loan_id, seq, due_date, principal, interest) VALUES ($1,$2,$3,$4,$5,$6)`, [ctx.org, row.id, s.seq, s.due_date, s.principal, s.interest]);
          }
          return { set: { disbursement_date: d, first_due_date: first, outstanding_principal: amt, disbursement_journal_id: j?.journalId ?? null }, data: j };
        },
      },
    },
  });

  app.post('/api/lnd/loans/:id/repayments', authenticate, requireAnyPermission(Permission.LOAN_POST), requireModule('LND', 'command'), async (req: Request, res: Response) => {
    const b = req.body || {};
    const paymentDate = b.payment_date ? dateOnly(b.payment_date, 'payment_date') : todayIso();
    if (!/^\d+(\.\d{1,2})?$/.test(String(b.amount ?? '')) || !new Money(String(b.amount)).isPositive()) throw validationError('amount must be a positive amount', { field: 'amount' });
    const reference = String(b.reference ?? '').trim();
    if (!reference || reference.length > 64) throw validationError('reference is required (receipt / bank ref)', { field: 'reference' });
    const out = await unitOfWork(req, async (ctx) => {
      const loan = await loadRow(ctx.tx, 'lnd_loans', req.params.id, ctx.org, 'Loan', true);
      if (loan.status !== 'ACTIVE') throw new ApiError(409, ErrorCode.INVALID_STATE, `Loan ${loan.number} is ${loan.status.toLowerCase()}`);
      if (paymentDate < toIsoDate(loan.disbursement_date)) throw validationError('payment_date is before disbursement', { field: 'payment_date' });
      const dup = await ctx.tx.query(`SELECT id FROM lnd_repayments WHERE loan_id = $1 AND reference = $2`, [loan.id, reference]);
      if (dup.rows.length) throw new ApiError(409, ErrorCode.DUPLICATE_RESOURCE, `Repayment ${reference} is already recorded`);
      const open = (await ctx.tx.query(`SELECT id, principal::text, interest::text, paid_principal::text, paid_interest::text, late_fee::text, paid_late_fee::text FROM lnd_schedule WHERE loan_id = $1 AND (paid_principal < principal OR paid_interest < interest OR paid_late_fee < late_fee) ORDER BY seq FOR UPDATE`, [loan.id])).rows;
      const a = allocate(open, String(b.amount));
      if (new Money(a.unapplied).isPositive()) throw validationError(`Payment exceeds the remaining balance by ${a.unapplied}`, { field: 'amount' });
      const rep = await ctx.tx.query(
        `INSERT INTO lnd_repayments (organization_id, loan_id, payment_date, amount, interest_part, principal_part, fee_part, reference, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [ctx.org, loan.id, paymentDate, String(b.amount), a.interest, a.principal, a.fees, reference, ctx.user],
      );
      const lines: any[] = [{ account_code: '111002', debit: new Money(String(b.amount)).toFixed(8), description: `Repayment ${reference}` }];
      if (new Money(a.fees).isPositive()) lines.push({ account_code: '411005', credit: new Money(a.fees).toFixed(8), description: `Late fees ${loan.number}` });
      if (new Money(a.interest).isPositive()) lines.push({ account_code: '411006', credit: new Money(a.interest).toFixed(8), description: `Interest ${loan.number}` });
      if (new Money(a.principal).isPositive()) lines.push({ account_code: '112004', credit: new Money(a.principal).toFixed(8), party_id: loan.party_id, description: `Principal ${loan.number}` });
      const j = await postJournal(ctx.tx, auditLogger, outboxService, {
        organizationId: ctx.org, legalEntityId: ctx.le, userId: ctx.user, postingDate: paymentDate, purpose: AccountingPurpose.LOAN_REPAYMENT,
        description: `Loan ${loan.number} repayment ${reference}`, sourceType: 'LOAN_REPAYMENT', sourceId: rep.rows[0].id, sourceKey: `LND_REPAY:${rep.rows[0].id}`, numberPrefix: 'JV-LND', correlationId: ctx.req.correlationId, lines,
      });
      await ctx.tx.query(`UPDATE lnd_repayments SET journal_id = $2 WHERE id = $1`, [rep.rows[0].id, j?.journalId ?? null]);
      for (const u of a.updates) await ctx.tx.query(`UPDATE lnd_schedule SET paid_interest = paid_interest + $2, paid_principal = paid_principal + $3, paid_late_fee = paid_late_fee + $4 WHERE id = $1`, [u.id, u.interest, u.principal, u.fee]);
      const outstanding = new Money(loan.outstanding_principal).sub(a.principal);
      const closed = !(await ctx.tx.query(`SELECT 1 FROM lnd_schedule WHERE loan_id = $1 AND (paid_principal < principal OR paid_interest < interest OR paid_late_fee < late_fee) LIMIT 1`, [loan.id])).rows.length;
      await ctx.tx.query(`UPDATE lnd_loans SET outstanding_principal = $2, status = $3, revision = revision + 1, updated_at = NOW() WHERE id = $1`, [loan.id, outstanding.toFixed(8), closed ? 'CLOSED' : 'ACTIVE']);
      await audit(ctx, 'REPAYMENT', 'LOAN', loan.id, undefined, { reference, amount: String(b.amount), fees: a.fees, interest: a.interest, principal: a.principal });
      await emit(ctx, closed ? 'LOAN_CLOSED' : 'LOAN_REPAYMENT', { loan_id: loan.id, number: loan.number, amount: String(b.amount) });
      return { ...rep.rows[0], journal_number: j?.journalNumber ?? null, outstanding_principal: outstanding.toFixed(2), loan_status: closed ? 'CLOSED' : 'ACTIVE' };
    });
    return ok(req, res, out, 201);
  });

  /** Charges one flat late fee on each instalment still unpaid after the grace period (idempotent per instalment). */
  app.post('/api/lnd/late-fees/assess', authenticate, requireAnyPermission(Permission.LOAN_POST), requireModule('LND', 'command'), async (req: Request, res: Response) => {
    const asOf = req.body?.as_of ? dateOnly(req.body.as_of, 'as_of') : todayIso();
    const out = await unitOfWork(req, (ctx) => assessLateFees(ctx, asOf));
    return ok(req, res, out);
  });

  app.get('/api/lnd/summary', authenticate, requireAnyPermission(...VIEW), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const l = (await db.query(`SELECT COUNT(*) FILTER (WHERE status='ACTIVE')::int active, COUNT(*) FILTER (WHERE status IN ('SUBMITTED','APPROVED'))::int pipeline, COALESCE(SUM(outstanding_principal) FILTER (WHERE status='ACTIVE'),0)::text outstanding FROM lnd_loans WHERE organization_id = $1`, [org])).rows[0];
    const o = (await db.query(`SELECT COALESCE(SUM(s.principal - s.paid_principal + s.interest - s.paid_interest + s.late_fee - s.paid_late_fee),0)::text overdue, COUNT(DISTINCT s.loan_id)::int overdue_loans FROM lnd_schedule s JOIN lnd_loans l ON l.id = s.loan_id WHERE l.organization_id = $1 AND l.status = 'ACTIVE' AND s.due_date < CURRENT_DATE AND (s.paid_principal < s.principal OR s.paid_interest < s.interest)`, [org])).rows[0];
    const i = (await db.query(`SELECT COALESCE(SUM(interest_part),0)::text interest_mtd FROM lnd_repayments WHERE organization_id = $1 AND payment_date >= date_trunc('month', CURRENT_DATE)`, [org])).rows[0];
    return ok(req, res, { ...l, ...o, ...i });
  });
}
