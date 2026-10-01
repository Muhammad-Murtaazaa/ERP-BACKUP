/**
 * TIM — time & attendance. Weekly timesheets (Monday start) hold clock-range entries; an employee
 * can never have overlapping entries (across all their sheets) or log time on approved leave.
 * Daily hours beyond `time.daily_overtime_after_hours` are overtime at 1.5×. Submit → approve
 * (approver ≠ preparer) → post labour cost DR 511004 (by project) / CR 211011 accrued labour once.
 */
import type { Express, Request, Response } from 'express';
import { Permission, ErrorCode, AccountingPurpose } from '@omnysync/contracts';
import { Money } from '@omnysync/financial-engine';
import { db, authenticate, requireAnyPermission, auditLogger, outboxService } from '../context.js';
import { ok } from '../lib/http.js';
import { ApiError, notFound, validationError } from '../lib/errors.js';
import { audit, defineResource, loadRow, unitOfWork } from '../lib/resource.js';
import { requireModule } from '../lib/modules.js';
import { assertOrgRef } from '../lib/scope.js';
import { bool, dateOnly, str, toIsoDate } from '../lib/validate.js';
import { postJournal } from '../lib/posting.js';
import { getSetting } from './config.js';

const VIEW = [Permission.TIME_VIEW, Permission.TIME_SUBMIT, Permission.TIME_APPROVE];

/** Self-service users can submit time but neither approve nor post: they are limited to their own employee record. */
export function isSelfService(perms: readonly string[]): boolean {
  return perms.includes(Permission.TIME_SUBMIT) && !perms.includes(Permission.TIME_APPROVE) && !perms.includes(Permission.TIME_POST);
}
const ownScope = (req: Request) => (isSelfService(req.session!.permissions) ? { sql: 't.employee_id IN (SELECT id FROM employees WHERE user_id = $SCOPE)', value: req.session!.user_id } : null);
async function assertOwnEmployee(ctx: { tx: any; req: Request; user: string; org: string }, employeeId: string) {
  if (!isSelfService(ctx.req.session!.permissions)) return;
  const r = await ctx.tx.query(`SELECT 1 FROM employees WHERE id = $1 AND organization_id = $2 AND user_id = $3`, [employeeId, ctx.org, ctx.user]);
  if (!r.rows[0]) throw new ApiError(403, ErrorCode.FORBIDDEN_SCOPE, 'You can only record time and leave for your own employee record', { field: 'employee_id' });
}
export const OVERTIME_MULTIPLIER = '1.5';

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const dow = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Working days in a leave window (Sunday is the weekly off-day). */
export function leaveDays(start: string, end: string, holidays: string[] = []): number {
  let n = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) if (dow(d) !== 0 && !holidays.includes(d)) n++;
  return n;
}

/** Totals with daily overtime; cost = (regular + overtime × 1.5) × rate, exact decimals. */
export function timesheetTotals(entries: { work_date: string; hours: string }[], otAfter: string, rate: string) {
  const byDay = new Map<string, Money>();
  for (const e of entries) byDay.set(e.work_date, (byDay.get(e.work_date) || Money.zero()).add(e.hours));
  let total = Money.zero();
  let ot = Money.zero();
  for (const h of byDay.values()) {
    total = total.add(h);
    if (h.gt(otAfter)) ot = ot.add(h.sub(otAfter));
  }
  const regular = total.sub(ot);
  const cost = regular.add(ot.mul(OVERTIME_MULTIPLIER)).mul(rate).round(2);
  return { total_hours: total.toFixed(2), overtime_hours: ot.toFixed(2), cost_amount: cost.toFixed(2) };
}

