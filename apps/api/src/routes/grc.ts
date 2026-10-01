/**
 * GRC — risk register, controls and incidents. Scores are likelihood × impact (1–25). Residual
 * cannot exceed inherent. A risk can only be ACCEPTED when its residual score is within the
 * configured appetite (grc.risk_appetite). Control tests: FAIL marks the control DEFICIENT and
 * opens a CONTROL_FAILURE incident; PASS marks it OPERATING and schedules the next test. A risk
 * cannot be CLOSED while any of its controls is DEFICIENT. Incidents need root cause and corrective
 * action before resolution.
 */
import type { Express, Request, Response } from 'express';
import { Permission, ErrorCode } from '@omnysync/contracts';
import { db, authenticate, requireAnyPermission } from '../context.js';
import { ok } from '../lib/http.js';
import { ApiError, validationError } from '../lib/errors.js';
import { defineResource, loadRow, unitOfWork, audit, emit } from '../lib/resource.js';
import { requireModule } from '../lib/modules.js';
import { dateOnly, int, todayIso, toIsoDate } from '../lib/validate.js';
import { nextDocumentNumber } from '../lib/numbering.js';
import { getSetting } from './config.js';
import { addMonths } from './subscriptions.js';

const VIEW = [Permission.GRC_VIEW, Permission.GRC_MANAGE];
const FREQ: Record<string, number> = { MONTHLY: 1, QUARTERLY: 3, ANNUAL: 12 };

export const score = (l: number, i: number) => l * i;
export function rating(s: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
  return s >= 20 ? 'CRITICAL' : s >= 12 ? 'HIGH' : s >= 6 ? 'MEDIUM' : 'LOW';
}
export function checkResidual(l: number, i: number, rl?: number | null, ri?: number | null) {
  if ((rl == null) !== (ri == null)) throw validationError('Give both residual likelihood and impact, or neither', { field: rl == null ? 'residual_likelihood' : 'residual_impact' });
  if (rl != null && ri != null && score(rl, ri) > score(l, i)) throw validationError('Residual score cannot exceed the inherent score', { field: 'residual_likelihood' });
}

