/**
 * COM — recurring commerce for AMC / maintenance plans. Subscriptions bill in advance on their
 * anniversary cycle. The billing run is idempotent: each (subscription, period_start) is billed
 * at most once (unique key + invoice source key), catches up missed periods (bounded), skips
 * paused / cancelled subscriptions and never bills past end_date. Each subscription bills in its
 * own unit of work, so one failure (e.g. a closed period) does not block the rest of the run.
 * Revenue: monthly plans recognise on invoice (411007). Quarterly / annual invoices credit
 * Deferred Revenue (211010) and are recognised by days per calendar month (ADR-015 addendum).
 */
import type { Express, Request, Response } from 'express';
import { Permission, ErrorCode, AccountingPurpose } from '@omnysync/contracts';
import { Money } from '@omnysync/financial-engine';
import { db, authenticate, requireAnyPermission } from '../context.js';
import { ok } from '../lib/http.js';
import { ApiError, validationError } from '../lib/errors.js';
import { defineResource, loadRow, unitOfWork, type Ctx } from '../lib/resource.js';
import { requireModule } from '../lib/modules.js';
import { dateOnly, int, todayIso, toIsoDate } from '../lib/validate.js';
import { createPostedSourceInvoice } from '../lib/ar-invoice.js';
import { nextDocumentNumber } from '../lib/numbering.js';
import { postJournal } from '../lib/posting.js';
import { auditLogger, outboxService } from '../context.js';

const VIEW = [Permission.SUBSCRIPTION_VIEW, Permission.SUBSCRIPTION_MANAGE, Permission.SUBSCRIPTION_BILL];
export const MONTHS: Record<string, number> = { MONTHLY: 1, QUARTERLY: 3, ANNUAL: 12 };

/** Adds months keeping month-end semantics (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}
const minusDay = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);

export function periodNet(price: string, qty: number, discountPct: string) {
  return new Money(price).mul(qty).mul(new Money(100).sub(discountPct)).div(100).round(2);
}
/** Monthly recurring revenue contribution. */
export function mrr(price: string, qty: number, discountPct: string, interval: string) {
  return periodNet(price, qty, discountPct).div(MONTHS[interval]).round(2);
}

/**
 * Allocates an amount over [start, end] (inclusive) to calendar months by days; the last month
 * absorbs rounding so the lines always sum to the amount.
 */
export function allocateByMonth(start: string, end: string, amount: string): { month_start: string; month_end: string; amount: string }[] {
  const day = 86400000;
  const s = Date.parse(`${start}T00:00:00Z`);
  const e = Date.parse(`${end}T00:00:00Z`);
  const total = Math.round((e - s) / day) + 1;
  const out: { month_start: string; month_end: string; amount: string }[] = [];
  let cursor = s;
  let allocated = Money.zero();
  while (cursor <= e) {
    const d = new Date(cursor);
    const mStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    const mEnd = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0);
    const segEnd = Math.min(mEnd, e);
    const days = Math.round((segEnd - cursor) / day) + 1;
    const last = segEnd === e;
    const amt = last ? new Money(amount).sub(allocated) : new Money(amount).mul(days).div(total).round(2);
    allocated = allocated.add(amt);
    out.push({ month_start: new Date(mStart).toISOString().slice(0, 10), month_end: new Date(mEnd).toISOString().slice(0, 10), amount: amt.toFixed(2) });
    cursor = segEnd + day;
  }
  return out;
}

