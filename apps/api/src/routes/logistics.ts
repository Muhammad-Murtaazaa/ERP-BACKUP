/**
 * LOG — logistics execution. Shipments move PLANNED → BOOKED (carrier + unique tracking number)
 * → IN_TRANSIT → DELIVERED (proof of delivery mandatory) with EXCEPTION as a recoverable detour.
 * Tracking events are append-only and replay-safe (unique shipment + time + code), so a carrier
 * webhook retried three times records one event. Freight posts once: DR 521012 freight / CR AP
 * (carrier vendor) or CR 211003 accrued when the carrier has no vendor account.
 */
import type { Express, Request, Response } from 'express';
import { Permission, ErrorCode, AccountingPurpose } from '@omnysync/contracts';
import { Money } from '@omnysync/financial-engine';
import { db, authenticate, requireAnyPermission, auditLogger, outboxService } from '../context.js';
import { ok } from '../lib/http.js';
import { ApiError, validationError } from '../lib/errors.js';
import { audit, defineResource, emit, loadRow, unitOfWork, type Ctx } from '../lib/resource.js';
import { requireModule } from '../lib/modules.js';
import { oneOf, str, todayIso } from '../lib/validate.js';
import { postJournal } from '../lib/posting.js';

const VIEW = [Permission.LOGISTICS_VIEW, Permission.LOGISTICS_MANAGE, Permission.LOGISTICS_POST];
const CODES = ['BOOKED', 'PICKED_UP', 'IN_TRANSIT', 'AT_HUB', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION', 'NOTE'] as const;

async function addEvent(ctx: Ctx, shipmentId: string, e: { event_at: string; code: string; location?: string | null; note?: string | null; source?: string }) {
  const r = await ctx.tx.query(
    `INSERT INTO log_tracking_events (organization_id, shipment_id, event_at, code, location, note, source, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (shipment_id, event_at, code) DO NOTHING RETURNING *`,
    [ctx.org, shipmentId, e.event_at, e.code, e.location ?? null, e.note ?? null, e.source || 'MANUAL', ctx.user],
  );
  return r.rows[0] || null;
}

export function registerLogisticsRoutes(app: Express): void {
  defineResource(app, {
    path: '/api/log/carriers',
    table: 'log_carriers',
    label: 'Carrier',
    event: 'LOGISTICS_CARRIER',
    module: 'LOG',
    view: VIEW,
    create: Permission.LOGISTICS_MANAGE,
    update: Permission.LOGISTICS_MANAGE,
    fields: {
      code: { type: 'string', required: true, max: 32, pattern: /^[A-Z0-9-]+$/ },
      name: { type: 'string', required: true },
      mode: { type: 'enum', values: ['ROAD', 'AIR', 'SEA', 'RAIL', 'COURIER', 'OWN_FLEET'], required: true },
      party_id: { type: 'ref', table: 'parties', label: 'party_id' },
      tracking_url_template: { type: 'string', max: 500, pattern: /^https:\/\/[^\s]+$/ },
    },
    editable: ['name', 'party_id', 'tracking_url_template'],
    initialStatus: 'ACTIVE',
    select: 't.*, p.name AS vendor_name',
    joins: 'LEFT JOIN parties p ON p.id = t.party_id',
    search: ['code', 't.name'],
    orderBy: 't.code',
    beforeCreate: async (ctx, v) => {
      if (v.party_id) {
        const p = await loadRow(ctx.tx, 'parties', v.party_id, ctx.org, 'Party');
        if (!['VENDOR', 'BOTH'].includes(p.party_type)) throw validationError('Carrier account must be a vendor', { field: 'party_id' });
      }
    },
    commands: { deactivate: { from: ['ACTIVE'], to: 'INACTIVE' }, activate: { from: ['INACTIVE'], to: 'ACTIVE' } },
  });

  defineResource(app, {
    path: '/api/log/shipments',
    table: 'log_shipments',
    label: 'Shipment',
    event: 'LOGISTICS_SHIPMENT',
    module: 'LOG',
    view: VIEW,
    create: Permission.LOGISTICS_MANAGE,
    update: Permission.LOGISTICS_MANAGE,
    fields: {
      direction: { type: 'enum', values: ['OUTBOUND', 'INBOUND'], required: true },
      carrier_id: { type: 'ref', table: 'log_carriers', label: 'carrier_id' },
      party_id: { type: 'ref', table: 'parties', label: 'party_id' },
      sales_order_id: { type: 'ref', table: 'sales_orders', label: 'sales_order_id' },
      purchase_order_id: { type: 'ref', table: 'purchase_orders', label: 'purchase_order_id' },
      origin: { type: 'string', required: true },
      destination: { type: 'string', required: true },
      packages: { type: 'int', min: 1, max: 10000, default: 1 },
      weight_kg: { type: 'decimal', scale: 3 },
      planned_ship_date: { type: 'date', defaultToday: true },
      promised_date: { type: 'date' },
      freight_amount: { type: 'decimal', default: '0', scale: 2 },
    },
    editable: ['carrier_id', 'origin', 'destination', 'packages', 'weight_kg', 'planned_ship_date', 'promised_date', 'freight_amount'],
    editableIn: ['PLANNED', 'BOOKED'],
    numbering: { column: 'number', prefix: 'SHP' },
    initialStatus: 'PLANNED',
    select: `t.*, c.name AS carrier_name, c.code AS carrier_code, c.tracking_url_template, p.name AS party_name, so.order_number AS sales_order_number, po.po_number AS purchase_order_number,
      (t.status = 'DELIVERED' AND t.promised_date IS NOT NULL AND (t.delivered_at AT TIME ZONE 'Asia/Karachi')::date <= t.promised_date) AS on_time,
      (t.status NOT IN ('DELIVERED','CANCELLED') AND t.promised_date < CURRENT_DATE) AS late`,
    joins: 'LEFT JOIN log_carriers c ON c.id = t.carrier_id LEFT JOIN parties p ON p.id = t.party_id LEFT JOIN sales_orders so ON so.id = t.sales_order_id LEFT JOIN purchase_orders po ON po.id = t.purchase_order_id',
    search: ['number', 'tracking_number', 'destination', 'p.name', 'c.name'],
    filters: ['direction', 'carrier_id'],
    detail: async (q, row) => ({
      events: (await q.query(`SELECT e.*, u.name AS recorded_by FROM log_tracking_events e LEFT JOIN users u ON u.id = e.created_by WHERE e.shipment_id = $1 ORDER BY e.event_at, e.created_at`, [row.id])).rows,
      tracking_url: row.tracking_url_template && row.tracking_number ? String(row.tracking_url_template).replace('{tracking}', encodeURIComponent(row.tracking_number)) : null,
    }),
    beforeCreate: async (ctx, v) => {
      if (v.sales_order_id && v.purchase_order_id) throw validationError('Link a sales order or a purchase order, not both', { field: 'purchase_order_id' });
      if (v.direction === 'OUTBOUND' && v.purchase_order_id) throw validationError('Outbound shipments link to sales orders', { field: 'purchase_order_id' });
      if (v.direction === 'INBOUND' && v.sales_order_id) throw validationError('Inbound shipments link to purchase orders', { field: 'sales_order_id' });
      if (v.promised_date && v.planned_ship_date && v.promised_date < v.planned_ship_date) throw validationError('promised_date cannot be before planned_ship_date', { field: 'promised_date' });
      const src = v.sales_order_id ? await loadRow(ctx.tx, 'sales_orders', v.sales_order_id, ctx.org, 'Sales order') : v.purchase_order_id ? await loadRow(ctx.tx, 'purchase_orders', v.purchase_order_id, ctx.org, 'Purchase order') : null;
      if (src) {
        if (['CANCELLED', 'DRAFT'].includes(src.status)) throw new ApiError(409, ErrorCode.INVALID_STATE, `Linked order is ${src.status}`);
        if (v.party_id && v.party_id !== src.party_id) throw validationError('Party differs from the linked order', { field: 'party_id' });
        v.party_id = src.party_id;
      }
    },
    commands: {
      book: {
        from: ['PLANNED'],
        to: 'BOOKED',
        permission: Permission.LOGISTICS_MANAGE,
        fields: { carrier_id: { type: 'ref', table: 'log_carriers', label: 'carrier_id' }, tracking_number: { type: 'string', required: true, max: 80, pattern: /^[A-Za-z0-9-]+$/ } },
        run: async (ctx, row, i) => {
          const carrierId = i.carrier_id || row.carrier_id;
          if (!carrierId) throw validationError('Choose a carrier', { field: 'carrier_id' });
          const c = await loadRow(ctx.tx, 'log_carriers', carrierId, ctx.org, 'Carrier');
          if (c.status !== 'ACTIVE') throw new ApiError(409, ErrorCode.INVALID_STATE, `${c.name} is inactive`);
          const dup = await ctx.tx.query(`SELECT number FROM log_shipments WHERE organization_id = $1 AND carrier_id = $2 AND tracking_number = $3 AND id <> $4`, [ctx.org, carrierId, i.tracking_number, row.id]);
          if (dup.rows[0]) throw new ApiError(409, ErrorCode.DUPLICATE_RESOURCE, `Tracking number already used on ${dup.rows[0].number}`, { field: 'tracking_number' });
          await addEvent(ctx, row.id, { event_at: new Date().toISOString(), code: 'BOOKED', note: `${c.name} · ${i.tracking_number}`, source: 'SYSTEM' });
          return { set: { carrier_id: carrierId, tracking_number: i.tracking_number } };
        },
      },
      dispatch: {
        from: ['BOOKED'],
        to: 'IN_TRANSIT',
        permission: Permission.LOGISTICS_MANAGE,
        fields: { shipped_at: { type: 'datetime' }, location: { type: 'string' } },
        run: async (ctx, row, i) => {
          const at = i.shipped_at || new Date().toISOString();
          if (new Date(at).getTime() > Date.now() + 5 * 60000) throw validationError('shipped_at cannot be in the future', { field: 'shipped_at' });
          await addEvent(ctx, row.id, { event_at: at, code: 'PICKED_UP', location: i.location || row.origin, source: 'SYSTEM' });
          return { set: { shipped_at: at } };
        },
      },
      deliver: {
        from: ['IN_TRANSIT', 'EXCEPTION'],
        to: 'DELIVERED',
        permission: Permission.LOGISTICS_MANAGE,
        fields: { pod_name: { type: 'string', required: true }, pod_note: { type: 'text' }, delivered_at: { type: 'datetime' } },
        run: async (ctx, row, i) => {
          const at = i.delivered_at || new Date().toISOString();
          if (row.shipped_at && new Date(at) < new Date(row.shipped_at)) throw validationError('Delivery cannot precede dispatch', { field: 'delivered_at' });
          if (new Date(at).getTime() > Date.now() + 5 * 60000) throw validationError('delivered_at cannot be in the future', { field: 'delivered_at' });
          await addEvent(ctx, row.id, { event_at: at, code: 'DELIVERED', location: row.destination, note: `Received by ${i.pod_name}`, source: 'SYSTEM' });
          return { set: { delivered_at: at, pod_name: i.pod_name, pod_note: i.pod_note, exception_reason: null } };
        },
      },
      exception: {
        from: ['BOOKED', 'IN_TRANSIT'],
        to: 'EXCEPTION',
        permission: Permission.LOGISTICS_MANAGE,
        fields: { exception_reason: { type: 'text', required: true } },
        run: async (ctx, row, i) => {
          await addEvent(ctx, row.id, { event_at: new Date().toISOString(), code: 'EXCEPTION', note: i.exception_reason, source: 'SYSTEM' });
          return { set: { exception_reason: i.exception_reason } };
        },
      },
      resume: { from: ['EXCEPTION'], to: 'IN_TRANSIT', permission: Permission.LOGISTICS_MANAGE },
      cancel: { from: ['PLANNED', 'BOOKED'], to: 'CANCELLED', permission: Permission.LOGISTICS_MANAGE },
      'post-freight': {
        from: ['BOOKED', 'IN_TRANSIT', 'DELIVERED', 'EXCEPTION'],
        permission: Permission.LOGISTICS_POST,
        fields: { posting_date: { type: 'date' } },
        run: async (ctx, row, i) => {
          if (row.freight_journal_id) throw new ApiError(409, ErrorCode.ALREADY_BILLED, 'Freight has already been posted for this shipment');
          const amt = new Money(row.freight_amount);
          if (!amt.isPositive()) throw validationError('Set a freight amount before posting', { field: 'freight_amount' });
          const c = row.carrier_id ? await loadRow(ctx.tx, 'log_carriers', row.carrier_id, ctx.org, 'Carrier') : null;
          const date = i.posting_date || todayIso();
          const credit = c?.party_id ? { account_code: '211001', credit: amt.toFixed(8), party_id: c.party_id, description: `Freight payable ${row.number}` } : { account_code: '211003', credit: amt.toFixed(8), description: `Accrued freight ${row.number}` };
          const j = await postJournal(ctx.tx, auditLogger, outboxService, {
            organizationId: ctx.org, legalEntityId: ctx.le, userId: ctx.user, postingDate: date, purpose: AccountingPurpose.FREIGHT_CHARGE,
            description: `Freight ${row.number} ${c ? c.name : ''}`.trim(), sourceType: 'SHIPMENT', sourceId: row.id, sourceKey: `LOG_FREIGHT:${row.id}`, numberPrefix: 'JV-LOG', correlationId: ctx.req.correlationId,
            lines: [{ account_code: '521012', debit: amt.toFixed(8), description: `Freight ${row.number} → ${row.destination}` }, credit],
          });
          return { set: { freight_journal_id: j?.journalId ?? null }, data: j };
        },
      },
    },
  });

  // Tracking events from staff or a carrier integration: idempotent on (shipment, time, code).
  app.post('/api/log/shipments/:id/events', authenticate, requireAnyPermission(Permission.LOGISTICS_MANAGE), requireModule('LOG'), async (req: Request, res: Response) => {
    const out = await unitOfWork(req, async (ctx) => {
      const s = await loadRow(ctx.tx, 'log_shipments', req.params.id, ctx.org, 'Shipment', true);
      if (['PLANNED', 'CANCELLED', 'DELIVERED'].includes(s.status)) throw new ApiError(409, ErrorCode.INVALID_STATE, `No tracking events on a ${s.status.toLowerCase()} shipment`);
      const at = new Date(String(req.body?.event_at || ''));
      if (Number.isNaN(at.getTime())) throw validationError('event_at must be an ISO date-time', { field: 'event_at' });
      if (at.getTime() > Date.now() + 5 * 60000) throw validationError('event_at cannot be in the future', { field: 'event_at' });
      const code = oneOf(req.body?.code, 'code', CODES.filter((c) => c !== 'DELIVERED' && c !== 'BOOKED'));
      const ev = await addEvent(ctx, s.id, { event_at: at.toISOString(), code, location: req.body?.location ? str(req.body.location, 'location', { max: 255 }) : null, note: req.body?.note ? str(req.body.note, 'note', { max: 2000 }) : null, source: req.body?.source === 'CARRIER' ? 'CARRIER' : 'MANUAL' });
      if (ev) {
        await audit(ctx, 'LOGISTICS_TRACKING_EVENT', 'LOGISTICS_SHIPMENT', s.id, undefined, { code, event_at: ev.event_at });
        await emit(ctx, 'LOGISTICS_TRACKING_EVENT', { id: s.id, number: s.number, code, location: ev.location });
      }
      return { event: ev, replayed: !ev };
    });
    return ok(req, res, out, out.replayed ? 200 : 201);
  });

  app.get('/api/log/summary', authenticate, requireAnyPermission(...VIEW), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const r = (
      await db.query(
        `SELECT COUNT(*) FILTER (WHERE status IN ('BOOKED','IN_TRANSIT'))::int in_flight, COUNT(*) FILTER (WHERE status = 'EXCEPTION')::int exceptions,
          COUNT(*) FILTER (WHERE status NOT IN ('DELIVERED','CANCELLED') AND promised_date < CURRENT_DATE)::int late,
          COUNT(*) FILTER (WHERE status = 'DELIVERED' AND promised_date IS NOT NULL)::int delivered_promised,
          COUNT(*) FILTER (WHERE status = 'DELIVERED' AND promised_date IS NOT NULL AND (delivered_at AT TIME ZONE 'Asia/Karachi')::date <= promised_date)::int delivered_on_time,
          COALESCE(SUM(freight_amount) FILTER (WHERE freight_journal_id IS NOT NULL AND created_at >= date_trunc('month', NOW())),0)::text freight_mtd,
          COUNT(*) FILTER (WHERE freight_journal_id IS NULL AND freight_amount > 0 AND status <> 'CANCELLED')::int freight_unposted
         FROM log_shipments WHERE organization_id = $1`,
        [org],
      )
    ).rows[0];
    return ok(req, res, { ...r, otd_pct: r.delivered_promised ? ((r.delivered_on_time / r.delivered_promised) * 100).toFixed(1) : null });
  });
}