export function registerGrcRoutes(app: Express): void {
  const riskSel = `t.*, t.likelihood * t.impact AS inherent_score, t.residual_likelihood * t.residual_impact AS residual_score,
    (SELECT COUNT(*)::int FROM grc_controls c WHERE c.risk_id = t.id AND c.status <> 'RETIRED') AS controls,
    (SELECT COUNT(*)::int FROM grc_controls c WHERE c.risk_id = t.id AND c.status = 'DEFICIENT') AS deficient_controls`;
  defineResource(app, {
    path: '/api/grc/risks',
    table: 'grc_risks',
    label: 'Risk',
    event: 'GRC_RISK',
    module: 'GRC',
    view: VIEW,
    create: Permission.GRC_MANAGE,
    update: Permission.GRC_MANAGE,
    fields: {
      title: { type: 'string', required: true },
      description: { type: 'text' },
      category: { type: 'enum', values: ['OPERATIONAL', 'FINANCIAL', 'COMPLIANCE', 'SAFETY', 'IT', 'STRATEGIC'], required: true },
      owner: { type: 'string', max: 120 },
      likelihood: { type: 'int', required: true, min: 1, max: 5 },
      impact: { type: 'int', required: true, min: 1, max: 5 },
      residual_likelihood: { type: 'int', min: 1, max: 5 },
      residual_impact: { type: 'int', min: 1, max: 5 },
      treatment: { type: 'enum', values: ['MITIGATE', 'ACCEPT', 'TRANSFER', 'AVOID'], default: 'MITIGATE' },
      review_date: { type: 'date' },
    },
    editable: ['title', 'description', 'owner', 'likelihood', 'impact', 'residual_likelihood', 'residual_impact', 'treatment', 'review_date'],
    editableIn: ['OPEN', 'MITIGATING', 'ACCEPTED'],
    numbering: { column: 'code', prefix: 'RSK' },
    initialStatus: 'OPEN',
    select: riskSel,
    search: ['code', 'title', 'owner'],
    filters: ['category'],
    orderBy: '(t.likelihood * t.impact) DESC, t.code',
    beforeCreate: async (_c, v) => checkResidual(v.likelihood, v.impact, v.residual_likelihood, v.residual_impact),
    beforeUpdate: async (_c, row, v) => {
      const m = { ...row, ...v };
      checkResidual(m.likelihood, m.impact, m.residual_likelihood, m.residual_impact);
      if (row.status === 'ACCEPTED' && (v.residual_likelihood !== undefined || v.residual_impact !== undefined || v.likelihood !== undefined || v.impact !== undefined)) {
        // Re-scoring an accepted risk re-opens it for review.
        v.status = 'OPEN';
      }
    },
    detail: async (q, row) => ({
      controls: (await q.query(`SELECT id, code, title, control_type, frequency, status, last_result, next_test_due FROM grc_controls WHERE risk_id = $1 ORDER BY code`, [row.id])).rows,
      incidents: (await q.query(`SELECT id, number, title, severity, status, occurred_on FROM grc_incidents WHERE risk_id = $1 ORDER BY occurred_on DESC`, [row.id])).rows,
    }),
    commands: {
      start_mitigation: { from: ['OPEN'], to: 'MITIGATING', permission: Permission.GRC_MANAGE },
      accept: {
        from: ['OPEN', 'MITIGATING'],
        to: 'ACCEPTED',
        permission: Permission.GRC_MANAGE,
        fields: { acceptance_note: { type: 'text', required: true } },
        run: async (ctx, row, i) => {
          const appetite = Number(await getSetting<number>(ctx.tx, ctx.org, 'grc.risk_appetite'));
          const s = row.residual_likelihood != null ? score(row.residual_likelihood, row.residual_impact) : score(row.likelihood, row.impact);
          if (s > appetite) throw new ApiError(409, ErrorCode.INVALID_STATE, `Residual score ${s} exceeds the risk appetite (${appetite}); mitigate further or raise the appetite`, { score: s, appetite });
          return { set: { acceptance_note: i.acceptance_note, treatment: 'ACCEPT' } };
        },
      },
      close: {
        from: ['OPEN', 'MITIGATING', 'ACCEPTED'],
        to: 'CLOSED',
        permission: Permission.GRC_MANAGE,
        run: async (ctx, row) => {
          const d = (await ctx.tx.query(`SELECT code FROM grc_controls WHERE risk_id = $1 AND status = 'DEFICIENT'`, [row.id])).rows;
          if (d.length) throw new ApiError(409, ErrorCode.INVALID_STATE, `Deficient controls must be remediated first: ${d.map((x: any) => x.code).join(', ')}`);
          return {};
        },
      },
      reopen: { from: ['CLOSED', 'ACCEPTED'], to: 'OPEN', permission: Permission.GRC_MANAGE },
    },
  });

  defineResource(app, {
    path: '/api/grc/controls',
    table: 'grc_controls',
    label: 'Control',
    event: 'GRC_CONTROL',
    module: 'GRC',
    view: VIEW,
    create: Permission.GRC_MANAGE,
    update: Permission.GRC_MANAGE,
    fields: {
      title: { type: 'string', required: true },
      risk_id: { type: 'ref', table: 'grc_risks', required: true, label: 'risk_id' },
      control_type: { type: 'enum', values: ['PREVENTIVE', 'DETECTIVE', 'CORRECTIVE'], required: true },
      frequency: { type: 'enum', values: ['MONTHLY', 'QUARTERLY', 'ANNUAL'], required: true },
      owner: { type: 'string', max: 120 },
      procedure: { type: 'text' },
      next_test_due: { type: 'date' },
    },
    editable: ['title', 'owner', 'procedure', 'frequency', 'next_test_due'],
    editableIn: ['DESIGN', 'OPERATING', 'DEFICIENT'],
    numbering: { column: 'code', prefix: 'CTL' },
    initialStatus: 'DESIGN',
    select: `t.*, r.code AS risk_code, r.title AS risk_title, (t.next_test_due < CURRENT_DATE) AS test_overdue`,
    joins: 'JOIN grc_risks r ON r.id = t.risk_id',
    search: ['t.code', 't.title', 'r.title'],
    filters: ['risk_id'],
    beforeCreate: async (ctx, v) => {
      const r = await loadRow(ctx.tx, 'grc_risks', v.risk_id, ctx.org, 'Risk');
      if (r.status === 'CLOSED') throw new ApiError(409, ErrorCode.INVALID_STATE, 'Cannot add a control to a closed risk');
    },
    detail: async (q, row) => ({ tests: (await q.query(`SELECT t.*, u.email AS tested_by_email FROM grc_control_tests t LEFT JOIN users u ON u.id = t.tested_by WHERE t.control_id = $1 ORDER BY t.test_date DESC, t.created_at DESC`, [row.id])).rows }),
    commands: { retire: { from: ['DESIGN', 'OPERATING', 'DEFICIENT'], to: 'RETIRED', permission: Permission.GRC_MANAGE } },
  });

  app.post('/api/grc/controls/:id/tests', authenticate, requireAnyPermission(Permission.GRC_MANAGE), requireModule('GRC', 'command'), async (req: Request, res: Response) => {
    const b = req.body || {};
    const testDate = b.test_date ? dateOnly(b.test_date, 'test_date') : todayIso();
    if (testDate > todayIso()) throw validationError('test_date cannot be in the future', { field: 'test_date' });
    if (!['PASS', 'FAIL'].includes(b.result)) throw validationError('result must be PASS or FAIL', { field: 'result' });
    const evidence = String(b.evidence ?? '').trim();
    if (evidence.length < 5) throw validationError('evidence is required (what was sampled and seen)', { field: 'evidence' });
    const sample = b.sample_size === undefined || b.sample_size === null || b.sample_size === '' ? null : int(b.sample_size, 'sample_size', { min: 1, max: 100000 });
    const exceptions = b.exceptions === undefined || b.exceptions === '' ? 0 : int(b.exceptions, 'exceptions', { min: 0, max: 100000 });
    if (sample !== null && exceptions > sample) throw validationError('exceptions cannot exceed sample_size', { field: 'exceptions' });
    if (b.result === 'PASS' && exceptions > 0 && sample !== null && exceptions / sample > 0.05) throw validationError('More than 5% exceptions cannot be recorded as PASS', { field: 'result' });
    const out = await unitOfWork(req, async (ctx) => {
      const c = await loadRow(ctx.tx, 'grc_controls', req.params.id, ctx.org, 'Control', true);
      if (c.status === 'RETIRED') throw new ApiError(409, ErrorCode.INVALID_STATE, 'Control is retired');
      const t = await ctx.tx.query(`INSERT INTO grc_control_tests (organization_id, control_id, test_date, result, sample_size, exceptions, evidence, tested_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [ctx.org, c.id, testDate, b.result, sample, exceptions, evidence, ctx.user]);
      const latest = !c.last_tested_on || testDate >= toIsoDate(c.last_tested_on);
      let incident: any = null;
      if (latest) {
        await ctx.tx.query(`UPDATE grc_controls SET last_tested_on = $2, last_result = $3, next_test_due = $4, status = $5, revision = revision + 1, updated_at = NOW() WHERE id = $1`, [c.id, testDate, b.result, addMonths(testDate, FREQ[c.frequency]), b.result === 'PASS' ? 'OPERATING' : 'DEFICIENT']);
      }
      if (b.result === 'FAIL') {
        const number = await nextDocumentNumber(ctx.tx, ctx.org, 'INC', testDate);
        incident = (await ctx.tx.query(
          `INSERT INTO grc_incidents (organization_id, legal_entity_id, number, title, severity, incident_type, occurred_on, risk_id, control_id, description, due_date, status, created_by) VALUES ($1,$2,$3,$4,'HIGH','CONTROL_FAILURE',$5,$6,$7,$8,$9,'REPORTED',$10) RETURNING id, number`,
          [ctx.org, ctx.le, number, `Control ${c.code} failed testing`, testDate, c.risk_id, c.id, evidence, addMonths(testDate, 1), ctx.user],
        )).rows[0];
        await emit(ctx, 'GRC_CONTROL_FAILED', { control_id: c.id, code: c.code, incident_id: incident.id });
      }
      await audit(ctx, 'TEST', 'GRC_CONTROL', c.id, undefined, { result: b.result, test_date: testDate });
      return { ...t.rows[0], incident };
    });
    return ok(req, res, out, 201);
  });

  defineResource(app, {
    path: '/api/grc/incidents',
    table: 'grc_incidents',
    label: 'Incident',
    event: 'GRC_INCIDENT',
    module: 'GRC',
    view: VIEW,
    create: Permission.GRC_MANAGE,
    update: Permission.GRC_MANAGE,
    fields: {
      title: { type: 'string', required: true },
      severity: { type: 'enum', values: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], required: true },
      incident_type: { type: 'enum', values: ['SAFETY', 'ENVIRONMENTAL', 'DATA', 'FRAUD', 'OPERATIONAL', 'CONTROL_FAILURE'], default: 'OPERATIONAL' },
      occurred_on: { type: 'date', required: true },
      risk_id: { type: 'ref', table: 'grc_risks', label: 'risk_id' },
      description: { type: 'text' },
      root_cause: { type: 'text' },
      corrective_action: { type: 'text' },
      due_date: { type: 'date' },
    },
    editable: ['title', 'severity', 'description', 'root_cause', 'corrective_action', 'due_date', 'risk_id'],
    editableIn: ['REPORTED', 'INVESTIGATING'],
    numbering: { column: 'number', prefix: 'INC', dateField: 'occurred_on' },
    initialStatus: 'REPORTED',
    select: `t.*, r.code AS risk_code, c.code AS control_code, (t.due_date < CURRENT_DATE AND t.status IN ('REPORTED','INVESTIGATING')) AS overdue`,
    joins: 'LEFT JOIN grc_risks r ON r.id = t.risk_id LEFT JOIN grc_controls c ON c.id = t.control_id',
    search: ['number', 't.title'],
    filters: ['severity'],
    beforeCreate: async (_c, v) => {
      if (v.occurred_on > todayIso()) throw validationError('occurred_on cannot be in the future', { field: 'occurred_on' });
    },
    commands: {
      investigate: { from: ['REPORTED'], to: 'INVESTIGATING', permission: Permission.GRC_MANAGE },
      resolve: {
        from: ['REPORTED', 'INVESTIGATING'],
        to: 'RESOLVED',
        permission: Permission.GRC_MANAGE,
        fields: { root_cause: { type: 'text' }, corrective_action: { type: 'text' } },
        run: async (ctx, row, i) => {
          const rc = i.root_cause ?? row.root_cause;
          const ca = i.corrective_action ?? row.corrective_action;
          if (!rc || !ca) throw validationError('Root cause and corrective action are required to resolve', { field: !rc ? 'root_cause' : 'corrective_action' });
          return { set: { root_cause: rc, corrective_action: ca } };
        },
      },
      close: {
        from: ['RESOLVED'],
        to: 'CLOSED',
        permission: Permission.GRC_MANAGE,
        sodColumn: 'created_by',
      },
    },
  });

  app.get('/api/grc/summary', authenticate, requireAnyPermission(...VIEW), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const risks = (await db.query(`SELECT likelihood, impact, residual_likelihood, residual_impact, status FROM grc_risks WHERE organization_id = $1 AND status <> 'CLOSED'`, [org])).rows;
    const heat = Array.from({ length: 5 }, () => Array(5).fill(0));
    for (const r of risks) heat[5 - (r.residual_likelihood ?? r.likelihood)][(r.residual_impact ?? r.impact) - 1]++;
    const appetite = Number(await getSetting<number>(db, org, 'grc.risk_appetite'));
    const above = risks.filter((r: any) => score(r.residual_likelihood ?? r.likelihood, r.residual_impact ?? r.impact) > appetite).length;
    const c = (await db.query(`SELECT COUNT(*) FILTER (WHERE status='DEFICIENT')::int deficient, COUNT(*) FILTER (WHERE status <> 'RETIRED' AND next_test_due < CURRENT_DATE)::int tests_overdue, COUNT(*) FILTER (WHERE status='OPERATING')::int operating FROM grc_controls WHERE organization_id = $1`, [org])).rows[0];
    const i = (await db.query(`SELECT COUNT(*) FILTER (WHERE status IN ('REPORTED','INVESTIGATING'))::int open_incidents, COUNT(*) FILTER (WHERE status IN ('REPORTED','INVESTIGATING') AND severity IN ('HIGH','CRITICAL'))::int open_high FROM grc_incidents WHERE organization_id = $1`, [org])).rows[0];
    return ok(req, res, { open_risks: risks.length, above_appetite: above, appetite, heatmap: heat, ...c, ...i });
  });
}
