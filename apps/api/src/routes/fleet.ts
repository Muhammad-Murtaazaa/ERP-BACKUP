/**
 * FLT — fleet for field service. Vehicles carry compliance expiry dates; assignments to
 * technicians cannot overlap for the vehicle or the technician (CAPACITY_CONFLICT) and a vehicle
 * in maintenance cannot be booked. Fuel logs must move the odometer forward (monotonic, bounded
 * jump), compute km/l, and post once: DR 521011 fuel / CR 111001 cash or 211003 accrued (account).
 */
import type { Express, Request, Response } from 'express';
import { Permission, ErrorCode, AccountingPurpose } from '@omnysync/contracts';
import { Money } from '@omnysync/financial-engine';
import { db, authenticate, requireAnyPermission, auditLogger, outboxService } from '../context.js';
import { ok } from '../lib/http.js';
import { ApiError, validationError } from '../lib/errors.js';
import { defineResource, loadRow } from '../lib/resource.js';
import { toIsoDate } from '../lib/validate.js';
import { postJournal } from '../lib/posting.js';

const VIEW = [Permission.FLEET_VIEW, Permission.FLEET_MANAGE, Permission.FLEET_POST];
export const MAX_KM_JUMP = 3000;

/** Odometer rule: strictly increasing, and no implausible jump between fills. */
export function checkOdometer(previous: string | null, next: string) {
  const n = new Money(next);
  if (previous == null) return null;
  const p = new Money(previous);
  if (!n.gt(p)) throw validationError(`Odometer must be greater than the last reading (${p.toFixed(1)} km)`, { field: 'odometer_km' });
  if (n.sub(p).gt(MAX_KM_JUMP)) throw validationError(`A ${n.sub(p).toFixed(0)} km jump since the last fill looks wrong (max ${MAX_KM_JUMP} km)`, { field: 'odometer_km' });
  return n.sub(p);
}