async function recompute(q: any, org: string, sheet: any) {
  const entries = (await q.query(`SELECT work_date, hours::text FROM tim_entries WHERE timesheet_id = $1`, [sheet.id])).rows.map((e: any) => ({ work_date: toIsoDate(e.work_date), hours: e.hours }));
  const otAfter = String(await getSetting(q, org, 'time.daily_overtime_after_hours'));
  const t = timesheetTotals(entries, otAfter, String(sheet.cost_rate));
  await q.query(`UPDATE tim_timesheets SET total_hours = $2, overtime_hours = $3, cost_amount = $4, revision = revision + 1, updated_at = NOW() WHERE id = $1`, [sheet.id, t.total_hours, t.overtime_hours, t.cost_amount]);
  return t;
}

export function registerTimeRoutes(app: Express): void {
  defineResource(app, {
    path: '/api/time/timesheets',
    table: 'tim_timesheets',
    label: 'Timesheet',
    event: 'TIME_SHEET',
    module: 'TIM',
    view: VIEW,
    create: Permission.TIME_SUBMIT,
    update: Permission.TIME_SUBMIT,
    fields: {
      employee_id: { type: 'ref', table: 'employees', required: true, label: 'employee_id' },
      week_start: { type: 'date', required: true },
      cost_rate: { type: 'decimal', required: true, scale: 2 },
      notes: { type: 'text' },
    },
    editable: ['notes', 'cost_rate'],
    editableIn: ['DRAFT', 'REJECTED'],
    numbering: { column: 'number', prefix: 'TS', dateField: 'week_start' },
    initialStatus: 'DRAFT',
    select: `t.*, e.employee_number, e.first_name || ' ' || e.last_name AS employee_name, (t.week_start + 6) AS week_end, u.name AS approved_by_name`,
    joins: 'JOIN employees e ON e.id = t.employee_id LEFT JOIN users u ON u.id = t.approved_by',
    search: ['number', 'e.first_name', 'e.last_name', 'e.employee_number'],
    filters: ['employee_id'],
    orderBy: 't.week_start DESC, e.employee_number',
    detail: async (q, row) => ({
      entries: (await q.query(`SELECT te.*, p.code AS project_code, p.name AS project_name FROM tim_entries te LEFT JOIN projects p ON p.id = te.project_id WHERE te.timesheet_id = $1 ORDER BY te.work_date, te.start_time`, [row.id])).rows,
    }),
    rowScope: ownScope,
    beforeCreate: async (ctx, v) => {
      await assertOwnEmployee(ctx, v.employee_id);
      if (dow(v.week_start) !== 1) throw validationError('week_start must be a Monday', { field: 'week_start' });
      const dup = await ctx.tx.query(`SELECT number FROM tim_timesheets WHERE organization_id = $1 AND employee_id = $2 AND week_start = $3`, [ctx.org, v.employee_id, v.week_start]);
      if (dup.rows[0]) throw new ApiError(409, ErrorCode.DUPLICATE_RESOURCE, `Timesheet ${dup.rows[0].number} already exists for that week`);
    },
    commands: {
      submit: {
        from: ['DRAFT', 'REJECTED'],
        to: 'SUBMITTED',
        permission: Permission.TIME_SUBMIT,
        run: async (ctx, row) => {
          const n = (await ctx.tx.query(`SELECT COUNT(*)::int n FROM tim_entries WHERE timesheet_id = $1`, [row.id])).rows[0].n;
          if (!n) throw new ApiError(409, ErrorCode.INVALID_STATE, 'Add at least one time entry before submitting');
          const t = await recompute(ctx.tx, ctx.org, row);
          return { set: { ...t, submitted_at: new Date().toISOString(), reject_reason: null } };
        },
      },
      approve: {
        from: ['SUBMITTED'],
        to: 'APPROVED',
        permission: Permission.TIME_APPROVE,
        sodColumn: 'created_by',
        run: async (ctx) => ({ set: { approved_by: ctx.user, approved_at: new Date().toISOString() } }),
      },
      reject: { from: ['SUBMITTED'], to: 'REJECTED', permission: Permission.TIME_APPROVE, fields: { reject_reason: { type: 'text', required: true } }, run: async (_c, _r, i) => ({ set: { reject_reason: i.reject_reason } }) },
      post: {
        from: ['APPROVED'],
        to: 'POSTED',
        permission: Permission.TIME_POST,
        fields: { posting_date: { type: 'date' } },
        run: async (ctx, row, i) => {
          const date = i.posting_date || addDays(toIsoDate(row.week_start), 6);
          const byProject = (
            await ctx.tx.query(`SELECT project_id, SUM(hours)::text AS hours FROM tim_entries WHERE timesheet_id = $1 GROUP BY project_id ORDER BY project_id NULLS LAST`, [row.id])
          ).rows;
          const total = new Money(row.cost_amount);
          if (!total.isPositive()) return { set: {}, data: { journal: null, note: 'Zero cost — nothing to post' } };
          // Allocate total cost by project hours; last line absorbs rounding so DR == CR exactly.
          const totalHours = byProject.reduce((a: Money, r: any) => a.add(r.hours), Money.zero());
          let allocated = Money.zero();
          const lines: any[] = byProject.map((r: any, idx: number) => {
            const amt = idx === byProject.length - 1 ? total.sub(allocated) : total.mul(r.hours).div(totalHours.toFixed(8)).round(2);
            allocated = allocated.add(amt);
            return { account_code: '511004', debit: amt.toFixed(8), project_id: r.project_id, description: `Labour ${row.number}` };
          });
          lines.push({ account_code: '211011', credit: total.toFixed(8), description: `Accrued labour ${row.number}` });
          const j = await postJournal(ctx.tx, auditLogger, outboxService, {
            organizationId: ctx.org, legalEntityId: ctx.le, userId: ctx.user, postingDate: date, purpose: AccountingPurpose.TIMESHEET_COST,
            description: `Timesheet labour cost ${row.number}`, sourceType: 'TIMESHEET', sourceId: row.id, sourceKey: `TIM:${row.id}`, numberPrefix: 'JV-TIM', correlationId: ctx.req.correlationId, lines,
          });
          return { set: { journal_id: j?.journalId ?? null }, data: j };
        },
      },
    },
  });

  app.post('/api/time/timesheets/:id/entries', authenticate, requireAnyPermission(Permission.TIME_SUBMIT), requireModule('TIM'), async (req: Request, res: Response) => {
    const out = await unitOfWork(req, async (ctx) => {
      const sheet = await loadRow(ctx.tx, 'tim_timesheets', req.params.id, ctx.org, 'Timesheet', true);
      await assertOwnEmployee(ctx, sheet.employee_id);
      if (!['DRAFT', 'REJECTED'].includes(sheet.status)) throw new ApiError(409, ErrorCode.INVALID_STATE, `Timesheet is ${sheet.status}; entries are locked`);
      const date = dateOnly(req.body?.work_date, 'work_date');
      const ws = toIsoDate(sheet.week_start);
      if (date < ws || date > addDays(ws, 6)) throw validationError(`work_date must fall in the week ${ws} – ${addDays(ws, 6)}`, { field: 'work_date' });
      const start = str(req.body?.start_time, 'start_time', { max: 5, pattern: TIME_RE });
      const end = str(req.body?.end_time, 'end_time', { max: 5, pattern: TIME_RE });
      if (minutesOf(end) <= minutesOf(start)) throw validationError('end_time must be after start_time (split overnight shifts at midnight)', { field: 'end_time' });
      const projectId = typeof req.body?.project_id === 'string' && req.body.project_id ? req.body.project_id : null;
      if (projectId) await assertOrgRef(ctx.tx, 'projects', projectId, ctx.org, 'project_id');
      // Serialise per employee so two concurrent adds cannot both pass the overlap check.
      await ctx.tx.query(`SELECT id FROM employees WHERE id = $1 FOR UPDATE`, [sheet.employee_id]);
      const clash = (
        await ctx.tx.query(
          `SELECT te.start_time, te.end_time, s.number FROM tim_entries te JOIN tim_timesheets s ON s.id = te.timesheet_id
           WHERE te.employee_id = $1 AND te.work_date = $2 AND te.start_time < $4::time AND te.end_time > $3::time AND s.status <> 'REJECTED' LIMIT 1`,
          [sheet.employee_id, date, start, end],
        )
      ).rows[0];
      if (clash) throw new ApiError(409, ErrorCode.OVERLAP_DETECTED, `Overlaps ${String(clash.start_time).slice(0, 5)}–${String(clash.end_time).slice(0, 5)} on ${clash.number}`, { field: 'start_time' });
      const leave = (await ctx.tx.query(`SELECT leave_type FROM tim_leave_requests WHERE employee_id = $1 AND status = 'APPROVED' AND $2::date BETWEEN start_date AND end_date`, [sheet.employee_id, date])).rows[0];
      if (leave) throw new ApiError(409, ErrorCode.OVERLAP_DETECTED, `Employee is on approved ${leave.leave_type} leave on ${date}`, { field: 'work_date' });
      const hours = new Money(minutesOf(end) - minutesOf(start)).div(60).round(2).toFixed(2);
      const row = (
        await ctx.tx.query(
          `INSERT INTO tim_entries (organization_id, timesheet_id, employee_id, work_date, start_time, end_time, hours, project_id, activity, billable, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [ctx.org, sheet.id, sheet.employee_id, date, start, end, hours, projectId, str(req.body?.activity, 'activity', { max: 255 }), bool(req.body?.billable), ctx.user],
        )
      ).rows[0];
      const totals = await recompute(ctx.tx, ctx.org, sheet);
      await audit(ctx, 'TIME_ENTRY_ADDED', 'TIME_SHEET', sheet.id, undefined, { date, start, end, hours });
      return { ...row, totals };
    });
    return ok(req, res, out, 201);
  });

  app.post('/api/time/entries/:id/delete', authenticate, requireAnyPermission(Permission.TIME_SUBMIT), requireModule('TIM'), async (req: Request, res: Response) => {
    const out = await unitOfWork(req, async (ctx) => {
      const e = (await ctx.tx.query(`SELECT * FROM tim_entries WHERE id::text = $1 AND organization_id = $2`, [req.params.id, ctx.org])).rows[0];
      if (!e) throw notFound('Time entry');
      const sheet = await loadRow(ctx.tx, 'tim_timesheets', e.timesheet_id, ctx.org, 'Timesheet', true);
      await assertOwnEmployee(ctx, sheet.employee_id);
      if (!['DRAFT', 'REJECTED'].includes(sheet.status)) throw new ApiError(409, ErrorCode.INVALID_STATE, `Timesheet is ${sheet.status}; entries are locked`);
      await ctx.tx.query(`DELETE FROM tim_entries WHERE id = $1`, [e.id]);
      await audit(ctx, 'TIME_ENTRY_REMOVED', 'TIME_SHEET', sheet.id, { date: toIsoDate(e.work_date), hours: e.hours }, undefined);
      return recompute(ctx.tx, ctx.org, sheet);
    });
    return ok(req, res, out);
  });

  defineResource(app, {
    path: '/api/time/leave',
    table: 'tim_leave_requests',
    label: 'Leave request',
    event: 'TIME_LEAVE',
    module: 'TIM',
    view: VIEW,
    create: Permission.TIME_SUBMIT,
    update: Permission.TIME_SUBMIT,
    fields: {
      employee_id: { type: 'ref', table: 'employees', required: true, label: 'employee_id' },
      leave_type: { type: 'enum', values: ['ANNUAL', 'SICK', 'CASUAL', 'UNPAID', 'MATERNITY', 'PATERNITY', 'HAJJ'], required: true },
      start_date: { type: 'date', required: true },
      end_date: { type: 'date', required: true },
      reason: { type: 'text' },
    },
    editable: ['reason'],
    editableIn: ['REQUESTED'],
    initialStatus: 'REQUESTED',
    select: `t.*, e.employee_number, e.first_name || ' ' || e.last_name AS employee_name`,
    joins: 'JOIN employees e ON e.id = t.employee_id',
    search: ['e.first_name', 'e.last_name', 'e.employee_number'],
    filters: ['employee_id', 'leave_type'],
    orderBy: 't.start_date DESC',
    rowScope: ownScope,
    beforeCreate: async (ctx, v) => {
      await assertOwnEmployee(ctx, v.employee_id);
      if (v.end_date < v.start_date) throw validationError('end_date must be on or after start_date', { field: 'end_date' });
      await ctx.tx.query(`SELECT id FROM employees WHERE id = $1 FOR UPDATE`, [v.employee_id]);
      const ov = (await ctx.tx.query(`SELECT start_date, end_date, status FROM tim_leave_requests WHERE employee_id = $1 AND status IN ('REQUESTED','APPROVED') AND start_date <= $3 AND end_date >= $2 LIMIT 1`, [v.employee_id, v.start_date, v.end_date])).rows[0];
      if (ov) throw new ApiError(409, ErrorCode.OVERLAP_DETECTED, `Overlaps ${ov.status.toLowerCase()} leave ${toIsoDate(ov.start_date)} – ${toIsoDate(ov.end_date)}`, { field: 'start_date' });
      const logged = (await ctx.tx.query(`SELECT COUNT(*)::int n FROM tim_entries te JOIN tim_timesheets s ON s.id = te.timesheet_id WHERE te.employee_id = $1 AND te.work_date BETWEEN $2 AND $3 AND s.status <> 'REJECTED'`, [v.employee_id, v.start_date, v.end_date])).rows[0].n;
      if (logged) throw new ApiError(409, ErrorCode.OVERLAP_DETECTED, `${logged} time entr${logged === 1 ? 'y is' : 'ies are'} already logged in that window`, { field: 'start_date' });
      const days = leaveDays(v.start_date, v.end_date);
      if (!days) throw validationError('The window contains no working days', { field: 'start_date' });
      v.days = days;
    },
    commands: {
      approve: { from: ['REQUESTED'], to: 'APPROVED', permission: Permission.TIME_APPROVE, sodColumn: 'created_by', fields: { decision_note: { type: 'text' } }, run: async (ctx, _r, i) => ({ set: { decided_by: ctx.user, decision_note: i.decision_note } }) },
      reject: { from: ['REQUESTED'], to: 'REJECTED', permission: Permission.TIME_APPROVE, fields: { decision_note: { type: 'text', required: true } }, run: async (ctx, _r, i) => ({ set: { decided_by: ctx.user, decision_note: i.decision_note } }) },
      cancel: { from: ['REQUESTED', 'APPROVED'], to: 'CANCELLED', permission: Permission.TIME_SUBMIT },
    },
  });

  app.get('/api/time/summary', authenticate, requireAnyPermission(...VIEW), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const s = (
      await db.query(
        `SELECT COUNT(*) FILTER (WHERE status='SUBMITTED')::int awaiting_approval, COUNT(*) FILTER (WHERE status='APPROVED')::int awaiting_posting,
          COALESCE(SUM(total_hours) FILTER (WHERE week_start >= date_trunc('month', NOW())::date),0)::text hours_mtd,
          COALESCE(SUM(overtime_hours) FILTER (WHERE week_start >= date_trunc('month', NOW())::date),0)::text overtime_mtd,
          COALESCE(SUM(cost_amount) FILTER (WHERE status='POSTED'),0)::text posted_cost
         FROM tim_timesheets WHERE organization_id = $1`,
        [org],
      )
    ).rows[0];
    const leave = (await db.query(`SELECT COUNT(*) FILTER (WHERE status='REQUESTED')::int pending, COUNT(*) FILTER (WHERE status='APPROVED' AND CURRENT_DATE BETWEEN start_date AND end_date)::int on_leave_today FROM tim_leave_requests WHERE organization_id = $1`, [org])).rows[0];
    return ok(req, res, { ...s, leave });
  });
}
