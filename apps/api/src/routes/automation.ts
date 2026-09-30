import type { Express, Request, Response } from 'express';
import crypto from 'node:crypto';
import { Money } from '@omnysync/financial-engine';
import { Permission } from '@omnysync/contracts';
import { db, auditLogger, authenticate, requirePermission, requireAnyPermission } from '../context.js';
import { ok } from '../lib/http.js';
import { invalidState, sodViolation, validationError } from '../lib/errors.js';
import { arrayOf, bool, dateOnly, decimal, int, oneOf, optionalDate, optionalStr, str, uuid } from '../lib/validate.js';
import { requireOrgRow } from '../lib/scope.js';
import { ensureDefaultRules, runRule, tick } from '../automation/engine.js';
import { nextRun } from '../automation/schedule.js';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function specOf(r: any) {
  return { schedule_kind: r.schedule_kind, interval_minutes: r.interval_minutes, run_at_local: String(r.run_at_local || '06:00').slice(0, 5), day_of_month: r.day_of_month, timezone: r.timezone || 'Asia/Karachi' };
}

/** Validates recurring journal lines: balanced, one side per line, org-scoped active leaf accounts. */
async function validateTemplateLines(orgId: string, raw: unknown) {
  const lines = arrayOf<any>(raw, 'lines', { min: 2, max: 50 }).map((l, i) => {
    const debit = decimal(l?.debit == null || l.debit === '' ? '0' : String(l.debit), `lines[${i}].debit`, { sign: 'nonNegative', scale: 2 });
    const credit = decimal(l?.credit == null || l.credit === '' ? '0' : String(l.credit), `lines[${i}].credit`, { sign: 'nonNegative', scale: 2 });
    if (Money.from(debit).isZero() === Money.from(credit).isZero()) throw validationError(`Line ${i + 1} must have exactly one of debit or credit`);
    return { account_code: str(l?.account_code, `lines[${i}].account_code`, { max: 32 }), debit, credit, description: optionalStr(l?.description, `lines[${i}].description`, 200) || undefined };
  });
  const dr = lines.reduce((s, l) => s.add(l.debit), Money.zero());
  const cr = lines.reduce((s, l) => s.add(l.credit), Money.zero());
  if (!dr.equals(cr)) throw validationError(`Template is unbalanced: debits ${dr.toFixed(2)} ≠ credits ${cr.toFixed(2)}`);
  const codes = [...new Set(lines.map((l) => l.account_code))];
  const acc = await db.query(
    `SELECT a.code FROM accounts a WHERE a.organization_id = $1 AND a.code = ANY($2::text[]) AND a.is_active AND a.posting_allowed
       AND NOT EXISTS (SELECT 1 FROM accounts c WHERE c.parent_id = a.id)`,
    [orgId, codes],
  );
  const found = new Set(acc.rows.map((r: any) => r.code));
  const missing = codes.filter((c) => !found.has(c));
  if (missing.length) throw validationError(`Accounts must be active posting (leaf) accounts: ${missing.join(', ')}`);
  return { lines, total: dr.toFixed(2) };
}

