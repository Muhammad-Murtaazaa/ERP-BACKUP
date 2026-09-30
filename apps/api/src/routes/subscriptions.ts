/**
 * COM — recurring commerce for AMC / maintenance plans. Subscriptions bill in advance on their
 * anniversary cycle. The billing run is idempotent: each (subscription, period_start) is billed
 * at most once (unique key + invoice source key), catches up missed periods (bounded), skips
 * paused / cancelled subscriptions and never bills past end_date. Each subscription bills in its
 * own unit of work, so one failure (e.g. a closed period) does not block the rest of the run.
 */
import type { Express, Request, Response } from 'express';
import { Permission, ErrorCode, AccountingPurpose } from '@omnysync/contracts';
import { Money } from '@omnysync/financial-engine';
import { db, authenticate, requireAnyPermission } from '../context.js';
import { ok } from '../lib/http.js';
import { ApiError, validationError } from '../lib/errors.js';
import { defineResource, loadRow, unitOfWork } from '../lib/resource.js';
import { requireModule } from '../lib/modules.js';
import { dateOnly, int, todayIso, toIsoDate } from '../lib/validate.js';
import { createPostedSourceInvoice } from '../lib/ar-invoice.js';
import { nextDocumentNumber } from '../lib/numbering.js';

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
        fields: { cancel_reason: { type: 'text', required: true } },
        run: async (ctx, row, i) => {
          if (row.service_contract_id) await ctx.tx.query(`UPDATE srv_contracts SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1 AND status IN ('DRAFT','ACTIVE')`, [row.service_contract_id]);
          return { set: { cancel_reason: i.cancel_reason, cancelled_at: new Date().toISOString(), next_bill_date: null } };
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
          await unitOfWork(req, async (ctx) => {
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
                const qty = new Money(s.quantity).toFixed(4);
                const unit = net.div(s.quantity).round(4).toFixed(4);
                const inv = await createPostedSourceInvoice(ctx, {
                  party_id: s.party_id, invoice_date: next <= asOf ? next : asOf, due_days: 15,
                  lines: [{ item_id: plan.item_id, description: `${plan.name} ${next} – ${pEnd}`, quantity: qty, unit_price: unit, tax_rate: new Money(plan.tax_rate).toFixed(3), revenue_account_code: '411007' }],
                  sourceType: 'SUBSCRIPTION', sourceId: s.id, sourceKey: `COM:${s.id}:${next}`, notes: `Subscription ${s.number}`, purpose: AccountingPurpose.SUBSCRIPTION_INVOICE, prefix: 'INV',
                });
                await ctx.tx.query(`UPDATE com_billing_periods SET ar_invoice_id = $2 WHERE id = $1`, [ins.rows[0].id, inv?.id ?? null]);
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
          }),
        );
      } catch (e: any) {
        results.push({ subscription_id: id, error: e?.code || 'ERROR', message: e?.message });
      }
    }
    return ok(req, res, { as_of: asOf, processed: results.length, invoices: results.reduce((a, r) => a + (r.invoices?.length || 0), 0), failed: results.filter((r) => r.error).length, results });
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