/** Recognises due deferred revenue lines (recognize_on ≤ asOf) — one journal per line, idempotent by source key. */
export async function recognizeRevenue(ctx: Ctx, asOf: string, subscriptionId?: string) {
  const due = (
    await ctx.tx.query(
      `SELECT r.*, s.number AS sub_number FROM com_revenue_schedule r JOIN com_subscriptions s ON s.id = r.subscription_id
       WHERE r.organization_id = $1 AND r.status = 'PENDING' AND r.recognize_on <= $2 AND ($3::uuid IS NULL OR r.subscription_id = $3::uuid)
       ORDER BY r.recognize_on, s.number FOR UPDATE OF r`,
      [ctx.org, asOf, subscriptionId ?? null],
    )
  ).rows;
  let total = Money.zero();
  for (const r of due) {
    const amt = new Money(r.amount).round(2);
    let journalId: string | null = null;
    if (amt.isPositive()) {
      const j = await postJournal(ctx.tx, auditLogger, outboxService, {
        organizationId: ctx.org, legalEntityId: ctx.le, userId: ctx.user, postingDate: toIsoDate(r.recognize_on), purpose: AccountingPurpose.REVENUE_RECOGNITION,
        description: `Revenue recognised ${r.sub_number} ${toIsoDate(r.month_start).slice(0, 7)}`, sourceType: 'COM_REVENUE', sourceId: r.id, sourceKey: `COM_REV:${r.id}`,
        numberPrefix: 'JV-REV', correlationId: ctx.req.correlationId,
        lines: [
          { account_code: '211010', debit: amt.toFixed(8), description: `Deferred revenue released ${r.sub_number}` },
          { account_code: '411007', credit: amt.toFixed(8), description: `Subscription revenue ${r.sub_number}` },
        ],
      });
      journalId = j?.journalId ?? null;
      total = total.add(amt);
    }
    await ctx.tx.query(`UPDATE com_revenue_schedule SET status = 'RECOGNISED', journal_id = $2, recognised_at = NOW() WHERE id = $1`, [r.id, journalId]);
  }
  return { recognised_lines: due.length, recognised_amount: total.toFixed(2) };
}

/**
 * On cancellation, settles the subscription's PENDING deferred-revenue lines as of `asOf` in one journal
 * (idempotent by source key): due lines are recognised normally, the current line is earned pro rata by days,
 * and the unearned remainder moves to customer credit (211006, REFUND) or to revenue (FORFEIT).
 */
export async function releaseDeferredOnCancel(ctx: Ctx, sub: { id: string; number: string }, asOf: string, treatment: 'REFUND' | 'FORFEIT') {
  await recognizeRevenue(ctx, asOf, sub.id);
  const lines = (
    await ctx.tx.query(
      `SELECT r.id, r.amount::text, r.month_start, r.recognize_on, bp.period_start FROM com_revenue_schedule r JOIN com_billing_periods bp ON bp.id = r.billing_period_id
       WHERE r.subscription_id = $1 AND r.organization_id = $2 AND r.status = 'PENDING' ORDER BY r.month_start FOR UPDATE OF r`,
      [sub.id, ctx.org],
    )
  ).rows;
  let earned = Money.zero();
  let unearned = Money.zero();
  const day = 86400000;
  for (const l of lines) {
    const amt = new Money(l.amount).round(2);
    const segStart = Math.max(Date.parse(toIsoDate(l.month_start)), Date.parse(toIsoDate(l.period_start)));
    const segEnd = Date.parse(toIsoDate(l.recognize_on));
    const t = Date.parse(asOf);
    let e = Money.zero();
    if (t >= segStart) e = amt.mul(Math.round((Math.min(t, segEnd) - segStart) / day) + 1).div(Math.round((segEnd - segStart) / day) + 1).round(2);
    earned = earned.add(e);
    unearned = unearned.add(amt.sub(e));
    await ctx.tx.query(`UPDATE com_revenue_schedule SET status = 'RELEASED', released_amount = $2, recognised_at = NOW() WHERE id = $1`, [l.id, amt.sub(e).toFixed(8)]);
  }
  const total = earned.add(unearned);
  if (!total.isPositive()) return { earned: '0.00', unearned: '0.00', treatment, journal_id: null };
  const jl: any[] = [{ account_code: '211010', debit: total.toFixed(8), description: `Deferred revenue settled on cancellation ${sub.number}` }];
  const toRevenue = treatment === 'FORFEIT' ? earned.add(unearned) : earned;
  if (toRevenue.isPositive()) jl.push({ account_code: '411007', credit: toRevenue.toFixed(8), description: `Subscription revenue ${sub.number} (${treatment === 'FORFEIT' ? 'earned + forfeited' : 'earned to cancellation'})` });
  if (treatment === 'REFUND' && unearned.isPositive()) jl.push({ account_code: '211006', credit: unearned.toFixed(8), description: `Unearned subscription balance owed to customer ${sub.number}` });
  const j = await postJournal(ctx.tx, auditLogger, outboxService, {
    organizationId: ctx.org, legalEntityId: ctx.le, userId: ctx.user, postingDate: asOf, purpose: AccountingPurpose.REVENUE_RECOGNITION,
    description: `Subscription ${sub.number} cancelled — deferred revenue settled (${treatment})`, sourceType: 'COM_CANCEL', sourceId: sub.id, sourceKey: `COM_CANCEL:${sub.id}`,
    numberPrefix: 'JV-REV', correlationId: ctx.req.correlationId, lines: jl,
  });
  await ctx.tx.query(`UPDATE com_revenue_schedule SET journal_id = $2 WHERE subscription_id = $1 AND status = 'RELEASED' AND journal_id IS NULL`, [sub.id, j?.journalId ?? null]);
  return { earned: earned.toFixed(2), unearned: unearned.toFixed(2), treatment, journal_id: j?.journalId ?? null };
}

