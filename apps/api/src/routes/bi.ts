/**
 * BI — governed analytics. Datasets are defined here (fixed, parameterised SQL scoped to the
 * caller's organization) and each carries the permission needed to read it, so a shared
 * dashboard never leaks data: a widget over a dataset the viewer may not read returns
 * `forbidden` instead of rows. Dashboards store only widget definitions, validated against the
 * catalogue (dataset, dimension, measure, chart type) on every save.
 */
import type { Express, Request, Response } from 'express';
import { Permission, ErrorCode } from '@omnysync/contracts';
import type { DbClient } from '@omnysync/platform';
import { db, authenticate, requireAnyPermission } from '../context.js';
import { ok } from '../lib/http.js';
import { ApiError, notFound, validationError } from '../lib/errors.js';
import { defineResource } from '../lib/resource.js';
import { dateOnly, todayIso } from '../lib/validate.js';

export interface Dataset {
  code: string;
  name: string;
  description: string;
  permission: Permission[];
  dimension: string;
  measures: string[];
  /** $1 = org, $2 = from, $3 = to */
  sql: string;
}

export const DATASETS: Dataset[] = [
  {
    code: 'revenue_by_month', name: 'Revenue by month', description: 'Posted revenue (credit − debit on REVENUE accounts) per calendar month.', permission: [Permission.FINANCE_REPORTS_VIEW], dimension: 'month', measures: ['revenue'],
    sql: `SELECT to_char(j.posting_date, 'YYYY-MM') AS month, SUM(jl.base_credit - jl.base_debit)::numeric(24,2)::text AS revenue
          FROM journal_lines jl JOIN journals j ON j.id = jl.journal_id JOIN accounts a ON a.id = jl.account_id
          WHERE j.organization_id = $1 AND j.status IN ('POSTED','REVERSED') AND a.statement_class = 'REVENUE' AND j.posting_date BETWEEN $2 AND $3
          GROUP BY 1 ORDER BY 1`,
  },
  {
    code: 'expense_by_account', name: 'Expenses by account', description: 'Posted expense by leaf account in the window.', permission: [Permission.FINANCE_REPORTS_VIEW], dimension: 'account', measures: ['amount'],
    sql: `SELECT a.code || ' ' || a.name AS account, SUM(jl.base_debit - jl.base_credit)::numeric(24,2)::text AS amount
          FROM journal_lines jl JOIN journals j ON j.id = jl.journal_id JOIN accounts a ON a.id = jl.account_id
          WHERE j.organization_id = $1 AND j.status IN ('POSTED','REVERSED') AND a.statement_class = 'EXPENSE' AND j.posting_date BETWEEN $2 AND $3
          GROUP BY a.code, a.name HAVING SUM(jl.base_debit - jl.base_credit) <> 0 ORDER BY SUM(jl.base_debit - jl.base_credit) DESC LIMIT 15`,
  },
  {
    code: 'ar_aging', name: 'Receivables aging', description: 'Outstanding posted customer invoices by days past due at the window end.', permission: [Permission.FINANCE_REPORTS_VIEW], dimension: 'bucket', measures: ['outstanding', 'invoices'],
    sql: `WITH x AS (SELECT outstanding_amount, ($3::date - due_date) AS dpd FROM ar_invoices WHERE organization_id = $1 AND status NOT IN ('DRAFT','CANCELLED','VOID') AND outstanding_amount > 0 AND invoice_date <= $3 AND invoice_date >= $2::date - 3650)
          SELECT b.bucket, COALESCE(SUM(x.outstanding_amount),0)::numeric(24,2)::text AS outstanding, COUNT(x.*)::int AS invoices
          FROM (VALUES (1,'Current'),(2,'1–30'),(3,'31–60'),(4,'61–90'),(5,'90+')) AS b(ord, bucket)
          LEFT JOIN x ON (CASE WHEN x.dpd <= 0 THEN 1 WHEN x.dpd <= 30 THEN 2 WHEN x.dpd <= 60 THEN 3 WHEN x.dpd <= 90 THEN 4 ELSE 5 END) = b.ord
          GROUP BY b.ord, b.bucket ORDER BY b.ord`,
  },
  {
    code: 'service_cases_by_status', name: 'Service cases by status', description: 'Service cases opened in the window by current status.', permission: [Permission.SERVICE_VIEW, Permission.SERVICE_MANAGE], dimension: 'status', measures: ['cases'],
    sql: `SELECT status, COUNT(*)::int AS cases FROM srv_cases WHERE organization_id = $1 AND (created_at AT TIME ZONE 'Asia/Karachi')::date BETWEEN $2 AND $3 GROUP BY status ORDER BY cases DESC`,
  },
  {
    code: 'service_sla_by_priority', name: 'SLA attainment by priority', description: 'Resolved cases within their (pause-adjusted) resolution SLA, % by priority.', permission: [Permission.SERVICE_VIEW, Permission.SERVICE_MANAGE], dimension: 'priority', measures: ['attainment_pct', 'resolved'],
    sql: `SELECT priority, COUNT(*)::int AS resolved,
            ROUND(100.0 * COUNT(*) FILTER (WHERE resolved_at <= resolution_due_at + (paused_minutes || ' minutes')::interval) / NULLIF(COUNT(*),0), 1)::text AS attainment_pct
          FROM srv_cases WHERE organization_id = $1 AND resolved_at IS NOT NULL AND (resolved_at AT TIME ZONE 'Asia/Karachi')::date BETWEEN $2 AND $3
          GROUP BY priority ORDER BY CASE priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END`,
  },
  {
    code: 'technician_hours', name: 'Technician hours', description: 'Approved service hours per technician in the window.', permission: [Permission.SERVICE_MANAGE], dimension: 'technician', measures: ['hours'],
    sql: `SELECT t.name AS technician, ROUND(SUM(te.minutes) / 60.0, 2)::text AS hours FROM srv_time_entries te JOIN srv_technicians t ON t.id = te.technician_id
          WHERE te.organization_id = $1 AND te.status = 'APPROVED' AND (te.start_at AT TIME ZONE 'Asia/Karachi')::date BETWEEN $2 AND $3 GROUP BY t.name ORDER BY SUM(te.minutes) DESC`,
  },
  {
    code: 'pipeline_by_stage', name: 'Sales pipeline by stage', description: 'Open opportunity value and weighted value per stage (not date-filtered).', permission: [Permission.CRM_VIEW, Permission.CRM_MANAGE], dimension: 'stage', measures: ['amount', 'weighted'],
    sql: `SELECT stage, SUM(amount)::numeric(24,2)::text AS amount, SUM(amount * probability / 100)::numeric(24,2)::text AS weighted FROM crm_opportunities
          WHERE organization_id = $1 AND status = 'OPEN' AND ($2::date IS NOT NULL AND $3::date IS NOT NULL)
          GROUP BY stage ORDER BY CASE stage WHEN 'PROSPECTING' THEN 0 WHEN 'QUALIFICATION' THEN 1 WHEN 'SITE_SURVEY' THEN 2 WHEN 'PROPOSAL' THEN 3 ELSE 4 END`,
  },
  {
    code: 'stock_value_by_item', name: 'Stock value by item', description: 'Perpetual stock value at standard cost (top 15) as of the window end.', permission: [Permission.INVENTORY_MANAGE, Permission.FINANCE_REPORTS_VIEW], dimension: 'item', measures: ['value', 'quantity'],
    sql: `SELECT i.code AS item, SUM(sm.total_value)::numeric(24,2)::text AS value, SUM(sm.quantity)::numeric(24,2)::text AS quantity FROM stock_movements sm JOIN items i ON i.id = sm.item_id
          WHERE sm.organization_id = $1 AND sm.movement_date <= $3 AND $2::date IS NOT NULL GROUP BY i.code HAVING SUM(sm.quantity) <> 0 ORDER BY SUM(sm.total_value) DESC LIMIT 15`,
  },
];

