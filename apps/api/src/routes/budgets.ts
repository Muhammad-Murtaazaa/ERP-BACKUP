/**
 * EPM — versioned P&L budgets. Lines are per posting account (revenue / expense only) and month.
 * Only DRAFT budgets are editable; SUBMITTED/APPROVED budgets refuse edits with BUDGET_LOCKED.
 * Approval enforces segregation of duties (submitter cannot approve). "Revise" supersedes an
 * approved version and opens version n+1 as a DRAFT copy. Budget-vs-actual reads posted journals
 * for the budget's fiscal year (calendar year; fiscal-year offset is not modelled).
 */
import type { Express, Request, Response } from 'express';
import { Permission, ErrorCode } from '@omnysync/contracts';
import { Money } from '@omnysync/financial-engine';
import { db, authenticate, requireAnyPermission } from '../context.js';
import { ok } from '../lib/http.js';
import { ApiError, validationError } from '../lib/errors.js';
import { defineResource, loadRow, unitOfWork, audit, emit } from '../lib/resource.js';
import { requireModule } from '../lib/modules.js';
import { int } from '../lib/validate.js';

const VIEW = [Permission.BUDGET_VIEW, Permission.BUDGET_MANAGE, Permission.BUDGET_APPROVE];

/** Spreads an annual amount evenly over 12 months; December absorbs rounding. */
export function spreadEven(annual: string): string[] {
  const total = new Money(annual).round(2);
  const m = total.div(12).round(2);
  const out = Array.from({ length: 11 }, () => m.toFixed(2));
  out.push(total.sub(m.mul(11)).toFixed(2));
  return out;
}

/** Variance sign convention: positive = favourable. */
export function variance(cls: 'REVENUE' | 'EXPENSE', budget: string, actual: string) {
  const v = new Money(actual).sub(budget);
  const fav = cls === 'REVENUE' ? v : v.negated();
  const pct = new Money(budget).isZero() ? null : fav.div(budget).mul(100).round(1).toFixed(1);
  return { variance: fav.toFixed(2), variance_pct: pct, favourable: !fav.isNegative() };
}

async function copyLines(q: any, from: string, to: string, org: string) {
  await q.query(`INSERT INTO epm_budget_lines (organization_id, budget_id, account_id, period_month, amount) SELECT organization_id, $2, account_id, period_month, amount FROM epm_budget_lines WHERE budget_id = $1 AND organization_id = $3`, [from, to, org]);
}