export function registerFleetRoutes(app: Express): void {
  defineResource(app, {
    path: '/api/flt/vehicles',
    table: 'flt_vehicles',
    label: 'Vehicle',
    event: 'FLEET_VEHICLE',
    module: 'FLT',
    view: VIEW,
    create: Permission.FLEET_MANAGE,
    update: Permission.FLEET_MANAGE,
    fields: {
      code: { type: 'string', required: true, max: 32, pattern: /^[A-Z0-9-]+$/ },
      registration: { type: 'string', required: true, max: 32, pattern: /^[A-Za-z0-9 -]+$/ },
      make_model: { type: 'string', required: true, max: 120 },
      model_year: { type: 'int', min: 1980, max: 2100 },
      fuel_type: { type: 'enum', values: ['PETROL', 'DIESEL', 'CNG', 'HYBRID', 'EV'], default: 'PETROL' },
      odometer_km: { type: 'decimal', default: '0', scale: 1 },
      insurance_expiry: { type: 'date' },
      fitness_expiry: { type: 'date' },
    },
    editable: ['make_model', 'insurance_expiry', 'fitness_expiry'],
    initialStatus: 'ACTIVE',
    select: `t.*, (t.insurance_expiry < CURRENT_DATE + 30 OR t.fitness_expiry < CURRENT_DATE + 30) AS compliance_due,
      (SELECT tech.name FROM flt_assignments a JOIN srv_technicians tech ON tech.id = a.technician_id WHERE a.vehicle_id = t.id AND a.status = 'BOOKED' AND NOW() BETWEEN a.start_at AND a.end_at LIMIT 1) AS current_driver,
      (SELECT ROUND(AVG(km_per_litre), 2) FROM flt_fuel_logs f WHERE f.vehicle_id = t.id AND f.status <> 'VOID' AND f.km_per_litre IS NOT NULL) AS avg_km_per_litre`,
    search: ['code', 'registration', 'make_model'],
    filters: ['fuel_type'],
    orderBy: 't.code',
    detail: async (q, row) => ({
      fuel: (await q.query(`SELECT * FROM flt_fuel_logs WHERE vehicle_id = $1 ORDER BY log_date DESC, odometer_km DESC LIMIT 20`, [row.id])).rows,
      assignments: (await q.query(`SELECT a.*, tech.name AS technician_name FROM flt_assignments a JOIN srv_technicians tech ON tech.id = a.technician_id WHERE a.vehicle_id = $1 ORDER BY a.start_at DESC LIMIT 20`, [row.id])).rows,
    }),
    beforeCreate: async (ctx, v) => {
      v.registration = String(v.registration).toUpperCase();
      const dup = await ctx.tx.query(`SELECT code FROM flt_vehicles WHERE organization_id = $1 AND (code = $2 OR registration = $3)`, [ctx.org, v.code, v.registration]);
      if (dup.rows[0]) throw new ApiError(409, ErrorCode.DUPLICATE_RESOURCE, `Vehicle ${dup.rows[0].code} already uses that code or registration`, { field: 'registration' });
    },
    commands: {
      maintenance: { from: ['ACTIVE'], to: 'IN_MAINTENANCE', permission: Permission.FLEET_MANAGE, fields: { status_note: { type: 'text', required: true } }, run: async (_c, _r, i) => ({ set: { status_note: i.status_note } }) },
      reactivate: { from: ['IN_MAINTENANCE'], to: 'ACTIVE', permission: Permission.FLEET_MANAGE },
      retire: {
        from: ['ACTIVE', 'IN_MAINTENANCE'],
        to: 'RETIRED',
        permission: Permission.FLEET_MANAGE,
        fields: { status_note: { type: 'text', required: true } },
        run: async (ctx, row, i) => {
          const n = (await ctx.tx.query(`SELECT COUNT(*)::int n FROM flt_assignments WHERE vehicle_id = $1 AND status = 'BOOKED' AND end_at > NOW()`, [row.id])).rows[0].n;
          if (n) throw new ApiError(409, ErrorCode.INVALID_STATE, `${n} future assignment(s) must be cancelled first`);
          return { set: { status_note: i.status_note } };
        },
      },
    },
  });

  defineResource(app, {
    path: '/api/flt/assignments',
    table: 'flt_assignments',
    label: 'Assignment',
    event: 'FLEET_ASSIGNMENT',
    module: 'FLT',
    view: VIEW,
    create: Permission.FLEET_MANAGE,
    update: false,
    fields: {
      vehicle_id: { type: 'ref', table: 'flt_vehicles', required: true, label: 'vehicle_id' },
      technician_id: { type: 'ref', table: 'srv_technicians', required: true, label: 'technician_id' },
      start_at: { type: 'datetime', required: true },
      end_at: { type: 'datetime', required: true },
      purpose: { type: 'string' },
    },
    initialStatus: 'BOOKED',
    select: `t.*, v.code AS vehicle_code, v.registration, tech.name AS technician_name`,
    joins: 'JOIN flt_vehicles v ON v.id = t.vehicle_id JOIN srv_technicians tech ON tech.id = t.technician_id',
    search: ['v.code', 'v.registration', 'tech.name', 'purpose'],
    filters: ['vehicle_id', 'technician_id'],
    orderBy: 't.start_at DESC',
    beforeCreate: async (ctx, v) => {
      if (new Date(v.end_at) <= new Date(v.start_at)) throw validationError('end_at must be after start_at', { field: 'end_at' });
      const veh = (await ctx.tx.query(`SELECT * FROM flt_vehicles WHERE id = $1 FOR UPDATE`, [v.vehicle_id])).rows[0];
      if (veh.status !== 'ACTIVE') throw new ApiError(409, ErrorCode.INVALID_STATE, `${veh.code} is ${veh.status.toLowerCase().replace('_', ' ')}`);
      await ctx.tx.query(`SELECT 1 FROM srv_technicians WHERE id = $1 FOR UPDATE`, [v.technician_id]);
      const clash = (
        await ctx.tx.query(
          `SELECT a.vehicle_id, v.code, tech.name FROM flt_assignments a JOIN flt_vehicles v ON v.id = a.vehicle_id JOIN srv_technicians tech ON tech.id = a.technician_id
           WHERE a.organization_id = $1 AND a.status = 'BOOKED' AND (a.vehicle_id = $2 OR a.technician_id = $3) AND a.start_at < $5 AND a.end_at > $4 LIMIT 1`,
          [ctx.org, v.vehicle_id, v.technician_id, v.start_at, v.end_at],
        )
      ).rows[0];
      if (clash) throw new ApiError(409, ErrorCode.CAPACITY_CONFLICT, clash.vehicle_id === v.vehicle_id ? `${clash.code} is already assigned to ${clash.name} in that window` : `${clash.name} already has ${clash.code} in that window`);
    },
    commands: {
      return: { from: ['BOOKED'], to: 'RETURNED', permission: Permission.FLEET_MANAGE, run: async () => ({ set: { returned_at: new Date().toISOString() } }) },
      cancel: { from: ['BOOKED'], to: 'CANCELLED', permission: Permission.FLEET_MANAGE },
    },
  });

  defineResource(app, {
    path: '/api/flt/fuel',
    table: 'flt_fuel_logs',
    label: 'Fuel log',
    event: 'FLEET_FUEL',
    module: 'FLT',
    view: VIEW,
    create: Permission.FLEET_MANAGE,
    update: false,
    fields: {
      vehicle_id: { type: 'ref', table: 'flt_vehicles', required: true, label: 'vehicle_id' },
      log_date: { type: 'date', required: true },
      odometer_km: { type: 'decimal', required: true, scale: 1 },
      litres: { type: 'decimal', required: true, sign: 'positive', scale: 2 },
      amount: { type: 'decimal', required: true, sign: 'positive', scale: 2 },
      station: { type: 'string', max: 120 },
      paid_by: { type: 'enum', values: ['CASH', 'ACCOUNT'], default: 'CASH' },
    },
    initialStatus: 'LOGGED',
    select: `t.*, v.code AS vehicle_code, v.registration, ROUND(t.amount / NULLIF(t.litres, 0), 2) AS price_per_litre`,
    joins: 'JOIN flt_vehicles v ON v.id = t.vehicle_id',
    search: ['v.code', 'v.registration', 'station'],
    filters: ['vehicle_id', 'paid_by'],
    orderBy: 't.log_date DESC, t.odometer_km DESC',
    beforeCreate: async (ctx, v) => {
      const veh = (await ctx.tx.query(`SELECT * FROM flt_vehicles WHERE id = $1 FOR UPDATE`, [v.vehicle_id])).rows[0];
      if (veh.status === 'RETIRED') throw new ApiError(409, ErrorCode.INVALID_STATE, `${veh.code} is retired`);
      if (veh.fuel_type === 'EV') throw validationError('EVs are charged, not fuelled — log charging as an expense', { field: 'vehicle_id' });
      const last = (await ctx.tx.query(`SELECT odometer_km::text, log_date FROM flt_fuel_logs WHERE vehicle_id = $1 AND status <> 'VOID' ORDER BY odometer_km DESC LIMIT 1`, [veh.id])).rows[0];
      if (last && v.log_date < toIsoDate(last.log_date)) throw validationError(`log_date is before the last fill (${toIsoDate(last.log_date)})`, { field: 'log_date' });
      const prev = last?.odometer_km ?? (new Money(veh.odometer_km).isPositive() ? String(veh.odometer_km) : null);
      const dist = checkOdometer(prev, v.odometer_km);
      v.previous_odometer_km = prev;
      v.km_per_litre = dist ? dist.div(v.litres).round(2).toFixed(2) : null;
      await ctx.tx.query(`UPDATE flt_vehicles SET odometer_km = GREATEST(odometer_km, $2), updated_at = NOW() WHERE id = $1`, [veh.id, v.odometer_km]);
    },
    commands: {
      post: {
        from: ['LOGGED'],
        to: 'POSTED',
        permission: Permission.FLEET_POST,
        run: async (ctx, row) => {
          const veh = await loadRow(ctx.tx, 'flt_vehicles', row.vehicle_id, ctx.org, 'Vehicle');
          const amt = new Money(row.amount).toFixed(8);
          const j = await postJournal(ctx.tx, auditLogger, outboxService, {
            organizationId: ctx.org, legalEntityId: ctx.le, userId: ctx.user, postingDate: toIsoDate(row.log_date), purpose: AccountingPurpose.FLEET_EXPENSE,
            description: `Fuel ${veh.code} ${veh.registration} ${new Money(row.litres).toFixed(2)} L`, sourceType: 'FLEET_FUEL', sourceId: row.id, sourceKey: `FLT_FUEL:${row.id}`, numberPrefix: 'JV-FLT', correlationId: ctx.req.correlationId,
            lines: [
              { account_code: '521011', debit: amt, description: `Fuel ${veh.code}` },
              { account_code: row.paid_by === 'CASH' ? '111001' : '211003', credit: amt, description: row.paid_by === 'CASH' ? 'Cash paid at pump' : 'Fuel card / account payable' },
            ],
          });
          return { set: { journal_id: j?.journalId ?? null }, data: j };
        },
      },
      void: { from: ['LOGGED'], to: 'VOID', permission: Permission.FLEET_MANAGE, fields: { void_reason: { type: 'text', required: true } }, run: async (_c, _r, i) => ({ set: { void_reason: i.void_reason } }) },
    },
  });

  app.get('/api/flt/summary', authenticate, requireAnyPermission(...VIEW), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const v = (await db.query(`SELECT COUNT(*) FILTER (WHERE status='ACTIVE')::int active, COUNT(*) FILTER (WHERE status='IN_MAINTENANCE')::int maintenance, COUNT(*) FILTER (WHERE status <> 'RETIRED' AND (insurance_expiry < CURRENT_DATE + 30 OR fitness_expiry < CURRENT_DATE + 30))::int compliance_due FROM flt_vehicles WHERE organization_id = $1`, [org])).rows[0];
    const f = (await db.query(`SELECT COALESCE(SUM(amount) FILTER (WHERE log_date >= date_trunc('month', CURRENT_DATE)),0)::text fuel_mtd, COALESCE(SUM(litres) FILTER (WHERE log_date >= date_trunc('month', CURRENT_DATE)),0)::text litres_mtd, ROUND(AVG(km_per_litre),2)::text avg_kmpl, COUNT(*) FILTER (WHERE status='LOGGED')::int unposted FROM flt_fuel_logs WHERE organization_id = $1 AND status <> 'VOID'`, [org])).rows[0];
    return ok(req, res, { ...v, ...f });
  });
}