/** CSV cell with quoting and a formula-injection guard (=, +, -, @ prefixes are neutralised). */
export function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const CHARTS = ['BAR', 'LINE', 'TABLE', 'KPI'] as const;
export const datasetByCode = (c: string) => DATASETS.find((d) => d.code === c);
export const canRead = (perms: string[], d: Dataset) => d.permission.some((p) => perms.includes(p));

export function validateWidgets(raw: unknown): { dataset: string; chart: string; title: string; measure: string }[] {
  const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!Array.isArray(list)) throw validationError('widgets must be a list', { field: 'widgets' });
  if (list.length > 12) throw validationError('A dashboard can hold at most 12 widgets', { field: 'widgets' });
  return list.map((w: any, i: number) => {
    const d = datasetByCode(String(w?.dataset));
    if (!d) throw validationError(`Widget ${i + 1}: unknown dataset "${w?.dataset}"`, { field: 'widgets' });
    if (!CHARTS.includes(w.chart)) throw validationError(`Widget ${i + 1}: chart must be one of ${CHARTS.join(', ')}`, { field: 'widgets' });
    const measure = w.measure || d.measures[0];
    if (!d.measures.includes(measure)) throw validationError(`Widget ${i + 1}: ${d.code} has no measure "${measure}" (use ${d.measures.join(', ')})`, { field: 'widgets' });
    return { dataset: d.code, chart: w.chart, title: String(w.title || d.name).slice(0, 120), measure };
  });
}

export async function runDataset(q: DbClient, org: string, d: Dataset, from: string, to: string) {
  if (from > to) throw validationError('from must be on or before to', { field: 'from' });
  const r = await q.query(d.sql, [org, from, to]);
  return r.rows;
}

function window(query: any) {
  const to = query.to ? dateOnly(query.to, 'to') : todayIso();
  const from = query.from ? dateOnly(query.from, 'from') : `${to.slice(0, 4)}-01-01`;
  return { from, to };
}