export function registerBudgetRoutes(app: Express): void {
  defineResource(app, {
    path: '/api/epm/budgets',
    table: 'epm_budgets',
    label: 'Budget',
    event: 'BUDGET',
    module: 'EPM',
    view: VIEW,
    create: Permission.BUDGET_MANAGE,
    update: Permission.BUDGET_MANAGE,
    fields: {
      code: { type: 'string', required: true, max: 32, pattern: /^[A-Z0-9-]+$/ },
      name: { type: 'string', required: true },
      fiscal_year: { type: 'int', required: true, min: 2000, max: 2100 },
      scenario: { type: 'enum', values: ['BUDGET', 'FORECAST'], default: 'BUDGET' },
      notes: { type: 'text' },
      copy_from_id: { type: 'ref', table: 'epm_budgets', label: 'copy_from_id' },
    },
    editable: ['name', 'notes'],
    editableIn: ['DRAFT'],
    initialStatus: 'DRAFT',
    select: `t.*, (SELECT COALESCE(SUM(amount),0) FROM epm_budget_lines l WHERE l.budget_id = t.id) AS total_amount,
      (SELECT COUNT(DISTINCT account_id)::int FROM epm_budget_lines l WHERE l.budget_id = t.id) AS accounts`,
    search: ['code', 't.name'],
    filters: ['fiscal_year'],
    orderBy: 't.fiscal_year DESC, t.code, t.version DESC',
    beforeCreate: async (ctx, v) => {
      const dup = await ctx.tx.query(`SELECT 1 FROM epm_budgets WHERE organization_id = $1 AND code = $2`, [ctx.org, v.code]);
      if (dup.rows.length) throw new ApiError(409, ErrorCode.DUPLICATE_RESOURCE, `Budget ${v.code} exists — revise it to create a new version`);
      (ctx as any)._copyFrom = v.copy_from_id;
      delete v.copy_from_id;
    },
    afterCreate: async (ctx: any, row: any) => {
      if (ctx._copyFrom) await copyLines(ctx.tx, ctx._copyFrom, row.id, ctx.org);
    },
    detail: async (q, row) => ({
      lines: (await q.query(`SELECT l.account_id, a.code AS account_code, a.name AS account_name, a.statement_class, l.period_month, l.amount FROM epm_budget_lines l JOIN accounts a ON a.id = l.account_id WHERE l.budget_id = $1 ORDER BY a.code, l.period_month`, [row.id])).rows,
      versions: (await q.query(`SELECT id, version, status, approved_at FROM epm_budgets WHERE organization_id = $1 AND code = $2 ORDER BY version DESC`, [row.organization_id, row.code])).rows,
    }),
    commands: {
      submit: {
        from: ['DRAFT'],
        to: 'SUBMITTED',
        permission: Permission.BUDGET_MANAGE,
        run: async (ctx, row) => {
          const n = (await ctx.tx.query(`SELECT COUNT(*)::int n FROM epm_budget_lines WHERE budget_id = $1`, [row.id])).rows[0].n;
          if (!n) throw validationError('Add at least one budget line before submitting');
          return { set: { submitted_by: ctx.user, submitted_at: new Date().toISOString() } };
        },
      },
      reject: { from: ['SUBMITTED'], to: 'DRAFT', permission: Permission.BUDGET_APPROVE, fields: { notes: { type: 'text', required: true } }, run: async (_c, _r, i) => ({ set: { notes: i.notes, submitted_by: null, submitted_at: null } }) },
      approve: {
        from: ['SUBMITTED'],
        to: 'APPROVED',
        permission: Permission.BUDGET_APPROVE,
        sodColumn: 'submitted_by',
        run: async (ctx, row) => {
          // Only one approved version per code/scenario is live.
          await ctx.tx.query(`UPDATE epm_budgets SET status = 'SUPERSEDED', updated_at = NOW() WHERE organization_id = $1 AND code = $2 AND id <> $3 AND status = 'APPROVED'`, [ctx.org, row.code, row.id]);
          return { set: { approved_by: ctx.user, approved_at: new Date().toISOString() } };
        },
      },
      archive: { from: ['DRAFT', 'SUPERSEDED'], to: 'ARCHIVED', permission: Permission.BUDGET_MANAGE },
    },
  });

  // New version from an approved budget: previous stays APPROVED (live) until the new one is approved.
  app.post('/api/epm/budgets/:id/revise', authenticate, requireAnyPermission(Permission.BUDGET_MANAGE), requireModule('EPM', 'command'), async (req: Request, res: Response) => {
    const out = await unitOfWork(req, async (ctx) => {
      const b = await loadRow(ctx.tx, 'epm_budgets', req.params.id, ctx.org, 'Budget', true);
      if (b.status !== 'APPROVED') throw new ApiError(409, ErrorCode.INVALID_STATE, 'Only the approved version can be revised');
      const open = await ctx.tx.query(`SELECT version FROM epm_budgets WHERE organization_id = $1 AND code = $2 AND status IN ('DRAFT','SUBMITTED')`, [ctx.org, b.code]);
      if (open.rows.length) throw new ApiError(409, ErrorCode.INVALID_STATE, `Version ${open.rows[0].version} is already open for revision`);
      const v = (await ctx.tx.query(`SELECT MAX(version)::int m FROM epm_budgets WHERE organization_id = $1 AND code = $2`, [ctx.org, b.code])).rows[0].m + 1;
      const r = await ctx.tx.query(
        `INSERT INTO epm_budgets (organization_id, legal_entity_id, code, name, fiscal_year, scenario, version, supersedes_id, notes, status, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'DRAFT',$10) RETURNING *`,
        [ctx.org, b.legal_entity_id, b.code, b.name, b.fiscal_year, b.scenario, v, b.id, req.body?.notes ?? null, ctx.user],
      );
      await copyLines(ctx.tx, b.id, r.rows[0].id, ctx.org);
      await audit(ctx, 'REVISE', 'BUDGET', r.rows[0].id, { from: b.id }, { version: v });
      await emit(ctx, 'BUDGET_REVISED', { budget_id: r.rows[0].id, code: b.code, version: v });
      return r.rows[0];
    });
    return ok(req, res, out, 201);
  });

  // Upserts lines: { lines: [{ account_id, months?: [12], annual? }] }. Replaces the account's 12 months.
  app.post('/api/epm/budgets/:id/lines', authenticate, requireAnyPermission(Permission.BUDGET_MANAGE), requireModule('EPM', 'command'), async (req: Request, res: Response) => {
    const lines = req.body?.lines;
    if (!Array.isArray(lines) || !lines.length || lines.length > 500) throw validationError('lines must be a non-empty array (≤ 500)', { field: 'lines' });
    const out = await unitOfWork(req, async (ctx) => {
      const b = await loadRow(ctx.tx, 'epm_budgets', req.params.id, ctx.org, 'Budget', true);
      if (b.status !== 'DRAFT') throw new ApiError(409, ErrorCode.BUDGET_LOCKED, `Budget ${b.code} v${b.version} is ${b.status.toLowerCase()} — revise it to change figures`);
      let n = 0;
      for (const [idx, l] of lines.entries()) {
        const acc = (await ctx.tx.query(`SELECT id, code, statement_class, posting_allowed FROM accounts WHERE id = $1 AND organization_id = $2`, [l?.account_id, ctx.org])).rows[0];
        if (!acc) throw validationError(`lines[${idx}].account_id not found`, { field: `lines[${idx}].account_id` });
        if (!acc.posting_allowed || !['REVENUE', 'EXPENSE'].includes(acc.statement_class)) throw validationError(`Account ${acc.code} must be a posting revenue or expense account`, { field: `lines[${idx}].account_id` });
        let months: string[];
        if (Array.isArray(l.months)) {
          if (l.months.length !== 12) throw validationError(`lines[${idx}].months needs 12 values`, { field: `lines[${idx}].months` });
          months = l.months.map((m: unknown, k: number) => {
            if (!/^\d+(\.\d{1,2})?$/.test(String(m ?? ''))) throw validationError(`lines[${idx}].months[${k}] must be a non-negative amount`, { field: `lines[${idx}].months` });
            return new Money(String(m)).toFixed(2);
          });
        } else if (l.annual !== undefined) {
          if (!/^\d+(\.\d{1,2})?$/.test(String(l.annual))) throw validationError(`lines[${idx}].annual must be a non-negative amount`, { field: `lines[${idx}].annual` });
          months = spreadEven(String(l.annual));
        } else throw validationError(`lines[${idx}] needs months or annual`, { field: `lines[${idx}]` });
        for (let m = 0; m < 12; m++) {
          await ctx.tx.query(
            `INSERT INTO epm_budget_lines (organization_id, budget_id, account_id, period_month, amount) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (budget_id, account_id, period_month) DO UPDATE SET amount = EXCLUDED.amount`,
            [ctx.org, b.id, acc.id, m + 1, months[m]],
          );
        }
        n++;
      }
      await ctx.tx.query(`UPDATE epm_budgets SET revision = revision + 1, updated_at = NOW() WHERE id = $1`, [b.id]);
      await audit(ctx, 'UPDATE_LINES', 'BUDGET', b.id, undefined, { accounts: n });
      return { budget_id: b.id, accounts_updated: n };
    });
    return ok(req, res, out);
  });

  app.get('/api/epm/budgets/:id/variance', authenticate, requireAnyPermission(...VIEW), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const b = await loadRow(db, 'epm_budgets', req.params.id, org, 'Budget');
    const through = req.query.through_month ? int(req.query.through_month, 'through_month', { min: 1, max: 12 }) : 12;
    const from = `${b.fiscal_year}-01-01`;
    const to = new Date(Date.UTC(b.fiscal_year, through, 0)).toISOString().slice(0, 10);
    const budget = (await db.query(`SELECT a.id, a.code, a.name, a.statement_class, SUM(l.amount)::text amt FROM epm_budget_lines l JOIN accounts a ON a.id = l.account_id WHERE l.budget_id = $1 AND l.period_month <= $2 GROUP BY a.id, a.code, a.name, a.statement_class`, [b.id, through])).rows;
    const actual = (await db.query(
      `SELECT a.id, a.code, a.name, a.statement_class, SUM(jl.base_debit)::text d, SUM(jl.base_credit)::text c FROM journal_lines jl JOIN journals j ON j.id = jl.journal_id JOIN accounts a ON a.id = jl.account_id
       WHERE j.organization_id = $1 AND j.status = 'POSTED' AND j.posting_date BETWEEN $2 AND $3 AND a.statement_class IN ('REVENUE','EXPENSE') GROUP BY a.id, a.code, a.name, a.statement_class`,
      [org, from, to],
    )).rows;
    const map = new Map<string, any>();
    for (const r of budget) map.set(r.id, { account_id: r.id, code: r.code, name: r.name, statement_class: r.statement_class, budget: r.amt, actual: '0' });
    for (const r of actual) {
      const amt = r.statement_class === 'REVENUE' ? new Money(r.c).sub(r.d) : new Money(r.d).sub(r.c);
      const e = map.get(r.id) || { account_id: r.id, code: r.code, name: r.name, statement_class: r.statement_class, budget: '0' };
      e.actual = amt.toFixed(2);
      map.set(r.id, e);
    }
    const rows = [...map.values()].map((e) => ({ ...e, budget: new Money(e.budget).toFixed(2), ...variance(e.statement_class, e.budget, e.actual), unbudgeted: new Money(e.budget).isZero() && !new Money(e.actual).isZero() })).sort((a, b2) => a.code.localeCompare(b2.code));
    const tot = (cls: string, k: 'budget' | 'actual') => rows.filter((r) => r.statement_class === cls).reduce((a, r) => a.add(r[k]), Money.zero());
    const totals = {
      revenue_budget: tot('REVENUE', 'budget').toFixed(2), revenue_actual: tot('REVENUE', 'actual').toFixed(2),
      expense_budget: tot('EXPENSE', 'budget').toFixed(2), expense_actual: tot('EXPENSE', 'actual').toFixed(2),
      profit_budget: tot('REVENUE', 'budget').sub(tot('EXPENSE', 'budget')).toFixed(2), profit_actual: tot('REVENUE', 'actual').sub(tot('EXPENSE', 'actual')).toFixed(2),
    };
    return ok(req, res, { budget: { id: b.id, code: b.code, version: b.version, status: b.status, fiscal_year: b.fiscal_year }, through_month: through, period: { from, to }, rows, totals });
  });

  app.get('/api/epm/summary', authenticate, requireAnyPermission(...VIEW), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const r = (await db.query(`SELECT status, COUNT(*)::int n FROM epm_budgets WHERE organization_id = $1 GROUP BY status`, [org])).rows;
    const by = Object.fromEntries(r.map((x: any) => [x.status, x.n]));
    const live = (await db.query(`SELECT COALESCE(SUM(l.amount),0)::text t FROM epm_budget_lines l JOIN epm_budgets b ON b.id = l.budget_id JOIN accounts a ON a.id = l.account_id WHERE b.organization_id = $1 AND b.status = 'APPROVED' AND b.fiscal_year = EXTRACT(YEAR FROM CURRENT_DATE) AND a.statement_class = 'EXPENSE'`, [org])).rows[0].t;
    return ok(req, res, { draft: by.DRAFT || 0, submitted: by.SUBMITTED || 0, approved: by.APPROVED || 0, approved_expense_budget: new Money(live).toFixed(2) });
  });
}
