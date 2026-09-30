/** AUT: event-triggered rules (builder API), simulation without side effects, task inbox. */
import type { Express, Request, Response } from 'express';
import { Permission, ErrorCode } from '@omnysync/contracts';
import { db, authenticate, requireAnyPermission, requirePermission } from '../context.js';
import { ok } from '../lib/http.js';
import { ApiError, notFound } from '../lib/errors.js';
import { defineResource, unitOfWork, audit } from '../lib/resource.js';
import { matchesAll, renderTemplate, validateDefinition } from '../automation/conditions.js';
import { processEvents } from '../automation/events.js';

const VIEW = [Permission.AUTOMATION_VIEW, Permission.AUTOMATION_MANAGE];
const parse = (v: any) => (typeof v === 'string' ? JSON.parse(v) : v);

export function registerAutomationEventRoutes(app: Express): void {
  app.get('/api/automation/event-catalog', authenticate, requireAnyPermission(...VIEW), async (req: Request, res: Response) => {
    const r = await db.query(
      `SELECT event_type, COUNT(*)::int AS count, MAX(created_at) AS last_seen FROM outbox_events WHERE organization_id = $1 GROUP BY event_type ORDER BY event_type`,
      [req.session!.organization_id],
    );
    const out = [];
    for (const row of r.rows) {
      const sample = (await db.query(`SELECT payload FROM outbox_events WHERE organization_id = $1 AND event_type = $2 ORDER BY created_at DESC LIMIT 1`, [req.session!.organization_id, row.event_type])).rows[0];
      const payload = parse(sample?.payload) || {};
      out.push({ id: row.event_type, event_type: row.event_type, count: row.count, last_seen: row.last_seen, fields: Object.keys(payload).filter((k) => !/_hash$/.test(k)).slice(0, 40), sample: payload });
    }
    return ok(req, res, out);
  });

  defineResource(app, {
    path: '/api/automation/event-rules',
    table: 'automation_event_rules',
    label: 'Event rule',
    event: 'AUTOMATION_EVENT_RULE',
    module: 'AUT',
    view: VIEW,
    create: Permission.AUTOMATION_MANAGE,
    update: Permission.AUTOMATION_MANAGE,
    fields: {
      code: { type: 'string', required: true, max: 64, pattern: /^[A-Z0-9_-]+$/ },
      name: { type: 'string', required: true },
      description: { type: 'text' },
      event_type: { type: 'string', required: true, max: 80, pattern: /^[A-Z][A-Z0-9_]+$/ },
      conditions: { type: 'json' },
      actions: { type: 'json', required: true },
    },
    editable: ['name', 'description', 'event_type', 'conditions', 'actions'],
    initialStatus: 'DRAFT',
    search: ['code', 'name', 'event_type'],
    orderBy: 't.code',
    select: `t.*, (SELECT COUNT(*)::int FROM automation_event_deliveries d WHERE d.rule_id = t.id AND d.matched) AS match_count`,
    beforeCreate: async (_ctx, v) => {
      const errs = validateDefinition({ event_type: v.event_type, conditions: parse(v.conditions) || [], actions: parse(v.actions) });
      if (errs.length) throw new ApiError(400, ErrorCode.VALIDATION_FAILED, errs.join('; '), { problems: errs });
      if (!v.conditions) v.conditions = '[]';
    },
    beforeUpdate: async (_ctx, row, v) => {
      const merged = { event_type: v.event_type ?? row.event_type, conditions: parse(v.conditions ?? row.conditions) || [], actions: parse(v.actions ?? row.actions) };
      const errs = validateDefinition(merged);
      if (errs.length) throw new ApiError(400, ErrorCode.VALIDATION_FAILED, errs.join('; '), { problems: errs });
    },
    commands: {
      // Editing a published rule changes the draft only; running deliveries keep their version until re-published.
      publish: {
        from: ['DRAFT', 'PUBLISHED', 'PAUSED'],
        to: 'PUBLISHED',
        permission: Permission.AUTOMATION_MANAGE,
        run: async (ctx, row) => {
          const def = { event_type: row.event_type, conditions: parse(row.conditions) || [], actions: parse(row.actions) || [] };
          const errs = validateDefinition(def);
          if (errs.length) throw new ApiError(400, ErrorCode.VALIDATION_FAILED, errs.join('; '), { problems: errs });
          return { set: { version: Number(row.version) + 1, published_definition: JSON.stringify(def), published_at: new Date().toISOString(), published_by: ctx.user } };
        },
      },
      pause: { from: ['PUBLISHED'], to: 'PAUSED', permission: Permission.AUTOMATION_MANAGE },
    },
  });

  app.post('/api/automation/event-rules/simulate', authenticate, requireAnyPermission(...VIEW), async (req: Request, res: Response) => {
    const def = { event_type: req.body?.event_type, conditions: req.body?.conditions || [], actions: req.body?.actions || [] };
    const errs = validateDefinition(def);
    if (errs.length) throw new ApiError(400, ErrorCode.VALIDATION_FAILED, errs.join('; '), { problems: errs });
    const evs = await db.query(`SELECT id, payload, created_at FROM outbox_events WHERE organization_id = $1 AND event_type = $2 ORDER BY created_at DESC LIMIT 50`, [req.session!.organization_id, def.event_type]);
    const results = evs.rows.map((e) => {
      const p = parse(e.payload) || {};
      const matched = matchesAll(def.conditions, p);
      return { event_id: e.id, created_at: e.created_at, matched, preview: matched ? def.actions.map((a: any) => `${a.type}: ${renderTemplate(a.title, p)}`) : [] };
    });
    // Pure evaluation: nothing is written (UX-SCREEN-SPECS §11 "simulation without side effects").
    return ok(req, res, { evaluated: results.length, matched: results.filter((r) => r.matched).length, results });
  });

  app.post('/api/automation/events/process', authenticate, requirePermission(Permission.AUTOMATION_RUN), async (req: Request, res: Response) => {
    return ok(req, res, await processEvents(db, req.session!.organization_id));
  });

  app.get('/api/automation/tasks', authenticate, requireAnyPermission(...VIEW), async (req: Request, res: Response) => {
    const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : 'OPEN';
    const r = await db.query(
      `SELECT t.*, r.code AS rule_code, r.name AS rule_name FROM automation_tasks t LEFT JOIN automation_event_rules r ON r.id = t.rule_id
       WHERE t.organization_id = $1 AND t.status = $2 ORDER BY t.due_date NULLS LAST, t.created_at DESC LIMIT 200`,
      [req.session!.organization_id, status],
    );
    return ok(req, res, r.rows);
  });

  app.post('/api/automation/tasks/:id/complete', authenticate, requireAnyPermission(...VIEW), async (req: Request, res: Response) => {
    const out = await unitOfWork(req, async (ctx) => {
      const r = await ctx.tx.query(`UPDATE automation_tasks SET status = 'DONE', completed_by = $3, completed_at = NOW() WHERE id::text = $1 AND organization_id = $2 AND status = 'OPEN' RETURNING *`, [req.params.id, ctx.org, ctx.user]);
      if (!r.rows[0]) {
        const ex = await ctx.tx.query(`SELECT status FROM automation_tasks WHERE id::text = $1 AND organization_id = $2`, [req.params.id, ctx.org]);
        if (!ex.rows[0]) throw notFound('Task');
        throw new ApiError(409, ErrorCode.INVALID_STATE, `Task is already ${ex.rows[0].status}`);
      }
      await audit(ctx, 'AUTOMATION_TASK_COMPLETED', 'AUTOMATION_TASK', r.rows[0].id, { status: 'OPEN' }, { status: 'DONE' });
      return r.rows[0];
    });
    return ok(req, res, out);
  });
}