export function registerBiRoutes(app: Express): void {
  const VIEW = [Permission.BI_VIEW, Permission.BI_MANAGE];

  app.get('/api/bi/datasets', authenticate, requireAnyPermission(...VIEW), async (req: Request, res: Response) => {
    const perms = req.session!.permissions;
    return ok(req, res, DATASETS.map(({ sql: _sql, ...d }) => ({ ...d, readable: canRead(perms, d as Dataset) })));
  });

  app.get('/api/bi/datasets/:code/query', authenticate, requireAnyPermission(...VIEW), async (req: Request, res: Response) => {
    const d = datasetByCode(req.params.code);
    if (!d) throw notFound('Dataset');
    if (!canRead(req.session!.permissions, d)) throw new ApiError(403, ErrorCode.FORBIDDEN_SCOPE, `You need ${d.permission.join(' or ')} to read ${d.name}`);
    const { from, to } = window(req.query);
    const rows = await runDataset(db, req.session!.organization_id, d, from, to);
    if (req.query.format === 'csv') {
      const cols = [d.dimension, ...d.measures];
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${d.code}_${from}_${to}.csv"`);
      return res.send([cols.join(','), ...rows.map((r: any) => cols.map((c) => csvCell(r[c])).join(','))].join('\n'));
    }
    return ok(req, res, { dataset: d.code, from, to, dimension: d.dimension, measures: d.measures, rows });
  });

  defineResource(app, {
    path: '/api/bi/dashboards',
    table: 'bi_dashboards',
    label: 'Dashboard',
    event: 'BI_DASHBOARD',
    module: 'BI',
    view: VIEW,
    create: Permission.BI_MANAGE,
    update: Permission.BI_MANAGE,
    fields: {
      code: { type: 'string', required: true, max: 40, pattern: /^[A-Z0-9-]+$/ },
      name: { type: 'string', required: true },
      description: { type: 'text' },
      widgets: { type: 'json', required: true },
      visibility: { type: 'enum', values: ['PRIVATE', 'SHARED'], default: 'PRIVATE' },
    },
    editable: ['name', 'description', 'widgets', 'visibility'],
    editableIn: ['ACTIVE'],
    initialStatus: 'ACTIVE',
    select: `t.*, u.name AS owner_name, jsonb_array_length(t.widgets) AS widget_count`,
    joins: 'LEFT JOIN users u ON u.id = t.created_by',
    search: ['code', 't.name'],
    filters: ['visibility'],
    orderBy: 't.name',
    beforeCreate: async (ctx, v) => {
      v.widgets = JSON.stringify(validateWidgets(v.widgets));
      const dup = await ctx.tx.query(`SELECT 1 FROM bi_dashboards WHERE organization_id = $1 AND code = $2`, [ctx.org, v.code]);
      if (dup.rows.length) throw new ApiError(409, ErrorCode.DUPLICATE_RESOURCE, `Dashboard ${v.code} already exists`, { field: 'code' });
    },
    beforeUpdate: async (ctx, row, v) => {
      if (row.created_by !== ctx.user && !ctx.req.session!.permissions.includes(Permission.CONFIG_MANAGE)) throw new ApiError(403, ErrorCode.FORBIDDEN_SCOPE, 'Only the owner can edit this dashboard');
      if (v.widgets !== undefined) v.widgets = JSON.stringify(validateWidgets(v.widgets));
    },
    commands: { archive: { from: ['ACTIVE'], to: 'ARCHIVED', permission: Permission.BI_MANAGE }, restore: { from: ['ARCHIVED'], to: 'ACTIVE', permission: Permission.BI_MANAGE } },
  });

  // Render: private dashboards are visible to their owner only; each widget is permission-checked.
  app.get('/api/bi/dashboards/:id/render', authenticate, requireAnyPermission(...VIEW), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const r = await db.query(`SELECT * FROM bi_dashboards WHERE organization_id = $1 AND id::text = $2`, [org, req.params.id]);
    const dash = r.rows[0];
    if (!dash || (dash.visibility === 'PRIVATE' && dash.created_by !== req.session!.user_id)) throw notFound('Dashboard');
    const { from, to } = window(req.query);
    const perms = req.session!.permissions;
    const widgets = [];
    for (const w of (typeof dash.widgets === 'string' ? JSON.parse(dash.widgets) : dash.widgets) as any[]) {
      const d = datasetByCode(w.dataset);
      if (!d) {
        widgets.push({ ...w, error: 'Dataset no longer exists' });
        continue;
      }
      if (!canRead(perms, d)) {
        widgets.push({ ...w, forbidden: true, dimension: d.dimension, rows: [] });
        continue;
      }
      widgets.push({ ...w, dimension: d.dimension, measures: d.measures, rows: await runDataset(db, org, d, from, to) });
    }
    return ok(req, res, { id: dash.id, name: dash.name, description: dash.description, from, to, widgets });
  });
}
