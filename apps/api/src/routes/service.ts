/**
 * SRV — service & field operations for HVAC / home services.
 * Intake → triage → schedule (dispatch) → execute → accept → bill → close.
 */
import crypto from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { Permission, ErrorCode, AccountingPurpose } from '@omnysync/contracts';
import { Money } from '@omnysync/financial-engine';
import { db, authenticate, requireAnyPermission, auditLogger, outboxService } from '../context.js';
import { ok } from '../lib/http.js';
import { ApiError, notFound, validationError } from '../lib/errors.js';
import { audit, defineResource, emit, loadRow, unitOfWork, type Ctx } from '../lib/resource.js';
import { bool, decimal, str, todayIso, toIsoDate } from '../lib/validate.js';
import { requireModule } from '../lib/modules.js';
import { postStockMovement, lockItems, defaultWarehouseId } from '../lib/stock.js';
import { postJournal } from '../lib/posting.js';
import { createPostedSourceInvoice } from '../lib/ar-invoice.js';
import { getSetting } from './config.js';
import { addBusinessMinutes, businessMinutesBetween, overlaps, slaState, type BusinessHours } from '../domain/sla.js';

const VIEW = [Permission.SERVICE_VIEW, Permission.SERVICE_MANAGE, Permission.SERVICE_EXECUTE];
const PRIORITY_FACTOR: Record<string, number> = { CRITICAL: 0.25, HIGH: 0.5, MEDIUM: 1, LOW: 2 };
const DEFAULT_RESPONSE_H: Record<string, number> = { CRITICAL: 2, HIGH: 4, MEDIUM: 8, LOW: 24 };

async function businessHours(q: any, org: string): Promise<BusinessHours> {
  const h = await getSetting<any>(q, org, 'service.business_hours');
  return { start: h.start, end: h.end, days: h.days, holidays: Array.isArray(h.holidays) ? h.holidays : [], offsetMinutes: 300 };
}

/** Entitlement check (SRV-004): contract must be ACTIVE, belong to the party and cover the date. */
export function assertEntitlement(contract: any, partyId: string, onDate: string) {
  if (!contract) return;
  if (contract.party_id !== partyId) throw new ApiError(400, ErrorCode.ENTITLEMENT_INVALID, 'Contract belongs to a different customer', { field: 'contract_id' });
  if (contract.status !== 'ACTIVE') throw new ApiError(409, ErrorCode.ENTITLEMENT_INVALID, `Contract ${contract.number} is ${contract.status}`, { field: 'contract_id' });
  if (onDate < toIsoDate(contract.start_date) || onDate > toIsoDate(contract.end_date)) {
    throw new ApiError(409, ErrorCode.ENTITLEMENT_INVALID, `Contract ${contract.number} does not cover ${onDate} (valid ${toIsoDate(contract.start_date)} – ${toIsoDate(contract.end_date)})`, { field: 'contract_id' });
  }
}

async function computeDue(q: any, org: string, priority: string, contract: any, from: Date) {
  const h = await businessHours(q, org);
  const respH = contract ? Math.min(contract.response_hours, DEFAULT_RESPONSE_H[priority] ?? 8) : DEFAULT_RESPONSE_H[priority] ?? 8;
  const resH = contract ? contract.resolution_hours : Math.ceil(24 * (PRIORITY_FACTOR[priority] ?? 1) * 2);
  return { response_due_at: addBusinessMinutes(from, respH * 60, h).toISOString(), resolution_due_at: addBusinessMinutes(from, resH * 60, h).toISOString() };
}

/** Deterministic hash binding a customer sign-off to the exact work performed (SRV-011). */
export function signoffHash(wo: any, parts: any[], time: any[], extras: any[]) {
  const canon = JSON.stringify({
    wo: wo.id,
    checklist: (typeof wo.checklist === 'string' ? JSON.parse(wo.checklist) : wo.checklist) || [],
    parts: parts.map((p) => [p.item_id, new Money(p.quantity).toFixed(4)]).sort(),
    time: time.filter((t) => t.status !== 'REJECTED').map((t) => [new Date(t.start_at).toISOString(), new Date(t.end_at).toISOString()]).sort(),
    extras: extras.filter((e) => e.status === 'ACCEPTED').map((e) => [e.description, new Money(e.amount).toFixed(2)]).sort(),
  });
  return crypto.createHash('sha256').update(canon).digest('hex');
}

async function woChildren(q: any, woId: string) {
  const [parts, time, extras] = await Promise.all([
    q.query(`SELECT p.*, i.code AS item_code, i.name AS item_name FROM srv_work_order_parts p JOIN items i ON i.id = p.item_id WHERE p.work_order_id = $1 ORDER BY p.created_at`, [woId]),
    q.query(`SELECT te.*, t.name AS technician_name FROM srv_time_entries te JOIN srv_technicians t ON t.id = te.technician_id WHERE te.work_order_id = $1 ORDER BY te.start_at`, [woId]),
    q.query(`SELECT * FROM srv_extra_work WHERE work_order_id = $1 ORDER BY created_at`, [woId]),
  ]);
  return { parts: parts.rows, time: time.rows, extras: extras.rows };
}

async function assertMember(ctx: Ctx, userId: string, field: string) {
  const r = await ctx.tx.query(`SELECT 1 FROM memberships WHERE organization_id = $1 AND user_id::text = $2`, [ctx.org, userId]);
  if (!r.rows.length) throw validationError(`${field} is not a user of this organization`, { field });
}

/** Technicians may only act on their own work orders (field scope). */
async function assertTechScope(ctx: Ctx, wo: any) {
  const s = ctx.req.session!;
  if (s.permissions.includes(Permission.SERVICE_MANAGE)) return;
  const t = (await ctx.tx.query(`SELECT id FROM srv_technicians WHERE organization_id = $1 AND user_id = $2`, [ctx.org, ctx.user])).rows[0];
  if (!t || t.id !== wo.technician_id) throw new ApiError(403, ErrorCode.FORBIDDEN_SCOPE, 'This work order is not assigned to you');
}