export function registerAutomationRoutes(app: Express): void {
  const view = requirePermission(Permission.AUTOMATION_VIEW);
  const manage = requirePermission(Permission.AUTOMATION_MANAGE);
  const run = requirePermission(Permission.AUTOMATION_RUN);
  const recurringRead = requireAnyPermission(Permission.AUTOMATION_VIEW, Permission.FINANCE_JOURNAL_CREATE, Permission.FINANCE_JOURNAL_APPROVE);

  // ---------------- Rules ----------------
  app.get('/api/automation/rules', authenticate, view, async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const r = await db.query(
      `SELECT r.*, (SELECT COUNT(*) FROM automation_alerts a WHERE a.rule_id = r.id AND a.status <> 'RESOLVED')::int AS open_alerts
         FROM automation_rules r WHERE r.organization_id = $1 ORDER BY r.code`,
      [org],
    );
    return ok(req, res, r.rows, 200, { total_count: r.rows.length });
  });

  /** Installs the default rule catalogue (idempotent). Explicit POST — reads never mutate. */
  app.post('/api/automation/rules/install-defaults', authenticate, manage, async (req: Request, res: Response) => {
    await ensureDefaultRules(db, req.session!.organization_id);
    const r = await db.query(`SELECT COUNT(*)::int AS n FROM automation_rules WHERE organization_id = $1`, [req.session!.organization_id]);
    return ok(req, res, { rules: r.rows[0].n });
  });

  app.post('/api/automation/rules/:id', authenticate, manage, async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const out = await db.transaction(async (tx) => {
      const before = await requireOrgRow<any>(tx, 'automation_rules', req.params.id, org, 'Automation rule', { forUpdate: true });
      if (req.body?.version != null && Number(req.body.version) !== Number(before.version)) throw invalidState('Rule was changed by someone else; reload and retry', { current_version: before.version });
      const next: any = { ...before };
      if (req.body?.schedule_kind !== undefined) next.schedule_kind = oneOf(req.body.schedule_kind, 'schedule_kind', ['INTERVAL', 'DAILY', 'MONTHLY'] as const);
      if (req.body?.interval_minutes !== undefined) next.interval_minutes = int(req.body.interval_minutes, 'interval_minutes', { min: 5, max: 10080 });
      if (req.body?.run_at_local !== undefined) {
        const t = str(req.body.run_at_local, 'run_at_local', { max: 5 });
        if (!TIME_RE.test(t)) throw validationError('run_at_local must be HH:MM (24h)');
        next.run_at_local = t;
      }
      if (req.body?.day_of_month !== undefined) next.day_of_month = req.body.day_of_month === null ? null : int(req.body.day_of_month, 'day_of_month', { min: 1, max: 28 });
      if (req.body?.max_attempts !== undefined) next.max_attempts = int(req.body.max_attempts, 'max_attempts', { min: 1, max: 10 });
      if (req.body?.is_active !== undefined) next.is_active = bool(req.body.is_active);
      if (req.body?.config !== undefined) {
        if (typeof req.body.config !== 'object' || req.body.config === null || Array.isArray(req.body.config)) throw validationError('config must be an object');
        if (JSON.stringify(req.body.config).length > 8000) throw validationError('config too large');
        next.config = req.body.config;
      }
      if (next.schedule_kind === 'INTERVAL' && !next.interval_minutes) throw validationError('interval_minutes is required for INTERVAL schedules');
      if (next.schedule_kind === 'MONTHLY' && !next.day_of_month) next.day_of_month = 1;
      const nextAt = nextRun(specOf(next), new Date()).toISOString();
      const r = await tx.query(
        `UPDATE automation_rules SET schedule_kind=$2, interval_minutes=$3, run_at_local=$4, day_of_month=$5, max_attempts=$6, is_active=$7, config=$8,
            next_run_at=$9, version = version + 1, updated_by=$10, updated_at=NOW() WHERE id=$1 RETURNING *`,
        [before.id, next.schedule_kind, next.interval_minutes, next.run_at_local, next.day_of_month, next.max_attempts, next.is_active, JSON.stringify(typeof next.config === 'string' ? JSON.parse(next.config) : next.config || {}), nextAt, req.session!.user_id],
      );
      await auditLogger.record({ organization_id: org, user_id: req.session!.user_id, action: 'AUTOMATION_RULE_UPDATED', entity_type: 'AUTOMATION_RULE', entity_id: before.id, before_state: { version: before.version, schedule_kind: before.schedule_kind, interval_minutes: before.interval_minutes, run_at_local: before.run_at_local, config: before.config, is_active: before.is_active }, after_state: { version: r.rows[0].version, schedule_kind: next.schedule_kind, interval_minutes: next.interval_minutes, run_at_local: next.run_at_local, config: next.config, is_active: next.is_active }, correlation_id: req.correlationId }, tx);
      return r.rows[0];
    });
    return ok(req, res, out);
  });

  for (const action of ['pause', 'resume'] as const) {
    app.post(`/api/automation/rules/:id/${action}`, authenticate, manage, async (req: Request, res: Response) => {
      const org = req.session!.organization_id;
      const reason = optionalStr(req.body?.reason, 'reason', 500);
      const out = await db.transaction(async (tx) => {
        const rule = await requireOrgRow<any>(tx, 'automation_rules', req.params.id, org, 'Automation rule', { forUpdate: true });
        const paused = action === 'pause';
        const nextAt = paused ? rule.next_run_at : nextRun(specOf(rule), new Date()).toISOString();
        const r = await tx.query(`UPDATE automation_rules SET paused=$2, next_run_at=$3, version=version+1, updated_by=$4, updated_at=NOW() WHERE id=$1 RETURNING *`, [rule.id, paused, nextAt, req.session!.user_id]);
        await auditLogger.record({ organization_id: org, user_id: req.session!.user_id, action: paused ? 'AUTOMATION_RULE_PAUSED' : 'AUTOMATION_RULE_RESUMED', entity_type: 'AUTOMATION_RULE', entity_id: rule.id, after_state: { reason }, correlation_id: req.correlationId }, tx);
        return r.rows[0];
      });
      return ok(req, res, out);
    });
  }

  app.post('/api/automation/rules/:id/run', authenticate, run, async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const rule = await requireOrgRow<any>(db, 'automation_rules', req.params.id, org, 'Automation rule');
    if (!rule.is_active) throw invalidState('Rule is disabled');
    const outcome = await runRule(db, rule, { trigger: 'MANUAL', userId: req.session!.user_id, occurrence: `MANUAL:${crypto.randomUUID()}` });
    return ok(req, res, outcome, outcome.status === 'SUCCEEDED' ? 200 : 207);
  });

  /** Runs everything currently due for the caller's organization (same path as the scheduler). */
  app.post('/api/automation/tick', authenticate, run, async (req: Request, res: Response) => {
    await ensureDefaultRules(db, req.session!.organization_id);
    const results = await tick(db, new Date(), req.session!.organization_id);
    return ok(req, res, results);
  });

  app.get('/api/automation/runs', authenticate, view, async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const params: any[] = [org];
    let where = 'ar.organization_id = $1';
    if (typeof req.query.rule_id === 'string' && req.query.rule_id) {
      params.push(uuid(req.query.rule_id, 'rule_id'));
      where += ` AND ar.rule_id = $${params.length}`;
    }
    if (typeof req.query.status === 'string' && req.query.status) {
      params.push(oneOf(req.query.status, 'status', ['RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD'] as const));
      where += ` AND ar.status = $${params.length}`;
    }
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const r = await db.query(
      `SELECT ar.*, r.code AS rule_code, r.name AS rule_name FROM automation_runs ar JOIN automation_rules r ON r.id = ar.rule_id
        WHERE ${where} ORDER BY ar.started_at DESC LIMIT ${limit}`,
      params,
    );
    return ok(req, res, r.rows, 200, { total_count: r.rows.length });
  });

  // ---------------- Alerts inbox ----------------
  app.get('/api/automation/alerts', authenticate, view, async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const params: any[] = [org];
    let where = 'a.organization_id = $1';
    const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : 'ACTIVE';
    if (status === 'ACTIVE') where += ` AND a.status <> 'RESOLVED'`;
    else if (status !== 'ALL') {
      params.push(oneOf(status, 'status', ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'] as const));
      where += ` AND a.status = $${params.length}`;
    }
    if (typeof req.query.category === 'string' && req.query.category) {
      params.push(str(req.query.category, 'category', { max: 40 }));
      where += ` AND a.category = $${params.length}`;
    }
    const r = await db.query(
      `SELECT a.*, r.code AS rule_code FROM automation_alerts a LEFT JOIN automation_rules r ON r.id = a.rule_id WHERE ${where}
        ORDER BY CASE a.severity WHEN 'CRITICAL' THEN 0 WHEN 'WARNING' THEN 1 ELSE 2 END, a.last_seen_at DESC LIMIT 500`,
      params,
    );
    const counts = await db.query(`SELECT severity, COUNT(*)::int AS n FROM automation_alerts WHERE organization_id = $1 AND status <> 'RESOLVED' GROUP BY severity`, [org]);
    return ok(req, res, r.rows, 200, { total_count: r.rows.length, open_by_severity: Object.fromEntries(counts.rows.map((c: any) => [c.severity, c.n])) });
  });

  for (const action of ['acknowledge', 'resolve'] as const) {
    app.post(`/api/automation/alerts/:id/${action}`, authenticate, view, async (req: Request, res: Response) => {
      const org = req.session!.organization_id;
      const note = optionalStr(req.body?.note, 'note', 1000);
      const out = await db.transaction(async (tx) => {
        const a = await requireOrgRow<any>(tx, 'automation_alerts', req.params.id, org, 'Alert', { forUpdate: true });
        if (a.status === 'RESOLVED') throw invalidState('Alert is already resolved');
        if (action === 'acknowledge' && a.status === 'ACKNOWLEDGED') return a;
        const r =
          action === 'acknowledge'
            ? await tx.query(`UPDATE automation_alerts SET status='ACKNOWLEDGED', acknowledged_by=$2, acknowledged_at=NOW() WHERE id=$1 RETURNING *`, [a.id, req.session!.user_id])
            : await tx.query(`UPDATE automation_alerts SET status='RESOLVED', resolved_by=$2, resolved_at=NOW() WHERE id=$1 RETURNING *`, [a.id, req.session!.user_id]);
        await auditLogger.record({ organization_id: org, user_id: req.session!.user_id, action: action === 'acknowledge' ? 'ALERT_ACKNOWLEDGED' : 'ALERT_RESOLVED', entity_type: 'AUTOMATION_ALERT', entity_id: a.id, before_state: { status: a.status }, after_state: { status: r.rows[0].status, note }, correlation_id: req.correlationId }, tx);
        return r.rows[0];
      });
      return ok(req, res, out);
    });
  }

  // ---------------- Recurring journal templates (A3, SoD) ----------------
  app.get('/api/automation/recurring-journals', authenticate, recurringRead, async (req: Request, res: Response) => {
    const r = await db.query(
      `SELECT t.*, cu.name AS created_by_name, au.name AS approved_by_name, j.journal_number AS last_journal_number
         FROM recurring_journal_templates t LEFT JOIN users cu ON cu.id = t.created_by LEFT JOIN users au ON au.id = t.approved_by
         LEFT JOIN journals j ON j.id = t.last_journal_id WHERE t.organization_id = $1 ORDER BY t.code`,
      [req.session!.organization_id],
    );
    return ok(req, res, r.rows, 200, { total_count: r.rows.length });
  });

  app.post('/api/automation/recurring-journals', authenticate, requirePermission(Permission.FINANCE_JOURNAL_CREATE), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const code = str(req.body?.code, 'code', { max: 64 }).toUpperCase();
    const name = str(req.body?.name, 'name', { max: 255 });
    const description = optionalStr(req.body?.description, 'description', 2000);
    const day = int(req.body?.day_of_month, 'day_of_month', { min: 1, max: 28 });
    const start = dateOnly(req.body?.start_date, 'start_date');
    const end = optionalDate(req.body?.end_date, 'end_date');
    if (end && end < start) throw validationError('end_date must be on or after start_date');
    const { lines, total } = await validateTemplateLines(org, req.body?.lines);
    const maxAmount = req.body?.max_amount == null || req.body.max_amount === '' ? total : decimal(String(req.body.max_amount), 'max_amount', { sign: 'positive', scale: 2 });
    if (Money.from(total).gt(maxAmount)) throw validationError('Template total exceeds max_amount');
    // First occurrence: the configured day in the start month, or the next month if already passed.
    const [y, m] = start.split('-').map(Number);
    let first = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (first < start) {
      const nm = m === 12 ? 1 : m + 1;
      first = `${m === 12 ? y + 1 : y}-${String(nm).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    if (end && first > end) throw validationError('No occurrence falls between start_date and end_date');
    const out = await db.transaction(async (tx) => {
      const dup = await tx.query(`SELECT 1 FROM recurring_journal_templates WHERE organization_id = $1 AND code = $2`, [org, code]);
      if (dup.rows.length) throw validationError(`Template code ${code} already exists`);
      const r = await tx.query(
        `INSERT INTO recurring_journal_templates (organization_id, legal_entity_id, code, name, description, lines, total_amount, day_of_month, start_date, end_date, next_run_date, max_amount, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [org, req.session!.legal_entity_id, code, name, description, JSON.stringify(lines), total, day, start, end, first, maxAmount, req.session!.user_id],
      );
      await auditLogger.record({ organization_id: org, user_id: req.session!.user_id, action: 'RECURRING_JOURNAL_CREATED', entity_type: 'RECURRING_JOURNAL', entity_id: r.rows[0].id, after_state: { code, total, day_of_month: day, start, end }, correlation_id: req.correlationId }, tx);
      return r.rows[0];
    });
    return ok(req, res, out, 201);
  });

  app.post('/api/automation/recurring-journals/:id/approve', authenticate, requirePermission(Permission.FINANCE_JOURNAL_APPROVE), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const out = await db.transaction(async (tx) => {
      const t = await requireOrgRow<any>(tx, 'recurring_journal_templates', req.params.id, org, 'Recurring journal template', { forUpdate: true });
      if (t.created_by === req.session!.user_id) throw sodViolation('The author of a recurring journal cannot approve it');
      if (!['DRAFT', 'PAUSED'].includes(t.status)) throw invalidState(`Template is ${t.status}`);
      const r = await tx.query(`UPDATE recurring_journal_templates SET status='ACTIVE', approved_by=$2, approved_at=NOW(), version=version+1 WHERE id=$1 RETURNING *`, [t.id, req.session!.user_id]);
      await auditLogger.record({ organization_id: org, user_id: req.session!.user_id, action: 'RECURRING_JOURNAL_APPROVED', entity_type: 'RECURRING_JOURNAL', entity_id: t.id, before_state: { status: t.status }, after_state: { status: 'ACTIVE' }, correlation_id: req.correlationId }, tx);
      return r.rows[0];
    });
    return ok(req, res, out);
  });

  for (const action of ['pause', 'end'] as const) {
    app.post(`/api/automation/recurring-journals/:id/${action}`, authenticate, requireAnyPermission(Permission.FINANCE_JOURNAL_APPROVE, Permission.AUTOMATION_MANAGE), async (req: Request, res: Response) => {
      const org = req.session!.organization_id;
      const out = await db.transaction(async (tx) => {
        const t = await requireOrgRow<any>(tx, 'recurring_journal_templates', req.params.id, org, 'Recurring journal template', { forUpdate: true });
        if (t.status === 'ENDED') throw invalidState('Template has ended');
        if (action === 'pause' && t.status !== 'ACTIVE') throw invalidState('Only active templates can be paused');
        // Resuming after a pause requires fresh approval (approve endpoint accepts PAUSED).
        const status = action === 'pause' ? 'PAUSED' : 'ENDED';
        const r = await tx.query(`UPDATE recurring_journal_templates SET status=$2, version=version+1 WHERE id=$1 RETURNING *`, [t.id, status]);
        await auditLogger.record({ organization_id: org, user_id: req.session!.user_id, action: action === 'pause' ? 'RECURRING_JOURNAL_PAUSED' : 'RECURRING_JOURNAL_ENDED', entity_type: 'RECURRING_JOURNAL', entity_id: t.id, before_state: { status: t.status }, after_state: { status }, correlation_id: req.correlationId }, tx);
        return r.rows[0];
      });
      return ok(req, res, out);
    });
  }
}