/** Bills every due period of one subscription inside the caller's unit of work (API run or automation job). */
export async function billSubscription(ctx: Ctx, id: string, asOf: string, maxPeriods = 12) {
  const s = await loadRow(ctx.tx, 'com_subscriptions', id, ctx.org, 'Subscription', true);
  if (s.status !== 'ACTIVE') return { subscription: s.number, skipped: s.status };
  const plan = await loadRow(ctx.tx, 'com_plans', s.plan_id, ctx.org, 'Plan');
  const step = MONTHS[plan.billing_interval];
  const invoices: string[] = [];
  let next = toIsoDate(s.next_bill_date);
  let ended = false;
  for (let n = 0; n < maxPeriods && next <= asOf; n++) {
    const end = s.end_date ? toIsoDate(s.end_date) : null;
    if (end && next >= end) {
      ended = true;
      break;
    }
    let pEnd = minusDay(addMonths(next, step));
    let net = periodNet(plan.price, s.quantity, s.discount_pct);
    if (end && pEnd >= end) {
      // Final partial period is prorated by days.
      const full = (Date.parse(pEnd) - Date.parse(next)) / 86400000 + 1;
      const used = (Date.parse(end) - Date.parse(next)) / 86400000;
      net = net.mul(used).div(full).round(2);
      pEnd = minusDay(end);
    }
    const ins = await ctx.tx.query(`INSERT INTO com_billing_periods (organization_id, subscription_id, period_start, period_end, net_amount) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (subscription_id, period_start) DO NOTHING RETURNING id`, [ctx.org, s.id, next, pEnd, net.toFixed(8)]);
    if (ins.rows[0] && net.isPositive()) {
      const deferred = step > 1;
      const qty = new Money(s.quantity).toFixed(4);
      const unit = net.div(s.quantity).round(4).toFixed(4);
      const inv = await createPostedSourceInvoice(ctx, {
        party_id: s.party_id, invoice_date: next <= asOf ? next : asOf, due_days: 15,
        lines: [{ item_id: plan.item_id, description: `${plan.name} ${next} – ${pEnd}`, quantity: qty, unit_price: unit, tax_rate: new Money(plan.tax_rate).toFixed(3), revenue_account_code: deferred ? '211010' : '411007' }],
        sourceType: 'SUBSCRIPTION', sourceId: s.id, sourceKey: `COM:${s.id}:${next}`, notes: `Subscription ${s.number}`, purpose: AccountingPurpose.SUBSCRIPTION_INVOICE, prefix: 'INV',
      });
      await ctx.tx.query(`UPDATE com_billing_periods SET ar_invoice_id = $2 WHERE id = $1`, [ins.rows[0].id, inv?.id ?? null]);
      if (deferred && inv) {
        // The invoice line nets to qty × rounded unit price; allocate exactly what was credited to 211010.
        const billedNet = new Money(unit).mul(qty).round(2).toFixed(2);
        for (const m of allocateByMonth(next, pEnd, billedNet)) {
          await ctx.tx.query(
            `INSERT INTO com_revenue_schedule (organization_id, subscription_id, billing_period_id, month_start, recognize_on, amount) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (billing_period_id, month_start) DO NOTHING`,
            [ctx.org, s.id, ins.rows[0].id, m.month_start, m.month_end, m.amount],
          );
        }
      }
      if (inv) invoices.push(inv.invoice_number);
    }
    next = addMonths(next, step);
    if (end && next >= end) {
      ended = true;
      break;
    }
  }
  await ctx.tx.query(`UPDATE com_subscriptions SET next_bill_date = $2, status = $3, revision = revision + 1, updated_at = NOW() WHERE id = $1`, [s.id, ended ? null : next, ended ? 'ENDED' : 'ACTIVE']);
  return { subscription: s.number, invoices, next_bill_date: ended ? null : next, ended };
}