export function registerServiceRoutes(app: Express): void {
  defineResource(app, {
    path: '/api/srv/technicians',
    table: 'srv_technicians',
    label: 'Technician',
    event: 'SERVICE_TECHNICIAN',
    module: 'SRV',
    view: VIEW,
    create: Permission.SERVICE_MANAGE,
    update: Permission.SERVICE_MANAGE,
    fields: {
      code: { type: 'string', required: true, max: 32, pattern: /^[A-Z0-9-]+$/ },
      name: { type: 'string', required: true },
      user_id: { type: 'string', max: 64 },
      skills: { type: 'string', max: 500 },
      zone: { type: 'string', max: 64 },
      phone: { type: 'string', max: 40 },
      hourly_cost: { type: 'decimal', default: '0' },
    },
    editable: ['name', 'skills', 'zone', 'phone', 'hourly_cost'],
    initialStatus: 'ACTIVE',
    beforeCreate: async (ctx, v) => {
      if (v.user_id) await assertMember(ctx, v.user_id, 'user_id');
    },
    search: ['code', 'name', 'skills', 'zone'],
    orderBy: 't.code',
    commands: { deactivate: { from: ['ACTIVE'], to: 'INACTIVE', permission: Permission.SERVICE_MANAGE }, activate: { from: ['INACTIVE'], to: 'ACTIVE', permission: Permission.SERVICE_MANAGE } },
  });

  defineResource(app, {
    path: '/api/srv/contracts',
    table: 'srv_contracts',
    label: 'Service contract',
    event: 'SERVICE_CONTRACT',
    module: 'SRV',
    view: VIEW,
    create: Permission.SERVICE_MANAGE,
    update: Permission.SERVICE_MANAGE,
    fields: {
      party_id: { type: 'ref', table: 'parties', required: true, label: 'party_id' },
      contract_type: { type: 'enum', values: ['WARRANTY', 'AMC', 'SLA_ONLY'], required: true },
      title: { type: 'string', required: true },
      site_address: { type: 'text' },
      equipment: { type: 'text' },
      start_date: { type: 'date', required: true },
      end_date: { type: 'date', required: true },
      response_hours: { type: 'int', min: 1, max: 720, default: 4 },
      resolution_hours: { type: 'int', min: 1, max: 2160, default: 24 },
      covers_labour: { type: 'bool' },
      covers_parts: { type: 'bool' },
      visits_included: { type: 'int', min: 0, max: 365, default: 0 },
      pm_interval_months: { type: 'int', min: 1, max: 24 },
      next_pm_date: { type: 'date' },
      contract_value: { type: 'decimal', default: '0' },
    },
    editable: ['title', 'site_address', 'equipment', 'end_date', 'response_hours', 'resolution_hours', 'pm_interval_months', 'next_pm_date'],
    editableIn: ['DRAFT', 'ACTIVE'],
    numbering: { column: 'number', prefix: 'SVC', dateField: 'start_date' },
    initialStatus: 'DRAFT',
    select: 't.*, p.name AS party_name',
    joins: 'JOIN parties p ON p.id = t.party_id',
    search: ['number', 'title', 'p.name'],
    filters: ['contract_type', 'party_id'],
    beforeCreate: async (_ctx, v) => {
      if (v.end_date < v.start_date) throw validationError('end_date must be on or after start_date', { field: 'end_date' });
      if (v.pm_interval_months && !v.next_pm_date) v.next_pm_date = v.start_date;
    },
    commands: {
      activate: { from: ['DRAFT'], to: 'ACTIVE', permission: Permission.SERVICE_MANAGE },
      expire: { from: ['ACTIVE'], to: 'EXPIRED', permission: Permission.SERVICE_MANAGE },
      cancel: { from: ['DRAFT', 'ACTIVE'], to: 'CANCELLED', permission: Permission.SERVICE_MANAGE },
    },
  });

  // ---------- Cases ----------
  defineResource(app, {
    path: '/api/srv/cases',
    table: 'srv_cases',
    label: 'Service case',
    event: 'SERVICE_CASE',
    module: 'SRV',
    view: VIEW,
    create: Permission.SERVICE_MANAGE,
    update: Permission.SERVICE_MANAGE,
    fields: {
      party_id: { type: 'ref', table: 'parties', required: true, label: 'party_id' },
      contract_id: { type: 'ref', table: 'srv_contracts', label: 'contract_id' },
      channel: { type: 'enum', values: ['PHONE', 'EMAIL', 'WHATSAPP', 'PORTAL', 'WALK_IN'], default: 'PHONE' },
      external_ref: { type: 'string', max: 120 },
      title: { type: 'string', required: true },
      description: { type: 'text' },
      category: { type: 'enum', values: ['REPAIR', 'INSTALLATION', 'MAINTENANCE', 'INSPECTION', 'COMPLAINT', 'OTHER'], default: 'REPAIR' },
      priority: { type: 'enum', values: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], default: 'MEDIUM' },
      site_address: { type: 'text' },
    },
    editable: ['title', 'description', 'site_address', 'category'],
    editableIn: ['NEW', 'TRIAGED', 'SCHEDULED', 'IN_PROGRESS', 'ON_HOLD'],
    numbering: { column: 'number', prefix: 'SRV' },
    initialStatus: 'NEW',
    select: `t.*, p.name AS party_name, c.number AS contract_number, c.contract_type,
      (SELECT COUNT(*)::int FROM srv_work_orders w WHERE w.case_id = t.id AND w.status <> 'CANCELLED') AS work_order_count`,
    joins: 'JOIN parties p ON p.id = t.party_id LEFT JOIN srv_contracts c ON c.id = t.contract_id',
    search: ['number', 'title', 'p.name', 'site_address'],
    filters: ['priority', 'party_id', 'category'],
    orderBy: `CASE t.priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END, t.created_at DESC`,
    detail: async (q, row) => {
      const h = await businessHours(q, row.organization_id);
      const now = new Date();
      const res = row.resolution_due_at ? slaState({ start: new Date(row.created_at), due: new Date(new Date(row.resolution_due_at).getTime() + row.paused_minutes * 60000), now, doneAt: row.resolved_at ? new Date(row.resolved_at) : null, paused: !!row.paused_at }) : null;
      const resp = row.response_due_at ? slaState({ start: new Date(row.created_at), due: new Date(row.response_due_at), now, doneAt: row.first_response_at ? new Date(row.first_response_at) : null }) : null;
      const wos = await q.query(`SELECT w.*, t.name AS technician_name FROM srv_work_orders w LEFT JOIN srv_technicians t ON t.id = w.technician_id WHERE w.case_id = $1 ORDER BY w.created_at`, [row.id]);
      return { response_sla: resp, resolution_sla: res, business_minutes_open: businessMinutesBetween(new Date(row.created_at), row.resolved_at ? new Date(row.resolved_at) : now, h), work_orders: wos.rows };
    },
    beforeCreate: async (ctx, v) => {
      // SRV-001 retry dedupe: same channel + external reference returns the existing case.
      if (v.external_ref) {
        const ex = await ctx.tx.query(`SELECT id, number FROM srv_cases WHERE organization_id = $1 AND channel = $2 AND external_ref = $3`, [ctx.org, v.channel, v.external_ref]);
        if (ex.rows[0]) throw new ApiError(409, ErrorCode.DUPLICATE_RESOURCE, `Request already logged as ${ex.rows[0].number}`, { existing_id: ex.rows[0].id, existing_number: ex.rows[0].number });
      }
      let contract = null;
      if (v.contract_id) {
        contract = await loadRow(ctx.tx, 'srv_contracts', v.contract_id, ctx.org, 'Contract');
        assertEntitlement(contract, v.party_id, todayIso());
      }
      Object.assign(v, await computeDue(ctx.tx, ctx.org, v.priority || 'MEDIUM', contract, new Date()));
    },
    commands: {
      triage: {
        from: ['NEW', 'TRIAGED'],
        to: 'TRIAGED',
        permission: Permission.SERVICE_MANAGE,
        fields: { priority: { type: 'enum', values: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], required: true }, owner_user_id: { type: 'string', max: 64 }, triage_reason: { type: 'text', required: true } },
        run: async (ctx, row, input) => {
          if (input.owner_user_id) await assertMember(ctx, input.owner_user_id, 'owner_user_id');
          const contract = row.contract_id ? await loadRow(ctx.tx, 'srv_contracts', row.contract_id, ctx.org, 'Contract') : null;
          const set: Record<string, unknown> = { priority: input.priority, triage_reason: input.triage_reason, owner_user_id: input.owner_user_id || ctx.user, first_response_at: row.first_response_at ? new Date(row.first_response_at).toISOString() : new Date().toISOString() };
          if (input.priority !== row.priority) Object.assign(set, await computeDue(ctx.tx, ctx.org, input.priority, contract, new Date(row.created_at)));
          return { set };
        },
      },
      hold: { from: ['TRIAGED', 'SCHEDULED', 'IN_PROGRESS'], to: 'ON_HOLD', permission: [Permission.SERVICE_MANAGE], fields: { triage_reason: { type: 'text', required: true } }, run: async (_c, _r, i) => ({ set: { paused_at: new Date().toISOString(), triage_reason: i.triage_reason } }) },
      resume: {
        from: ['ON_HOLD'],
        to: 'TRIAGED',
        permission: Permission.SERVICE_MANAGE,
        run: async (ctx, row) => {
          const h = await businessHours(ctx.tx, ctx.org);
          const paused = businessMinutesBetween(new Date(row.paused_at), new Date(), h);
          return { set: { paused_at: null, paused_minutes: Number(row.paused_minutes) + paused } };
        },
      },
      resolve: {
        from: ['SCHEDULED', 'IN_PROGRESS', 'TRIAGED'],
        to: 'RESOLVED',
        permission: Permission.SERVICE_MANAGE,
        fields: { resolution_summary: { type: 'text', required: true } },
        run: async (ctx, row, i) => {
          const open = (await ctx.tx.query(`SELECT COUNT(*)::int n FROM srv_work_orders WHERE case_id = $1 AND status IN ('SCHEDULED','DISPATCHED','IN_PROGRESS')`, [row.id])).rows[0].n;
          if (open) throw new ApiError(409, ErrorCode.INVALID_STATE, `${open} work order(s) are still open`);
          return { set: { resolution_summary: i.resolution_summary, resolved_at: new Date().toISOString() } };
        },
      },
      close: {
        from: ['RESOLVED'],
        to: 'CLOSED',
        permission: Permission.SERVICE_MANAGE,
        run: async (ctx, row) => {
          // SRV-020: completed work must be billed (or warranty-covered) before closing.
          const unbilled = (await ctx.tx.query(`SELECT COUNT(*)::int n FROM srv_work_orders WHERE case_id = $1 AND status = 'COMPLETED'`, [row.id])).rows[0].n;
          if (unbilled) throw new ApiError(409, ErrorCode.INVALID_STATE, `${unbilled} completed work order(s) are not billed yet`);
        },
      },
      cancel: { from: ['NEW', 'TRIAGED', 'ON_HOLD'], to: 'CANCELLED', permission: Permission.SERVICE_MANAGE, fields: { triage_reason: { type: 'text', required: true } }, run: async (_c, _r, i) => ({ set: { triage_reason: i.triage_reason } }) },
    },
  });

  // ---------- Work orders ----------
  defineResource(app, {
    path: '/api/srv/work-orders',
    table: 'srv_work_orders',
    label: 'Work order',
    event: 'SERVICE_WORK_ORDER',
    module: 'SRV',
    view: VIEW,
    create: Permission.SERVICE_DISPATCH,
    update: Permission.SERVICE_DISPATCH,
    fields: {
      case_id: { type: 'ref', table: 'srv_cases', required: true, label: 'case_id' },
      instructions: { type: 'text' },
      checklist: { type: 'json' },
    },
    editable: ['instructions', 'checklist'],
    editableIn: ['SCHEDULED', 'DISPATCHED'],
    numbering: { column: 'number', prefix: 'SWO' },
    initialStatus: 'SCHEDULED',
    select: `t.*, c.number AS case_number, c.title AS case_title, c.priority, c.site_address, p.name AS party_name, tech.name AS technician_name`,
    joins: 'JOIN srv_cases c ON c.id = t.case_id JOIN parties p ON p.id = c.party_id LEFT JOIN srv_technicians tech ON tech.id = t.technician_id',
    search: ['number', 'c.number', 'c.title', 'p.name', 'tech.name'],
    filters: ['technician_id', 'case_id'],
    orderBy: 't.scheduled_start NULLS LAST, t.created_at DESC',
    detail: async (q, row) => {
      const ch = await woChildren(q, row.id);
      const pending_hash = signoffHash(row, ch.parts, ch.time, ch.extras);
      return { ...ch, signoff_valid: row.signoff_hash ? row.signoff_hash === pending_hash : null };
    },
    beforeCreate: async (ctx, v) => {
      const c = await loadRow(ctx.tx, 'srv_cases', v.case_id, ctx.org, 'Case', true);
      if (['RESOLVED', 'CLOSED', 'CANCELLED'].includes(c.status)) throw new ApiError(409, ErrorCode.INVALID_STATE, `Case ${c.number} is ${c.status}`);
      const checklist = v.checklist ? JSON.parse(v.checklist) : [
        { item: 'Isolate power / confirm safe work area', mandatory: true, done: false },
        { item: 'Check refrigerant pressure & leaks', mandatory: true, done: false },
        { item: 'Clean filters and coils', mandatory: false, done: false },
        { item: 'Test run & record supply air temperature', mandatory: true, done: false },
      ];
      if (!Array.isArray(checklist) || checklist.some((x: any) => !x || typeof x.item !== 'string')) throw validationError('checklist must be a list of {item, mandatory}', { field: 'checklist' });
      v.checklist = JSON.stringify(checklist.map((x: any) => ({ item: String(x.item).slice(0, 200), mandatory: !!x.mandatory, done: false })));
      if (c.contract_id) {
        const k = await loadRow(ctx.tx, 'srv_contracts', c.contract_id, ctx.org, 'Contract');
        v.warranty_covered = k.status === 'ACTIVE' && todayIso() <= toIsoDate(k.end_date) && (k.covers_labour || k.covers_parts);
      }
      if (c.status === 'NEW' || c.status === 'TRIAGED') await ctx.tx.query(`UPDATE srv_cases SET status = 'SCHEDULED', first_response_at = COALESCE(first_response_at, NOW()), updated_at = NOW() WHERE id = $1`, [c.id]);
    },
    commands: {
      // SRV-005: hard capacity conflict — a technician cannot hold two overlapping jobs.
      dispatch: {
        from: ['SCHEDULED', 'DISPATCHED'],
        to: 'DISPATCHED',
        permission: Permission.SERVICE_DISPATCH,
        fields: { technician_id: { type: 'ref', table: 'srv_technicians', required: true, label: 'technician_id' }, scheduled_start: { type: 'datetime', required: true }, scheduled_end: { type: 'datetime', required: true } },
        run: async (ctx, row, i) => {
          const start = new Date(i.scheduled_start);
          const end = new Date(i.scheduled_end);
          if (end <= start) throw validationError('scheduled_end must be after scheduled_start', { field: 'scheduled_end' });
          if (end.getTime() - start.getTime() > 12 * 3600000) throw validationError('A visit window cannot exceed 12 hours', { field: 'scheduled_end' });
          const tech = (await ctx.tx.query(`SELECT * FROM srv_technicians WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [i.technician_id, ctx.org])).rows[0];
          if (tech.status !== 'ACTIVE') throw new ApiError(409, ErrorCode.INVALID_STATE, `${tech.name} is inactive`);
          const others = await ctx.tx.query(
            `SELECT number, scheduled_start, scheduled_end FROM srv_work_orders WHERE organization_id = $1 AND technician_id = $2 AND id <> $3 AND status IN ('DISPATCHED','IN_PROGRESS') AND scheduled_start IS NOT NULL`,
            [ctx.org, tech.id, row.id],
          );
          const clash = others.rows.find((o) => overlaps(start, end, new Date(o.scheduled_start), new Date(o.scheduled_end)));
          if (clash) throw new ApiError(409, ErrorCode.CAPACITY_CONFLICT, `${tech.name} is already booked on ${clash.number} in that window`, { conflicting_work_order: clash.number });
          return { set: { technician_id: tech.id, scheduled_start: start.toISOString(), scheduled_end: end.toISOString() } };
        },
      },
      start: {
        from: ['DISPATCHED'],
        to: 'IN_PROGRESS',
        permission: [Permission.SERVICE_EXECUTE, Permission.SERVICE_MANAGE],
        run: async (ctx, row) => {
          await assertTechScope(ctx, row);
          await ctx.tx.query(`UPDATE srv_cases SET status = 'IN_PROGRESS', updated_at = NOW() WHERE id = $1 AND status IN ('SCHEDULED','TRIAGED')`, [row.case_id]);
          return { set: { started_at: new Date().toISOString() } };
        },
      },
      checklist: {
        from: ['IN_PROGRESS'],
        permission: [Permission.SERVICE_EXECUTE, Permission.SERVICE_MANAGE],
        fields: { index: { type: 'int', required: true, min: 0, max: 100 }, done: { type: 'bool' } },
        run: async (ctx, row, i) => {
          await assertTechScope(ctx, row);
          const list = (typeof row.checklist === 'string' ? JSON.parse(row.checklist) : row.checklist) || [];
          if (!list[i.index]) throw validationError('No such checklist item', { field: 'index' });
          list[i.index].done = i.done;
          return { set: { checklist: JSON.stringify(list), signoff_hash: null, signed_at: null, customer_signoff_name: null } };
        },
      },
      signoff: {
        from: ['IN_PROGRESS'],
        permission: [Permission.SERVICE_EXECUTE, Permission.SERVICE_MANAGE],
        fields: { customer_signoff_name: { type: 'string', required: true, max: 255 } },
        run: async (ctx, row, i) => {
          await assertTechScope(ctx, row);
          const ch = await woChildren(ctx.tx, row.id);
          return { set: { customer_signoff_name: i.customer_signoff_name, signed_at: new Date().toISOString(), signoff_hash: signoffHash(row, ch.parts, ch.time, ch.extras) } };
        },
      },
      complete: {
        from: ['IN_PROGRESS'],
        to: 'COMPLETED',
        permission: [Permission.SERVICE_EXECUTE, Permission.SERVICE_MANAGE],
        fields: { resolution_notes: { type: 'text', required: true } },
        run: async (ctx, row, i) => {
          await assertTechScope(ctx, row);
          const list = (typeof row.checklist === 'string' ? JSON.parse(row.checklist) : row.checklist) || [];
          const missing = list.filter((x: any) => x.mandatory && !x.done).map((x: any) => x.item);
          if (missing.length) throw new ApiError(409, ErrorCode.CHECKLIST_INCOMPLETE, `Mandatory checks not done: ${missing.join('; ')}`, { missing });
          const ch = await woChildren(ctx.tx, row.id);
          if (!row.signoff_hash) throw new ApiError(409, ErrorCode.INVALID_STATE, 'Customer sign-off is required before completion');
          if (row.signoff_hash !== signoffHash(row, ch.parts, ch.time, ch.extras)) throw new ApiError(409, ErrorCode.STALE_REVISION, 'Work changed after the customer signed; capture sign-off again');
          if (!ch.time.some((t: any) => t.status !== 'REJECTED')) throw new ApiError(409, ErrorCode.INVALID_STATE, 'Log the time spent before completing');
          return { set: { resolution_notes: i.resolution_notes, completed_at: new Date().toISOString() } };
        },
      },
      cancel: { from: ['SCHEDULED', 'DISPATCHED'], to: 'CANCELLED', permission: Permission.SERVICE_DISPATCH },
      // SRV-017 / SRV-012: bill approved labour, chargeable parts and accepted extras once.
      bill: {
        from: ['COMPLETED'],
        to: 'BILLED',
        permission: Permission.SERVICE_BILL,
        fields: { invoice_date: { type: 'date', required: true } },
        run: async (ctx, row, i) => {
          const c = await loadRow(ctx.tx, 'srv_cases', row.case_id, ctx.org, 'Case');
          const contract = c.contract_id ? await loadRow(ctx.tx, 'srv_contracts', c.contract_id, ctx.org, 'Contract') : null;
          const coveredOn = (d: string) => !!contract && contract.status === 'ACTIVE' && d >= toIsoDate(contract.start_date) && d <= toIsoDate(contract.end_date);
          const workDate = toIsoDate(row.completed_at || new Date());
          const labourCovered = coveredOn(workDate) && contract.covers_labour;
          const partsCovered = coveredOn(workDate) && contract.covers_parts;
          const ch = await woChildren(ctx.tx, row.id);
          const pendingTime = ch.time.filter((t: any) => t.status === 'LOGGED');
          if (pendingTime.length) throw new ApiError(409, ErrorCode.INVALID_STATE, `${pendingTime.length} time entr${pendingTime.length === 1 ? 'y' : 'ies'} still awaiting approval`);
          const rate = String(await getSetting(ctx.tx, ctx.org, 'service.default_labour_rate'));
          const taxRate = '18';
          const labourItem = (await ctx.tx.query(`SELECT id FROM items WHERE organization_id = $1 AND code = 'SRV-LABOUR'`, [ctx.org])).rows[0];
          if (!labourItem) throw new ApiError(400, ErrorCode.MAPPING_MISSING, 'Service labour item SRV-LABOUR is not configured');
          const lines: any[] = [];
          const billableMin = ch.time.filter((t: any) => t.status === 'APPROVED' && t.billable).reduce((a: number, t: any) => a + Number(t.minutes), 0);
          if (billableMin > 0 && !labourCovered) lines.push({ item_id: labourItem.id, description: `Labour ${row.number} (${(billableMin / 60).toFixed(2)} h)`, quantity: new Money(billableMin).div(60).round(4).toFixed(4), unit_price: rate, tax_rate: taxRate, revenue_account_code: '411002' });
          for (const p of ch.parts) if (p.chargeable && !partsCovered) lines.push({ item_id: p.item_id, description: `${p.item_code} ${p.item_name}`, quantity: new Money(p.quantity).toFixed(4), unit_price: new Money(p.unit_price).toFixed(2), tax_rate: taxRate, revenue_account_code: '411001' });
          for (const e of ch.extras) if (e.status === 'ACCEPTED') lines.push({ item_id: labourItem.id, description: `Additional work: ${e.description}`, quantity: '1', unit_price: new Money(e.amount).toFixed(2), tax_rate: taxRate, revenue_account_code: '411002' });
          const inv = lines.length
            ? await createPostedSourceInvoice(ctx, { party_id: c.party_id, invoice_date: i.invoice_date, lines, sourceType: 'SERVICE_WORK_ORDER', sourceId: row.id, sourceKey: `SRV_WO_BILL:${row.id}`, notes: `Service ${c.number} / ${row.number}`, purpose: AccountingPurpose.SERVICE_INVOICE })
            : null;
          if (contract && coveredOn(workDate)) await ctx.tx.query(`UPDATE srv_contracts SET visits_used = visits_used + 1 WHERE id = $1`, [contract.id]);
          return { set: { ar_invoice_id: inv?.id ?? null, billed_amount: inv?.total_amount ?? '0' }, data: inv || { invoice_number: null, total_amount: '0.00', note: 'Fully covered by warranty/contract — nothing to invoice' } };
        },
      },
    },
  });

  // Parts issue through the stock contract (SRV-008): replay of the same issue_key never double-consumes.
  app.post('/api/srv/work-orders/:id/parts', authenticate, requireAnyPermission(Permission.SERVICE_EXECUTE, Permission.SERVICE_MANAGE), requireModule('SRV'), async (req: Request, res: Response) => {
    const out = await unitOfWork(req, async (ctx) => {
      const wo = await loadRow(ctx.tx, 'srv_work_orders', req.params.id, ctx.org, 'Work order', true);
      await assertTechScope(ctx, wo);
      if (wo.status !== 'IN_PROGRESS') throw new ApiError(409, ErrorCode.INVALID_STATE, `Parts can only be issued while the job is in progress (status ${wo.status})`);
      const issueKey = str(req.body?.issue_key, 'issue_key', { max: 120 });
      const existing = (await ctx.tx.query(`SELECT * FROM srv_work_order_parts WHERE organization_id = $1 AND issue_key = $2`, [ctx.org, issueKey])).rows[0];
      if (existing) {
        if (existing.work_order_id !== wo.id) throw new ApiError(409, ErrorCode.IDEMPOTENCY_CONFLICT, 'issue_key already used on another work order');
        return { ...existing, replayed: true };
      }
      const qty = decimal(req.body?.quantity, 'quantity', { sign: 'positive', scale: 4 });
      const items = await lockItems(ctx.tx, ctx.org, [String(req.body?.item_id)]);
      const item = items.get(String(req.body?.item_id));
      if (item.item_type !== 'INVENTORY') throw validationError('Only stocked items can be issued as parts', { field: 'item_id' });
      const wh = (typeof req.body?.warehouse_id === 'string' && (await loadRow(ctx.tx, 'warehouses', req.body.warehouse_id, ctx.org, 'Warehouse')).id) || (await defaultWarehouseId(ctx.tx, ctx.org));
      const date = todayIso();
      const mv = await postStockMovement(ctx.tx, { organizationId: ctx.org, legalEntityId: ctx.le, itemId: item.id, warehouseId: wh, movementType: 'SERVICE_ISSUE', movementDate: date, quantity: new Money(qty).negated().toFixed(8), unitCost: String(item.unit_cost), referenceType: 'SERVICE_WORK_ORDER', referenceId: wo.id, description: `Parts for ${wo.number}` });
      const value = new Money(mv.total_value).abs().round(2); // FIFO-aware
      const chargeable = req.body?.chargeable === undefined ? true : bool(req.body.chargeable);
      const cost = value.isPositive()
        ? await postJournal(ctx.tx, auditLogger, outboxService, {
            organizationId: ctx.org, legalEntityId: ctx.le, userId: ctx.user, postingDate: date, purpose: AccountingPurpose.SERVICE_PARTS_ISSUE,
            description: `Service parts ${wo.number} ${item.code}`, sourceType: 'SERVICE_PART', sourceId: wo.id, sourceKey: `SRV_PART:${issueKey}`, numberPrefix: 'JV-SRV', correlationId: ctx.req.correlationId,
            lines: [
              { account_code: wo.warranty_covered ? '521013' : '511001', debit: value.toFixed(8), description: `${wo.warranty_covered ? 'Warranty' : 'Service'} parts ${item.code}` },
              { account_code: '113001', credit: value.toFixed(8), description: `Stock issued ${item.code}` },
            ],
          })
        : null;
      const part = (
        await ctx.tx.query(
          `INSERT INTO srv_work_order_parts (organization_id, work_order_id, item_id, quantity, unit_cost, unit_price, chargeable, issue_key, stock_movement_id, journal_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [ctx.org, wo.id, item.id, qty, mv.unit_cost, item.unit_price, chargeable, issueKey, mv.id, cost?.journalId ?? null, ctx.user],
        )
      ).rows[0];
      await ctx.tx.query(`UPDATE srv_work_orders SET signoff_hash = NULL, signed_at = NULL, customer_signoff_name = NULL, revision = revision + 1 WHERE id = $1`, [wo.id]);
      await audit(ctx, 'SERVICE_PARTS_ISSUED', 'SERVICE_WORK_ORDER', wo.id, undefined, { item: item.code, quantity: qty, issue_key: issueKey });
      await emit(ctx, 'SERVICE_PARTS_ISSUED', { id: wo.id, number: wo.number, item_code: item.code, quantity: qty });
      return { ...part, on_hand_after: mv.on_hand_after, replayed: false };
    });
    return ok(req, res, out, out.replayed ? 200 : 201);
  });

  // Time (SRV-009): overlap with the technician's own entries is rejected.
  app.post('/api/srv/work-orders/:id/time', authenticate, requireAnyPermission(Permission.SERVICE_EXECUTE, Permission.SERVICE_MANAGE), requireModule('SRV'), async (req: Request, res: Response) => {
    const out = await unitOfWork(req, async (ctx) => {
      const wo = await loadRow(ctx.tx, 'srv_work_orders', req.params.id, ctx.org, 'Work order', true);
      await assertTechScope(ctx, wo);
      if (!['IN_PROGRESS', 'COMPLETED'].includes(wo.status)) throw new ApiError(409, ErrorCode.INVALID_STATE, `Time can only be logged on started jobs (status ${wo.status})`);
      if (!wo.technician_id) throw validationError('Dispatch a technician first');
      const start = new Date(String(req.body?.start_at));
      const end = new Date(String(req.body?.end_at));
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw validationError('start_at and end_at must be ISO date-times', { field: 'start_at' });
      if (end <= start) throw validationError('end_at must be after start_at', { field: 'end_at' });
      if (end.getTime() - start.getTime() > 16 * 3600000) throw validationError('A single entry cannot exceed 16 hours', { field: 'end_at' });
      if (end.getTime() > Date.now() + 5 * 60000) throw validationError('Time cannot be logged in the future', { field: 'end_at' });
      await ctx.tx.query(`SELECT 1 FROM srv_technicians WHERE id = $1 FOR UPDATE`, [wo.technician_id]);
      const clash = (
        await ctx.tx.query(`SELECT te.id, w.number FROM srv_time_entries te JOIN srv_work_orders w ON w.id = te.work_order_id WHERE te.technician_id = $1 AND te.status <> 'REJECTED' AND te.start_at < $3 AND te.end_at > $2`, [wo.technician_id, start.toISOString(), end.toISOString()])
      ).rows[0];
      if (clash) throw new ApiError(409, ErrorCode.OVERLAP_DETECTED, `Overlaps time already logged on ${clash.number}`, { field: 'start_at' });
      const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
      const row = (
        await ctx.tx.query(`INSERT INTO srv_time_entries (organization_id, work_order_id, technician_id, start_at, end_at, minutes, billable, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [
          ctx.org, wo.id, wo.technician_id, start.toISOString(), end.toISOString(), minutes, req.body?.billable === undefined ? true : bool(req.body.billable), ctx.user,
        ])
      ).rows[0];
      if (wo.status === 'IN_PROGRESS') await ctx.tx.query(`UPDATE srv_work_orders SET signoff_hash = NULL, signed_at = NULL, customer_signoff_name = NULL WHERE id = $1`, [wo.id]);
      await audit(ctx, 'SERVICE_TIME_LOGGED', 'SERVICE_WORK_ORDER', wo.id, undefined, { minutes });
      return row;
    });
    return ok(req, res, out, 201);
  });

  for (const [action, status] of [['approve', 'APPROVED'], ['reject', 'REJECTED']] as const) {
    app.post(`/api/srv/time/:id/${action}`, authenticate, requireAnyPermission(Permission.SERVICE_MANAGE), requireModule('SRV'), async (req: Request, res: Response) => {
      const out = await unitOfWork(req, async (ctx) => {
        const te = (await ctx.tx.query(`SELECT * FROM srv_time_entries WHERE id::text = $1 AND organization_id = $2 FOR UPDATE`, [req.params.id, ctx.org])).rows[0];
        if (!te) throw notFound('Time entry');
        if (te.status !== 'LOGGED') throw new ApiError(409, ErrorCode.INVALID_STATE, `Time entry is already ${te.status}`);
        if (te.created_by === ctx.user) throw new ApiError(403, ErrorCode.SEGREGATION_OF_DUTIES, 'You cannot approve time you logged yourself');
        const r = (await ctx.tx.query(`UPDATE srv_time_entries SET status = $2, approved_by = $3 WHERE id = $1 RETURNING *`, [te.id, status, ctx.user])).rows[0];
        await audit(ctx, `SERVICE_TIME_${status}`, 'SERVICE_TIME', te.id, { status: 'LOGGED' }, { status });
        return r;
      });
      return ok(req, res, out);
    });
  }

  // Extra work (SRV-010): proposed by the technician, only billable once the customer accepts.
  app.post('/api/srv/work-orders/:id/extras', authenticate, requireAnyPermission(Permission.SERVICE_EXECUTE, Permission.SERVICE_MANAGE), requireModule('SRV'), async (req: Request, res: Response) => {
    const out = await unitOfWork(req, async (ctx) => {
      const wo = await loadRow(ctx.tx, 'srv_work_orders', req.params.id, ctx.org, 'Work order', true);
      await assertTechScope(ctx, wo);
      if (wo.status !== 'IN_PROGRESS') throw new ApiError(409, ErrorCode.INVALID_STATE, 'Extra work can only be proposed on a job in progress');
      const r = (await ctx.tx.query(`INSERT INTO srv_extra_work (organization_id, work_order_id, description, amount, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [ctx.org, wo.id, str(req.body?.description, 'description', { max: 500 }), decimal(req.body?.amount, 'amount', { sign: 'positive', scale: 2 }), ctx.user])).rows[0];
      await audit(ctx, 'SERVICE_EXTRA_PROPOSED', 'SERVICE_WORK_ORDER', wo.id, undefined, { description: r.description, amount: r.amount });
      return r;
    });
    return ok(req, res, out, 201);
  });

  app.post('/api/srv/extras/:id/decide', authenticate, requireAnyPermission(Permission.SERVICE_EXECUTE, Permission.SERVICE_MANAGE), requireModule('SRV'), async (req: Request, res: Response) => {
    const out = await unitOfWork(req, async (ctx) => {
      const ex = (await ctx.tx.query(`SELECT * FROM srv_extra_work WHERE id::text = $1 AND organization_id = $2 FOR UPDATE`, [req.params.id, ctx.org])).rows[0];
      if (!ex) throw notFound('Extra work');
      const wo = await loadRow(ctx.tx, 'srv_work_orders', ex.work_order_id, ctx.org, 'Work order', true);
      await assertTechScope(ctx, wo);
      if (ex.status !== 'PROPOSED') throw new ApiError(409, ErrorCode.INVALID_STATE, `Already ${ex.status}`);
      const accept = bool(req.body?.accept);
      const name = accept ? str(req.body?.accepted_by_name, 'accepted_by_name', { max: 255 }) : null;
      const r = (await ctx.tx.query(`UPDATE srv_extra_work SET status = $2, accepted_by_name = $3, decided_at = NOW() WHERE id = $1 RETURNING *`, [ex.id, accept ? 'ACCEPTED' : 'DECLINED', name])).rows[0];
      await ctx.tx.query(`UPDATE srv_work_orders SET signoff_hash = NULL, signed_at = NULL, customer_signoff_name = NULL WHERE id = $1`, [wo.id]);
      await audit(ctx, accept ? 'SERVICE_EXTRA_ACCEPTED' : 'SERVICE_EXTRA_DECLINED', 'SERVICE_WORK_ORDER', wo.id, undefined, { extra: ex.id, by: name });
      return r;
    });
    return ok(req, res, out);
  });

  app.get('/api/srv/time', authenticate, requireAnyPermission(...VIEW), async (req: Request, res: Response) => {
    const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : null;
    const r = await db.query(
      `SELECT te.*, w.number AS work_order_number, t.name AS technician_name, u.name AS logged_by FROM srv_time_entries te JOIN srv_work_orders w ON w.id = te.work_order_id JOIN srv_technicians t ON t.id = te.technician_id LEFT JOIN users u ON u.id = te.created_by
       WHERE te.organization_id = $1 AND ($2::text IS NULL OR te.status = $2) ORDER BY te.start_at DESC LIMIT 300`,
      [req.session!.organization_id, status],
    );
    return ok(req, res, r.rows.map((x) => ({ ...x, hours: (x.minutes / 60).toFixed(2) })));
  });

  // Dispatch board: technicians with their jobs in a day window (local PKT day).
  app.get('/api/srv/board', authenticate, requireAnyPermission(...VIEW), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const day = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : todayIso();
    const from = new Date(Date.parse(`${day}T00:00:00+05:00`)).toISOString();
    const to = new Date(Date.parse(`${day}T00:00:00+05:00`) + 86400000).toISOString();
    const techs = (await db.query(`SELECT id, code, name, skills, zone FROM srv_technicians WHERE organization_id = $1 AND status = 'ACTIVE' ORDER BY name`, [org])).rows;
    const jobs = (
      await db.query(
        `SELECT w.id, w.number, w.status, w.technician_id, w.scheduled_start, w.scheduled_end, c.number AS case_number, c.title, c.priority, p.name AS party_name, c.site_address
         FROM srv_work_orders w JOIN srv_cases c ON c.id = w.case_id JOIN parties p ON p.id = c.party_id
         WHERE w.organization_id = $1 AND w.status <> 'CANCELLED' AND w.scheduled_start < $3 AND w.scheduled_end > $2 ORDER BY w.scheduled_start`,
        [org, from, to],
      )
    ).rows;
    const unassigned = (
      await db.query(
        `SELECT w.id, w.number, w.status, c.number AS case_number, c.title, c.priority, p.name AS party_name FROM srv_work_orders w JOIN srv_cases c ON c.id = w.case_id JOIN parties p ON p.id = c.party_id
         WHERE w.organization_id = $1 AND w.status = 'SCHEDULED' AND w.technician_id IS NULL ORDER BY c.priority, w.created_at`,
        [org],
      )
    ).rows;
    return ok(req, res, { date: day, technicians: techs.map((t) => ({ ...t, jobs: jobs.filter((j) => j.technician_id === t.id) })), unassigned });
  });

  app.get('/api/srv/summary', authenticate, requireAnyPermission(...VIEW), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const r = (
      await db.query(
        `SELECT
          COUNT(*) FILTER (WHERE status NOT IN ('RESOLVED','CLOSED','CANCELLED'))::int AS open_cases,
          COUNT(*) FILTER (WHERE status NOT IN ('RESOLVED','CLOSED','CANCELLED') AND paused_at IS NULL AND resolution_due_at + (paused_minutes || ' minutes')::interval < NOW())::int AS breached,
          COUNT(*) FILTER (WHERE resolved_at IS NOT NULL)::int AS resolved,
          COUNT(*) FILTER (WHERE resolved_at IS NOT NULL AND resolved_at <= resolution_due_at + (paused_minutes || ' minutes')::interval)::int AS resolved_in_sla,
          COUNT(*) FILTER (WHERE priority = 'CRITICAL' AND status NOT IN ('RESOLVED','CLOSED','CANCELLED'))::int AS critical_open
         FROM srv_cases WHERE organization_id = $1`,
        [org],
      )
    ).rows[0];
    const ftf = (
      await db.query(
        `SELECT COUNT(*)::int AS cases, COUNT(*) FILTER (WHERE n = 1)::int AS first_time FROM (SELECT c.id, COUNT(w.id) n FROM srv_cases c JOIN srv_work_orders w ON w.case_id = c.id AND w.status IN ('COMPLETED','BILLED') WHERE c.organization_id = $1 AND c.resolved_at IS NOT NULL GROUP BY c.id) x`,
        [org],
      )
    ).rows[0];
    const unbilled = (await db.query(`SELECT COUNT(*)::int n FROM srv_work_orders WHERE organization_id = $1 AND status = 'COMPLETED'`, [org])).rows[0].n;
    return ok(req, res, {
      ...r,
      sla_attainment_pct: r.resolved ? ((r.resolved_in_sla / r.resolved) * 100).toFixed(1) : null,
      first_time_fix_pct: ftf.cases ? ((ftf.first_time / ftf.cases) * 100).toFixed(1) : null,
      first_time_fix_basis: `${ftf.first_time} of ${ftf.cases} resolved cases fixed in one visit`,
      unbilled_work_orders: unbilled,
    });
  });

  // SRV-013: preventive service — one case per contract occurrence (unique (contract, pm_due_date)).
  app.post('/api/srv/contracts/generate-pm', authenticate, requireAnyPermission(Permission.SERVICE_MANAGE), requireModule('SRV', 'create'), async (req: Request, res: Response) => {
    const asOf = typeof req.body?.as_of === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.as_of) ? req.body.as_of : todayIso();
    const out = await unitOfWork(req, (ctx) => generatePreventive(ctx.tx, ctx.org, ctx.le, ctx.user, asOf));
    return ok(req, res, out);
  });
}

