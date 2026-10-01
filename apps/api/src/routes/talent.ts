/**
 * TAL — recruitment. Requisitions need approval (submitter ≠ approver) before candidates can
 * apply. Applications move APPLIED → SCREENING → INTERVIEW → OFFER → HIRED. An offer needs at least
 * one HIRE recommendation and no NO_HIRE from a FINAL round; salary outside the band needs a note.
 * Hiring creates the employee record (so Time & Attendance can use it immediately), fills a seat,
 * and refuses to exceed the requisition's positions (CAPACITY_CONFLICT).
 */
import type { Express, Request, Response } from 'express';
import { Permission, ErrorCode } from '@omnysync/contracts';
import { Money } from '@omnysync/financial-engine';
import { db, authenticate, requireAnyPermission } from '../context.js';
import { ok } from '../lib/http.js';
import { ApiError, validationError } from '../lib/errors.js';
import { defineResource, loadRow, unitOfWork, audit, emit } from '../lib/resource.js';
import { requireModule } from '../lib/modules.js';
import { dateOnly, int, todayIso, toIsoDate } from '../lib/validate.js';

const VIEW = [Permission.TALENT_VIEW, Permission.TALENT_MANAGE];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: '-' };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

export function registerTalentRoutes(app: Express): void {
  defineResource(app, {
    path: '/api/tal/requisitions',
    table: 'tal_requisitions',
    label: 'Requisition',
    event: 'TALENT_REQUISITION',
    module: 'TAL',
    view: VIEW,
    create: Permission.TALENT_MANAGE,
    update: Permission.TALENT_MANAGE,
    fields: {
      title: { type: 'string', required: true },
      department: { type: 'string', max: 120 },
      location: { type: 'string', max: 120 },
      employment_type: { type: 'enum', values: ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'], default: 'FULL_TIME' },
      positions: { type: 'int', min: 1, max: 100, default: 1 },
      salary_min: { type: 'decimal', required: true, sign: 'positive', scale: 2 },
      salary_max: { type: 'decimal', required: true, sign: 'positive', scale: 2 },
      target_date: { type: 'date' },
      justification: { type: 'text' },
    },
    editable: ['title', 'department', 'location', 'positions', 'salary_min', 'salary_max', 'target_date', 'justification'],
    editableIn: ['DRAFT', 'OPEN', 'ON_HOLD'],
    numbering: { column: 'number', prefix: 'REQ' },
    initialStatus: 'DRAFT',
    select: `t.*, (SELECT COUNT(*)::int FROM tal_applications a WHERE a.requisition_id = t.id AND a.status NOT IN ('REJECTED','WITHDRAWN','HIRED')) AS active_applicants`,
    search: ['number', 'title', 'department'],
    beforeCreate: async (_c, v) => {
      if (new Money(v.salary_max).lt(v.salary_min)) throw validationError('salary_max must be ≥ salary_min', { field: 'salary_max' });
    },
    beforeUpdate: async (_c, row, v) => {
      const min = v.salary_min ?? row.salary_min;
      const max = v.salary_max ?? row.salary_max;
      if (new Money(max).lt(min)) throw validationError('salary_max must be ≥ salary_min', { field: 'salary_max' });
      if (v.positions !== undefined && v.positions < row.filled) throw validationError(`positions cannot drop below the ${row.filled} already filled`, { field: 'positions' });
    },
    detail: async (q, row) => ({
      applications: (await q.query(`SELECT a.id, a.status, a.applied_on, c.full_name, c.email, (SELECT ROUND(AVG(score),1) FROM tal_interviews i WHERE i.application_id = a.id) AS avg_score FROM tal_applications a JOIN tal_candidates c ON c.id = a.candidate_id WHERE a.requisition_id = $1 ORDER BY a.created_at`, [row.id])).rows,
    }),
    commands: {
      submit: { from: ['DRAFT'], to: 'SUBMITTED', permission: Permission.TALENT_MANAGE, run: async (ctx) => ({ set: { submitted_by: ctx.user } }) },
      approve: { from: ['SUBMITTED'], to: 'OPEN', permission: Permission.TALENT_MANAGE, sodColumn: 'submitted_by', run: async (ctx) => ({ set: { approved_by: ctx.user } }) },
      hold: { from: ['OPEN'], to: 'ON_HOLD', permission: Permission.TALENT_MANAGE, fields: { hold_reason: { type: 'text', required: true } }, run: async (_c, _r, i) => ({ set: { hold_reason: i.hold_reason } }) },
      reopen: { from: ['ON_HOLD'], to: 'OPEN', permission: Permission.TALENT_MANAGE },
      cancel: {
        from: ['DRAFT', 'SUBMITTED', 'OPEN', 'ON_HOLD'],
        to: 'CANCELLED',
        permission: Permission.TALENT_MANAGE,
        fields: { hold_reason: { type: 'text', required: true } },
        run: async (ctx, row, i) => {
          await ctx.tx.query(`UPDATE tal_applications SET status = 'REJECTED', rejection_reason = 'Requisition cancelled', updated_at = NOW() WHERE requisition_id = $1 AND status IN ('APPLIED','SCREENING','INTERVIEW','OFFER')`, [row.id]);
          return { set: { hold_reason: i.hold_reason } };
        },
      },
    },
  });

  defineResource(app, {
    path: '/api/tal/candidates',
    table: 'tal_candidates',
    label: 'Candidate',
    event: 'TALENT_CANDIDATE',
    module: 'TAL',
    view: VIEW,
    create: Permission.TALENT_MANAGE,
    update: Permission.TALENT_MANAGE,
    fields: {
      full_name: { type: 'string', required: true, max: 200 },
      email: { type: 'string', required: true, max: 255, pattern: EMAIL },
      phone: { type: 'string', max: 50 },
      source: { type: 'enum', values: ['REFERRAL', 'JOB_BOARD', 'WALK_IN', 'AGENCY', 'LINKEDIN', 'CAMPUS'], default: 'JOB_BOARD' },
      skills: { type: 'text' },
      years_experience: { type: 'decimal', sign: 'nonNegative', scale: 1 },
      current_city: { type: 'string', max: 120 },
    },
    editable: ['full_name', 'phone', 'skills', 'years_experience', 'current_city'],
    initialStatus: 'ACTIVE',
    select: `t.*, (SELECT COUNT(*)::int FROM tal_applications a WHERE a.candidate_id = t.id) AS applications`,
    search: ['full_name', 'email', 'skills'],
    filters: ['source'],
    beforeCreate: async (ctx, v) => {
      v.email = String(v.email).toLowerCase();
      const d = await ctx.tx.query(`SELECT 1 FROM tal_candidates WHERE organization_id = $1 AND LOWER(email) = $2`, [ctx.org, v.email]);
      if (d.rows.length) throw new ApiError(409, ErrorCode.DUPLICATE_RESOURCE, `A candidate with ${v.email} already exists`);
    },
    detail: async (q, row) => ({
      // Separate key: `applications` is the list count column (it rendered as [object Object] in the drawer).
      application_history: (await q.query(`SELECT a.id, a.status, r.number, r.title FROM tal_applications a JOIN tal_requisitions r ON r.id = a.requisition_id WHERE a.candidate_id = $1 ORDER BY a.created_at DESC`, [row.id])).rows,
      // CVs and certificates are DOC documents linked to the candidate (type/size/magic-byte checked, versioned, hashed).
      documents: (
        await q.query(
          `SELECT d.id, d.number, d.title, d.category, d.status, d.current_version, v.filename, v.size_bytes FROM doc_documents d LEFT JOIN doc_versions v ON v.document_id = d.id AND v.version_no = d.current_version
           WHERE d.organization_id = $1 AND d.entity_type = 'CANDIDATE' AND d.entity_id::text = $2 AND d.status <> 'DELETED' ORDER BY d.created_at DESC`,
          [row.organization_id, row.id],
        )
      ).rows,
    }),
    commands: { archive: { from: ['ACTIVE'], to: 'ARCHIVED', permission: Permission.TALENT_MANAGE }, restore: { from: ['ARCHIVED'], to: 'ACTIVE', permission: Permission.TALENT_MANAGE } },
  });

  defineResource(app, {
    path: '/api/tal/applications',
    table: 'tal_applications',
    label: 'Application',
    event: 'TALENT_APPLICATION',
    module: 'TAL',
    view: VIEW,
    create: Permission.TALENT_MANAGE,
    update: false,
    fields: {
      requisition_id: { type: 'ref', table: 'tal_requisitions', required: true, label: 'requisition_id' },
      candidate_id: { type: 'ref', table: 'tal_candidates', required: true, label: 'candidate_id' },
      applied_on: { type: 'date', defaultToday: true },
    },
    initialStatus: 'APPLIED',
    select: `t.*, c.full_name, c.email, c.source, r.number AS requisition_number, r.title AS requisition_title, r.salary_min, r.salary_max,
      (SELECT ROUND(AVG(score),1) FROM tal_interviews i WHERE i.application_id = t.id) AS avg_score,
      (SELECT COUNT(*)::int FROM tal_interviews i WHERE i.application_id = t.id) AS interviews`,
    joins: 'JOIN tal_candidates c ON c.id = t.candidate_id JOIN tal_requisitions r ON r.id = t.requisition_id',
    search: ['c.full_name', 'c.email', 'r.title'],
    filters: ['requisition_id', 'candidate_id'],
    beforeCreate: async (ctx, v) => {
      const r = await loadRow(ctx.tx, 'tal_requisitions', v.requisition_id, ctx.org, 'Requisition');
      if (r.status !== 'OPEN') throw new ApiError(409, ErrorCode.INVALID_STATE, `Requisition ${r.number} is not open for applications`);
      const c = await loadRow(ctx.tx, 'tal_candidates', v.candidate_id, ctx.org, 'Candidate');
      if (c.status !== 'ACTIVE') throw new ApiError(409, ErrorCode.INVALID_STATE, 'Candidate is archived');
      const d = await ctx.tx.query(`SELECT 1 FROM tal_applications WHERE requisition_id = $1 AND candidate_id = $2`, [v.requisition_id, v.candidate_id]);
      if (d.rows.length) throw new ApiError(409, ErrorCode.DUPLICATE_RESOURCE, 'Candidate already applied to this requisition');
    },
    detail: async (q, row) => ({ interviews: (await q.query(`SELECT * FROM tal_interviews WHERE application_id = $1 ORDER BY interview_date DESC, created_at DESC`, [row.id])).rows }),
    commands: {
      screen: { from: ['APPLIED'], to: 'SCREENING', permission: Permission.TALENT_MANAGE },
      shortlist: { from: ['SCREENING'], to: 'INTERVIEW', permission: Permission.TALENT_MANAGE },
      offer: {
        from: ['INTERVIEW'],
        to: 'OFFER',
        permission: Permission.TALENT_MANAGE,
        fields: { offered_salary: { type: 'decimal', required: true, sign: 'positive', scale: 2 }, offer_start_date: { type: 'date', required: true }, offer_note: { type: 'text' } },
        run: async (ctx, row, i) => {
          const iv = (await ctx.tx.query(`SELECT recommendation, round FROM tal_interviews WHERE application_id = $1`, [row.id])).rows;
          if (!iv.some((x: any) => x.recommendation === 'HIRE')) throw new ApiError(409, ErrorCode.INVALID_STATE, 'An offer needs at least one HIRE recommendation from an interview');
          if (iv.some((x: any) => x.round === 'FINAL' && x.recommendation === 'NO_HIRE')) throw new ApiError(409, ErrorCode.INVALID_STATE, 'Final-round interviewer recommended NO_HIRE');
          const r = await loadRow(ctx.tx, 'tal_requisitions', row.requisition_id, ctx.org, 'Requisition');
          if (r.status !== 'OPEN') throw new ApiError(409, ErrorCode.INVALID_STATE, `Requisition ${r.number} is ${r.status.toLowerCase()}`);
          const s = new Money(String(i.offered_salary));
          if ((s.lt(r.salary_min) || s.gt(r.salary_max)) && !i.offer_note) throw validationError(`Offer is outside the band ${new Money(r.salary_min).toFixed(0)}–${new Money(r.salary_max).toFixed(0)}; add an offer note justifying it`, { field: 'offer_note' });
          if (String(i.offer_start_date) < todayIso()) throw validationError('offer_start_date cannot be in the past', { field: 'offer_start_date' });
          return { set: { offered_salary: i.offered_salary, offer_start_date: i.offer_start_date, offer_note: i.offer_note ?? null } };
        },
      },
      hire: {
        from: ['OFFER'],
        to: 'HIRED',
        permission: Permission.TALENT_MANAGE,
        run: async (ctx, row) => {
          const r = await loadRow(ctx.tx, 'tal_requisitions', row.requisition_id, ctx.org, 'Requisition', true);
          if (r.filled >= r.positions) throw new ApiError(409, ErrorCode.CAPACITY_CONFLICT, `All ${r.positions} position(s) on ${r.number} are already filled`);
          const c = await loadRow(ctx.tx, 'tal_candidates', row.candidate_id, ctx.org, 'Candidate');
          const n = (await ctx.tx.query(`SELECT COALESCE(MAX(NULLIF(regexp_replace(employee_number, '\\D', '', 'g'), '')::int), 100) + 1 AS n FROM employees WHERE legal_entity_id = $1 AND employee_number LIKE 'EMP-%'`, [ctx.le])).rows[0].n;
          const { first, last } = splitName(c.full_name);
          const emp = await ctx.tx.query(
            `INSERT INTO employees (id, organization_id, legal_entity_id, employee_number, first_name, last_name, email, phone, employment_type, joining_date, status) VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,'ACTIVE') RETURNING id, employee_number`,
            [ctx.org, ctx.le, `EMP-${n}`, first, last, c.email, c.phone, r.employment_type, toIsoDate(row.offer_start_date)],
          );
          const filled = r.filled + 1;
          await ctx.tx.query(`UPDATE tal_requisitions SET filled = $2, status = $3, revision = revision + 1, updated_at = NOW() WHERE id = $1`, [r.id, filled, filled >= r.positions ? 'FILLED' : r.status]);
          await emit(ctx, 'TALENT_HIRED', { application_id: row.id, employee_id: emp.rows[0].id, requisition_id: r.id });
          return { set: { employee_id: emp.rows[0].id }, data: { employee_number: emp.rows[0].employee_number, requisition_status: filled >= r.positions ? 'FILLED' : r.status } };
        },
      },
      reject: { from: ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER'], to: 'REJECTED', permission: Permission.TALENT_MANAGE, fields: { rejection_reason: { type: 'text', required: true } }, run: async (_c, _r, i) => ({ set: { rejection_reason: i.rejection_reason } }) },
      withdraw: { from: ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER'], to: 'WITHDRAWN', permission: Permission.TALENT_MANAGE },
    },
  });

  app.post('/api/tal/applications/:id/interviews', authenticate, requireAnyPermission(Permission.TALENT_MANAGE), requireModule('TAL', 'command'), async (req: Request, res: Response) => {
    const b = req.body || {};
    const date = b.interview_date ? dateOnly(b.interview_date, 'interview_date') : todayIso();
    const interviewer = String(b.interviewer ?? '').trim();
    if (!interviewer) throw validationError('interviewer is required', { field: 'interviewer' });
    const score = int(b.score, 'score', { min: 1, max: 5 });
    if (!['HIRE', 'MAYBE', 'NO_HIRE'].includes(b.recommendation)) throw validationError('recommendation must be HIRE, MAYBE or NO_HIRE', { field: 'recommendation' });
    const round = b.round ?? 'TECHNICAL';
    if (!['PHONE', 'TECHNICAL', 'PRACTICAL', 'HR', 'FINAL'].includes(round)) throw validationError('invalid round', { field: 'round' });
    if (b.recommendation === 'HIRE' && score < 3) throw validationError('A HIRE recommendation needs a score of at least 3', { field: 'score' });
    const out = await unitOfWork(req, async (ctx) => {
      const a = await loadRow(ctx.tx, 'tal_applications', req.params.id, ctx.org, 'Application', true);
      if (a.status !== 'INTERVIEW') throw new ApiError(409, ErrorCode.INVALID_STATE, 'Shortlist the application for interview first');
      const r = await ctx.tx.query(`INSERT INTO tal_interviews (organization_id, application_id, interview_date, interviewer, round, score, recommendation, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [ctx.org, a.id, date, interviewer, round, score, b.recommendation, b.notes ?? null, ctx.user]);
      await audit(ctx, 'INTERVIEW', 'TALENT_APPLICATION', a.id, undefined, { score, recommendation: b.recommendation });
      return r.rows[0];
    });
    return ok(req, res, out, 201);
  });

  app.get('/api/tal/summary', authenticate, requireAnyPermission(...VIEW), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const r = (await db.query(`SELECT COUNT(*) FILTER (WHERE status='OPEN')::int open_reqs, COALESCE(SUM(positions - filled) FILTER (WHERE status='OPEN'),0)::int open_positions FROM tal_requisitions WHERE organization_id = $1`, [org])).rows[0];
    const a = (await db.query(`SELECT status, COUNT(*)::int n FROM tal_applications WHERE organization_id = $1 GROUP BY status`, [org])).rows;
    const by = Object.fromEntries(a.map((x: any) => [x.status, x.n]));
    const t = (await db.query(`SELECT ROUND(AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 86400))::int days FROM tal_applications WHERE organization_id = $1 AND status = 'HIRED'`, [org])).rows[0];
    return ok(req, res, { ...r, pipeline: (by.APPLIED || 0) + (by.SCREENING || 0) + (by.INTERVIEW || 0), offers: by.OFFER || 0, hired: by.HIRED || 0, by_stage: by, avg_days_to_hire: t.days });
  });
}