export function registerSubscriptionRoutes(app: Express): void {
  defineResource(app, {
    path: '/api/com/plans',
    table: 'com_plans',
    label: 'Plan',
    event: 'SUBSCRIPTION_PLAN',
    module: 'COM',
    view: VIEW,
    create: Permission.SUBSCRIPTION_MANAGE,
    update: Permission.SUBSCRIPTION_MANAGE,
    fields: {
      code: { type: 'string', required: true, max: 32, pattern: /^[A-Z0-9-]+$/ },
      name: { type: 'string', required: true },
      description: { type: 'text' },
      billing_interval: { type: 'enum', values: ['MONTHLY', 'QUARTERLY', 'ANNUAL'], required: true },
      price: { type: 'decimal', required: true, sign: 'positive', scale: 2 },
      tax_rate: { type: 'decimal', default: '18', scale: 3 },
      item_id: { type: 'ref', table: 'items', required: true, label: 'item_id' },
      visits_per_year: { type: 'int', min: 0, max: 52, default: 0 },
    },
    editable: ['name', 'description', 'visits_per_year'],
    initialStatus: 'ACTIVE',
    select: `t.*, i.code AS item_code, (SELECT COUNT(*)::int FROM com_subscriptions s WHERE s.plan_id = t.id AND s.status = 'ACTIVE') AS active_subscriptions`,
    joins: 'JOIN items i ON i.id = t.item_id',
    search: ['code', 't.name'],
    orderBy: 't.price',
    beforeCreate: async (_c, v) => {
      if (new Money(v.tax_rate).gt(100)) throw validationError('tax_rate must be ≤ 100', { field: 'tax_rate' });
    },
    commands: { retire: { from: ['ACTIVE'], to: 'RETIRED', permission: Permission.SUBSCRIPTION_MANAGE } },
  });

  defineResource(app, {
    path: '/api/com/subscriptions',
    table: 'com_subscriptions',
    label: 'Subscription',
    event: 'SUBSCRIPTION',
    module: 'COM',
    view: VIEW,
    create: Permission.SUBSCRIPTION_MANAGE,
    update: Permission.SUBSCRIPTION_MANAGE,
    fields: {
      party_id: { type: 'ref', table: 'parties', required: true, label: 'party_id' },
      plan_id: { type: 'ref', table: 'com_plans', required: true, label: 'plan_id' },
      quantity: { type: 'int', min: 1, max: 1000, default: 1 },
      discount_pct: { type: 'decimal', default: '0', scale: 2 },
      start_date: { type: 'date', required: true },
      end_date: { type: 'date' },
    },
    editable: ['quantity', 'discount_pct', 'end_date'],
    editableIn: ['DRAFT', 'ACTIVE', 'PAUSED'],
    numbering: { column: 'number', prefix: 'SUB', dateField: 'start_date' },
    initialStatus: 'DRAFT',
    select: `t.*, p.name AS party_name, pl.code AS plan_code, pl.name AS plan_name, pl.billing_interval, pl.price AS plan_price,
      ROUND(pl.price * t.quantity * (100 - t.discount_pct) / 100, 2) AS period_amount,
      (SELECT COUNT(*)::int FROM com_billing_periods b WHERE b.subscription_id = t.id) AS periods_billed`,
    joins: 'JOIN parties p ON p.id = t.party_id JOIN com_plans pl ON pl.id = t.plan_id',
    search: ['number', 'p.name', 'pl.name'],
    filters: ['plan_id', 'party_id'],
    detail: async (q, row) => ({
      periods: (await q.query(`SELECT b.*, i.invoice_number FROM com_billing_periods b LEFT JOIN ar_invoices i ON i.id = b.ar_invoice_id WHERE b.subscription_id = $1 ORDER BY b.period_start DESC`, [row.id])).rows,
      revenue_schedule: (await q.query(`SELECT r.id, r.month_start, r.recognize_on, r.amount, r.status, j.journal_number FROM com_revenue_schedule r LEFT JOIN journals j ON j.id = r.journal_id WHERE r.subscription_id = $1 ORDER BY r.month_start`, [row.id])).rows,
    }),
    beforeCreate: async (ctx, v) => {
      if (new Money(v.discount_pct).gte(100)) throw validationError('discount_pct must be below 100', { field: 'discount_pct' });
      if (v.end_date && v.end_date <= v.start_date) throw validationError('end_date must be after start_date', { field: 'end_date' });
      const plan = await loadRow(ctx.tx, 'com_plans', v.plan_id, ctx.org, 'Plan');
      if (plan.status !== 'ACTIVE') throw new ApiError(409, ErrorCode.INVALID_STATE, `Plan ${plan.code} is retired`);
    },
    beforeUpdate: async (_c, row, v) => {
      if (v.discount_pct !== undefined && new Money(v.discount_pct).gte(100)) throw validationError('discount_pct must be below 100', { field: 'discount_pct' });
      if (v.end_date && v.end_date <= toIsoDate(row.start_date)) throw validationError('end_date must be after start_date', { field: 'end_date' });
    },
    commands: {
      activate: {
        from: ['DRAFT'],
        to: 'ACTIVE',
        permission: Permission.SUBSCRIPTION_MANAGE,
        fields: { create_service_contract: { type: 'bool' } },
        run: async (ctx, row, i) => {
          const set: Record<string, unknown> = { next_bill_date: toIsoDate(row.start_date) };
          if (i.create_service_contract) {
            const plan = await loadRow(ctx.tx, 'com_plans', row.plan_id, ctx.org, 'Plan');
            const start = toIsoDate(row.start_date);
            const end = row.end_date ? minusDay(toIsoDate(row.end_date)) : minusDay(addMonths(start, 12));
            const number = await nextDocumentNumber(ctx.tx, ctx.org, 'SVC', start);
            const k = await ctx.tx.query(
              `INSERT INTO srv_contracts (organization_id, legal_entity_id, number, party_id, contract_type, title, start_date, end_date, covers_labour, covers_parts, visits_included, pm_interval_months, next_pm_date, contract_value, status, created_by)
               VALUES ($1,$2,$3,$4,'AMC',$5,$6,$7,true,false,$8,$9,$6,0,'ACTIVE',$10) RETURNING id`,
              [ctx.org, ctx.le, number, row.party_id, `${plan.name} (${row.number})`, start, end, plan.visits_per_year, plan.visits_per_year ? Math.max(1, Math.floor(12 / plan.visits_per_year)) : null, ctx.user],
            );
            set.service_contract_id = k.rows[0].id;
          }
          return { set };
        },
      },
      pause: { from: ['ACTIVE'], to: 'PAUSED', permission: Permission.SUBSCRIPTION_MANAGE },
      resume: {
        from: ['PAUSED'],
        to: 'ACTIVE',
        permission: Permission.SUBSCRIPTION_MANAGE,
        run: async (_c, row) => {
          // Paused periods are not billed retroactively: the next cycle starts from the first anniversary on/after today.
          const plan = await loadRow(_c.tx, 'com_plans', row.plan_id, _c.org, 'Plan');
          let next = toIsoDate(row.next_bill_date || row.start_date);
          for (let g = 0; next < todayIso() && g < 240; g++) next = addMonths(next, MONTHS[plan.billing_interval]);
          return { set: { next_bill_date: next } };
        },
      },
      cancel: {
        from: ['DRAFT', 'ACTIVE', 'PAUSED'],
        to: 'CANCELLED',
        permission: Permission.SUBSCRIPTION_MANAGE,
        fields: { cancel_reason: { type: 'text', required: true }, unearned_treatment: { type: 'enum', values: ['REFUND', 'FORFEIT'] }, effective_date: { type: 'date' } },
        run: async (ctx, row, i) => {
          if (row.service_contract_id) await ctx.tx.query(`UPDATE srv_contracts SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1 AND status IN ('DRAFT','ACTIVE')`, [row.service_contract_id]);
          const treatment = (i.unearned_treatment || 'REFUND') as 'REFUND' | 'FORFEIT';
          const asOf = i.effective_date ? toIsoDate(i.effective_date) : todayIso();
          if (asOf > todayIso()) throw validationError('effective_date cannot be in the future', { field: 'effective_date' });
          const deferred = await releaseDeferredOnCancel(ctx, row, asOf, treatment);
          return { set: { cancel_reason: i.cancel_reason, cancelled_at: new Date().toISOString(), next_bill_date: null, unearned_treatment: treatment }, data: { deferred } };
        },
      },
    },
  });

  app.post('/api/com/billing-run', authenticate, requireAnyPermission(Permission.SUBSCRIPTION_BILL), requireModule('COM', 'command'), async (req: Request, res: Response) => {
    const asOf = req.body?.as_of ? dateOnly(req.body.as_of, 'as_of') : todayIso();
    const maxPeriods = req.body?.max_periods ? int(req.body.max_periods, 'max_periods', { min: 1, max: 24 }) : 12;
    const org = req.session!.organization_id;
    const due = (await db.query(`SELECT id FROM com_subscriptions WHERE organization_id = $1 AND status = 'ACTIVE' AND next_bill_date IS NOT NULL AND next_bill_date <= $2 ORDER BY number`, [org, asOf])).rows;
    const results: any[] = [];
    for (const { id } of due) {
      try {
        results.push(
          await unitOfWork(req, (ctx) => billSubscription(ctx, id, asOf, maxPeriods)),
        );
      } catch (e: any) {
        results.push({ subscription_id: id, error: e?.code || 'ERROR', message: e?.message });
      }
    }
    return ok(req, res, { as_of: asOf, processed: results.length, invoices: results.reduce((a, r) => a + (r.invoices?.length || 0), 0), failed: results.filter((r) => r.error).length, results });
  });

  app.post('/api/com/revenue/recognize', authenticate, requireAnyPermission(Permission.SUBSCRIPTION_BILL), requireModule('COM', 'command'), async (req: Request, res: Response) => {
    const asOf = req.body?.as_of ? dateOnly(req.body.as_of, 'as_of') : todayIso();
    const out = await unitOfWork(req, (ctx) => recognizeRevenue(ctx, asOf));
    return ok(req, res, { as_of: asOf, ...out });
  });

  app.get('/api/com/summary', authenticate, requireAnyPermission(...VIEW), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const subs = (await db.query(`SELECT s.status, s.quantity, s.discount_pct::text, s.cancelled_at, pl.price::text, pl.billing_interval FROM com_subscriptions s JOIN com_plans pl ON pl.id = s.plan_id WHERE s.organization_id = $1`, [org])).rows;
    const active = subs.filter((s: any) => s.status === 'ACTIVE');
    const total = active.reduce((a: Money, s: any) => a.add(mrr(s.price, s.quantity, s.discount_pct, s.billing_interval)), Money.zero());
    const billed = (await db.query(`SELECT COALESCE(SUM(net_amount),0)::text t FROM com_billing_periods WHERE organization_id = $1 AND period_start >= date_trunc('month', CURRENT_DATE)`, [org])).rows[0].t;
    const month = new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 7);
    const churned = subs.filter((s: any) => s.status === 'CANCELLED' && s.cancelled_at && new Date(new Date(s.cancelled_at).getTime() + 5 * 3600000).toISOString().slice(0, 7) === month).length;
    return ok(req, res, { mrr: total.toFixed(2), arr: total.mul(12).toFixed(2), active: active.length, paused: subs.filter((s: any) => s.status === 'PAUSED').length, churned_this_month: churned, billed_this_month: new Money(billed).toFixed(2) });
  });
}