export async function generatePreventive(q: any, org: string, le: string, userId: string | null, asOf: string) {
  const { nextDocumentNumber } = await import('../lib/numbering.js');
  const due = await q.query(`SELECT * FROM srv_contracts WHERE organization_id = $1 AND status = 'ACTIVE' AND pm_interval_months IS NOT NULL AND next_pm_date IS NOT NULL AND next_pm_date <= $2 AND next_pm_date <= end_date FOR UPDATE`, [org, asOf]);
  const created: string[] = [];
  let skipped = 0;
  for (const c of due.rows) {
    const pmDate = toIsoDate(c.next_pm_date);
    const exists = await q.query(`SELECT 1 FROM srv_cases WHERE contract_id = $1 AND pm_due_date = $2`, [c.id, pmDate]);
    const d = new Date(`${pmDate}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + c.pm_interval_months);
    await q.query(`UPDATE srv_contracts SET next_pm_date = $2, updated_at = NOW() WHERE id = $1`, [c.id, d.toISOString().slice(0, 10)]);
    if (exists.rows.length) {
      skipped++;
      continue;
    }
    const number = await nextDocumentNumber(q, org, 'SRV');
    const h = await businessHours(q, org);
    const start = new Date(`${pmDate}T04:00:00Z`); // 09:00 PKT
    await q.query(
      `INSERT INTO srv_cases (organization_id, legal_entity_id, number, party_id, contract_id, channel, title, category, priority, site_address, status, response_due_at, resolution_due_at, pm_due_date, created_by)
       VALUES ($1,$2,$3,$4,$5,'PREVENTIVE',$6,'MAINTENANCE','MEDIUM',$7,'NEW',$8,$9,$10,$11)`,
      [org, le, number, c.party_id, c.id, `Preventive maintenance — ${c.title}`, c.site_address, addBusinessMinutes(start, c.response_hours * 60, h).toISOString(), addBusinessMinutes(start, c.resolution_hours * 60, h).toISOString(), pmDate, userId],
    );
    await outboxService.emit({ organization_id: org, event_type: 'SERVICE_CASE_CREATED', payload: { number, channel: 'PREVENTIVE', priority: 'MEDIUM', contract: c.number } }, q);
    created.push(number);
  }
  return { as_of: asOf, created, skipped_duplicates: skipped };
}
