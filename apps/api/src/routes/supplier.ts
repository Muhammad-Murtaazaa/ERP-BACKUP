/**
 * SUP — supplier qualification & performance. A supplier profile moves PROSPECT → UNDER_REVIEW →
 * APPROVED (approver ≠ submitter, every required certificate present and unexpired) and can be
 * SUSPENDED / BLOCKED; procurement refuses POs to blocked, suspended or rejected suppliers.
 * Scorecards weight quality 40 / delivery 30 / price 20 / service 10; delivery can be derived
 * from actual goods-receipt dates versus PO expected dates.
 */
import type { Express, Request, Response } from 'express';
import { Permission, ErrorCode } from '@omnysync/contracts';
import { db, authenticate, requireAnyPermission } from '../context.js';
import type { DbClient } from '@omnysync/platform';
import { ok } from '../lib/http.js';
import { ApiError, validationError } from '../lib/errors.js';
import { defineResource, loadRow } from '../lib/resource.js';
import { todayIso, toIsoDate } from '../lib/validate.js';

const VIEW = [Permission.SUPPLIER_VIEW, Permission.SUPPLIER_MANAGE, Permission.SUPPLIER_APPROVE];
export const WEIGHTS = { quality: 40, delivery: 30, price: 20, service: 10 };

export function weightedScore(s: { quality: number; delivery: number; price: number; service: number }) {
  const v = (s.quality * WEIGHTS.quality + s.delivery * WEIGHTS.delivery + s.price * WEIGHTS.price + s.service * WEIGHTS.service) / 100;
  const score = Math.round(v * 100) / 100;
  const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : 'D';
  return { weighted_score: score.toFixed(2), grade };
}

/** Procurement guard (called from PO creation). Suppliers without a profile remain usable. */
export async function assertSupplierUsable(q: DbClient, org: string, partyId: string) {
  const r = await q.query(`SELECT status, status_reason FROM sup_profiles WHERE organization_id = $1 AND party_id = $2`, [org, partyId]);
  const p = r.rows[0];
  if (p && ['BLOCKED', 'SUSPENDED', 'REJECTED'].includes(p.status)) {
    throw new ApiError(409, ErrorCode.INVALID_STATE, `Supplier is ${p.status.toLowerCase()}${p.status_reason ? `: ${p.status_reason}` : ''} — purchase orders are not allowed`, { field: 'party_id', supplier_status: p.status });
  }
}

async function missingCertificates(q: DbClient, profile: any, onDate: string) {
  const required: string[] = (typeof profile.required_certificates === 'string' ? JSON.parse(profile.required_certificates) : profile.required_certificates) || [];
  const have = (await q.query(`SELECT cert_type FROM sup_certificates WHERE profile_id = $1 AND status = 'ACTIVE' AND (expires_on IS NULL OR expires_on >= $2)`, [profile.id, onDate])).rows.map((r: any) => r.cert_type);
  return required.filter((c) => !have.includes(c));
}

/** On-time delivery % for a supplier in a YYYY-MM period (first receipt date ≤ PO expected date). */
export async function deliveryPerformance(q: DbClient, org: string, partyId: string, period: string) {
  const r = await q.query(
    `SELECT po.id, po.expected_date, MIN(sm.movement_date) AS first_receipt
     FROM purchase_orders po JOIN stock_movements sm ON sm.reference_id = po.id AND sm.reference_type = 'PURCHASE_ORDER' AND sm.movement_type = 'RECEIPT'
     WHERE po.organization_id = $1 AND po.party_id = $2 AND po.expected_date IS NOT NULL AND to_char(po.expected_date, 'YYYY-MM') = $3
     GROUP BY po.id, po.expected_date`,
    [org, partyId, period],
  );
  const total = r.rows.length;
  const onTime = r.rows.filter((x: any) => toIsoDate(x.first_receipt) <= toIsoDate(x.expected_date)).length;
  return { total, onTime, score: total ? Math.round((onTime / total) * 100) : null };
}

/**
 * Quality score from receiving inspections decided in the period (PKT month of the usage decision):
 * quantity-weighted, ACCEPTED = 1, CONDITIONALLY_ACCEPTED = ½, REJECTED = 0.
 */
export async function qualityPerformance(q: DbClient, org: string, partyId: string, period: string) {
  const r = await q.query(
    `SELECT status, quantity::text FROM quality_inspection_lots
     WHERE organization_id = $1 AND party_id = $2 AND status IN ('ACCEPTED','CONDITIONALLY_ACCEPTED','REJECTED')
       AND inspected_at IS NOT NULL AND to_char(inspected_at AT TIME ZONE 'Asia/Karachi', 'YYYY-MM') = $3`,
    [org, partyId, period],
  );
  let total = 0;
  let good = 0;
  for (const l of r.rows) {
    const qn = Number(l.quantity);
    total += qn;
    good += l.status === 'ACCEPTED' ? qn : l.status === 'CONDITIONALLY_ACCEPTED' ? qn / 2 : 0;
  }
  return { lots: r.rows.length, rejected: r.rows.filter((l: any) => l.status === 'REJECTED').length, score: total > 0 ? Math.round((good / total) * 100) : null };
}

/** Price score from a price index (supplier ÷ market): at or below market = 100, each 1% above costs 2 points. */
export function priceScoreFromIndex(index: number): number {
  return Math.max(0, Math.min(100, Math.round(100 - (index - 1) * 200)));
}

/**
 * Price index for a supplier's POs dated in a YYYY-MM period: quantity-weighted supplier price ÷ the
 * quantity-weighted average price paid to all suppliers for the same items over the trailing 12 months.
 */
export async function pricePerformance(q: DbClient, org: string, partyId: string, period: string) {
  const end = `${period}-01`;
  const r = await q.query(
    `WITH mine AS (
       SELECT l.item_id, SUM(l.quantity) qty, SUM(l.quantity * l.unit_price) val
       FROM purchase_order_lines l JOIN purchase_orders po ON po.id = l.purchase_order_id
       WHERE po.organization_id = $1 AND po.party_id = $2 AND po.status NOT IN ('DRAFT','CANCELLED') AND to_char(po.po_date, 'YYYY-MM') = $3
       GROUP BY l.item_id),
     market AS (
       SELECT l.item_id, SUM(l.quantity * l.unit_price) / NULLIF(SUM(l.quantity), 0) avg_price
       FROM purchase_order_lines l JOIN purchase_orders po ON po.id = l.purchase_order_id
       WHERE po.organization_id = $1 AND po.status NOT IN ('DRAFT','CANCELLED')
         AND po.po_date >= ($4::date - INTERVAL '11 months') AND po.po_date < ($4::date + INTERVAL '1 month')
       GROUP BY l.item_id)
     SELECT COALESCE(SUM(m.val), 0)::text paid, COALESCE(SUM(m.qty * k.avg_price), 0)::text benchmark, COUNT(*)::int items
     FROM mine m JOIN market k ON k.item_id = m.item_id`,
    [org, partyId, period, end],
  );
  const row = r.rows[0];
  const bench = Number(row.benchmark);
  if (!row.items || !(bench > 0)) return { index: null as number | null, score: null as number | null, items: 0 };
  const index = Math.round((Number(row.paid) / bench) * 10000) / 10000;
  return { index, score: priceScoreFromIndex(index), items: row.items };
}

export function registerSupplierRoutes(app: Express): void {
  defineResource(app, {
    path: '/api/sup/profiles',
    table: 'sup_profiles',
    label: 'Supplier profile',
    event: 'SUPPLIER',
    module: 'SUP',
    view: VIEW,
    create: Permission.SUPPLIER_MANAGE,
    update: Permission.SUPPLIER_MANAGE,
    fields: {
      party_id: { type: 'ref', table: 'parties', required: true, label: 'party_id' },
      category: { type: 'enum', values: ['EQUIPMENT', 'SPARE_PARTS', 'REFRIGERANT', 'SUBCONTRACTOR', 'LOGISTICS', 'SERVICES', 'OTHER'], required: true },
      risk_level: { type: 'enum', values: ['LOW', 'MEDIUM', 'HIGH'], default: 'MEDIUM' },
      required_certificates: { type: 'json' },
      contact_name: { type: 'string' },
      notes: { type: 'text' },
    },
    editable: ['risk_level', 'required_certificates', 'contact_name', 'notes', 'category'],
    initialStatus: 'PROSPECT',
    select: `t.*, p.code AS party_code, p.name AS party_name,
      (SELECT COUNT(*)::int FROM sup_certificates c WHERE c.profile_id = t.id AND c.status = 'ACTIVE' AND c.expires_on < CURRENT_DATE + 30) AS certs_expiring,
      (SELECT s.weighted_score FROM sup_scorecards s WHERE s.profile_id = t.id AND s.status = 'FINAL' ORDER BY s.period DESC LIMIT 1) AS latest_score,
      (SELECT s.grade FROM sup_scorecards s WHERE s.profile_id = t.id AND s.status = 'FINAL' ORDER BY s.period DESC LIMIT 1) AS latest_grade`,
    joins: 'JOIN parties p ON p.id = t.party_id',
    search: ['p.name', 'p.code', 'contact_name'],
    filters: ['category', 'risk_level'],
    orderBy: 'p.name',
    detail: async (q, row) => ({
      certificates: (await q.query(`SELECT *, (expires_on IS NOT NULL AND expires_on < CURRENT_DATE) AS expired FROM sup_certificates WHERE profile_id = $1 ORDER BY cert_type`, [row.id])).rows,
      scorecards: (await q.query(`SELECT * FROM sup_scorecards WHERE profile_id = $1 ORDER BY period DESC`, [row.id])).rows,
      missing_certificates: await missingCertificates(q, row, todayIso()),
    }),
    beforeCreate: async (ctx, v) => {
      const p = await loadRow(ctx.tx, 'parties', v.party_id, ctx.org, 'Party');
      if (!['VENDOR', 'BOTH'].includes(p.party_type)) throw validationError('Party is not a vendor', { field: 'party_id' });
      const ex = await ctx.tx.query(`SELECT id FROM sup_profiles WHERE organization_id = $1 AND party_id = $2`, [ctx.org, v.party_id]);
      if (ex.rows[0]) throw new ApiError(409, ErrorCode.DUPLICATE_RESOURCE, 'This vendor already has a supplier profile', { existing_id: ex.rows[0].id });
      if (v.required_certificates) {
        const list = JSON.parse(v.required_certificates);
        const allowed = ['NTN', 'STRN', 'ISO9001', 'ISO14001', 'OEM_AUTHORISATION', 'INSURANCE', 'SAFETY', 'BANK_LETTER', 'OTHER'];
        if (!Array.isArray(list) || list.some((c: unknown) => typeof c !== 'string' || !allowed.includes(c))) throw validationError(`required_certificates must be a list of ${allowed.join(', ')}`, { field: 'required_certificates' });
      }
    },
    commands: {
      submit: { from: ['PROSPECT', 'REJECTED'], to: 'UNDER_REVIEW', permission: Permission.SUPPLIER_MANAGE, run: async (ctx) => ({ set: { submitted_by: ctx.user, status_reason: null } }) },
      approve: {
        from: ['UNDER_REVIEW'],
        to: 'APPROVED',
        permission: Permission.SUPPLIER_APPROVE,
        sodColumn: 'submitted_by',
        run: async (ctx, row) => {
          const missing = await missingCertificates(ctx.tx, row, todayIso());
          if (missing.length) throw new ApiError(409, ErrorCode.CHECKLIST_INCOMPLETE, `Missing or expired certificates: ${missing.join(', ')}`, { missing });
          return { set: { approved_by: ctx.user, approved_at: new Date().toISOString() } };
        },
      },
      reject: { from: ['UNDER_REVIEW'], to: 'REJECTED', permission: Permission.SUPPLIER_APPROVE, fields: { status_reason: { type: 'text', required: true } }, run: async (_c, _r, i) => ({ set: { status_reason: i.status_reason } }) },
      suspend: { from: ['APPROVED'], to: 'SUSPENDED', permission: Permission.SUPPLIER_APPROVE, fields: { status_reason: { type: 'text', required: true } }, run: async (_c, _r, i) => ({ set: { status_reason: i.status_reason } }) },
      block: { from: ['PROSPECT', 'UNDER_REVIEW', 'APPROVED', 'SUSPENDED'], to: 'BLOCKED', permission: Permission.SUPPLIER_APPROVE, fields: { status_reason: { type: 'text', required: true } }, run: async (_c, _r, i) => ({ set: { status_reason: i.status_reason } }) },
      reinstate: {
        from: ['SUSPENDED', 'BLOCKED'],
        to: 'UNDER_REVIEW',
        permission: Permission.SUPPLIER_APPROVE,
        fields: { status_reason: { type: 'text', required: true } },
        run: async (ctx, _r, i) => ({ set: { status_reason: i.status_reason, submitted_by: ctx.user } }),
      },
    },
  });

  defineResource(app, {
    path: '/api/sup/certificates',
    table: 'sup_certificates',
    label: 'Certificate',
    event: 'SUPPLIER_CERT',
    module: 'SUP',
    view: VIEW,
    create: Permission.SUPPLIER_MANAGE,
    update: Permission.SUPPLIER_MANAGE,
    fields: {
      profile_id: { type: 'ref', table: 'sup_profiles', required: true, label: 'profile_id' },
      cert_type: { type: 'enum', values: ['NTN', 'STRN', 'ISO9001', 'ISO14001', 'OEM_AUTHORISATION', 'INSURANCE', 'SAFETY', 'BANK_LETTER', 'OTHER'], required: true },
      reference: { type: 'string', required: true, max: 120 },
      issued_on: { type: 'date' },
      expires_on: { type: 'date' },
    },
    editable: ['reference', 'expires_on'],
    editableIn: ['ACTIVE'],
    initialStatus: 'ACTIVE',
    select: `t.*, p.name AS supplier_name, (t.expires_on IS NOT NULL AND t.expires_on < CURRENT_DATE) AS expired, (t.expires_on - CURRENT_DATE) AS days_to_expiry`,
    joins: 'JOIN sup_profiles sp ON sp.id = t.profile_id JOIN parties p ON p.id = sp.party_id',
    search: ['reference', 'p.name'],
    filters: ['profile_id', 'cert_type'],
    orderBy: 't.expires_on NULLS LAST',
    beforeCreate: async (_ctx, v) => {
      if (v.issued_on && v.expires_on && v.expires_on < v.issued_on) throw validationError('expires_on must be on or after issued_on', { field: 'expires_on' });
    },
    commands: { revoke: { from: ['ACTIVE'], to: 'REVOKED', permission: Permission.SUPPLIER_MANAGE } },
  });

  defineResource(app, {
    path: '/api/sup/scorecards',
    table: 'sup_scorecards',
    label: 'Scorecard',
    event: 'SUPPLIER_SCORECARD',
    module: 'SUP',
    view: VIEW,
    create: Permission.SUPPLIER_MANAGE,
    update: Permission.SUPPLIER_MANAGE,
    fields: {
      profile_id: { type: 'ref', table: 'sup_profiles', required: true, label: 'profile_id' },
      period: { type: 'string', required: true, max: 7, pattern: /^\d{4}-(0[1-9]|1[0-2])$/ },
      quality_score: { type: 'int', min: 0, max: 100 },
      delivery_score: { type: 'int', min: 0, max: 100 },
      price_score: { type: 'int', min: 0, max: 100 },
      service_score: { type: 'int', required: true, min: 0, max: 100 },
      comments: { type: 'text' },
    },
    editable: ['quality_score', 'delivery_score', 'price_score', 'service_score', 'comments'],
    editableIn: ['DRAFT'],
    initialStatus: 'DRAFT',
    select: `t.*, p.name AS supplier_name`,
    joins: 'JOIN sup_profiles sp ON sp.id = t.profile_id JOIN parties p ON p.id = sp.party_id',
    search: ['p.name', 'period'],
    filters: ['profile_id', 'grade'],
    orderBy: 't.period DESC, t.weighted_score DESC',
    beforeCreate: async (ctx, v) => {
      const prof = await loadRow(ctx.tx, 'sup_profiles', v.profile_id, ctx.org, 'Supplier profile');
      const dup = await ctx.tx.query(`SELECT id FROM sup_scorecards WHERE profile_id = $1 AND period = $2`, [v.profile_id, v.period]);
      if (dup.rows[0]) throw new ApiError(409, ErrorCode.DUPLICATE_RESOURCE, `A scorecard for ${v.period} already exists`, { existing_id: dup.rows[0].id });
      const perf = await deliveryPerformance(ctx.tx, ctx.org, prof.party_id, v.period);
      if (v.delivery_score == null) {
        if (perf.score == null) throw validationError('No receipts against POs due in this period — enter a delivery score', { field: 'delivery_score' });
        v.delivery_score = perf.score;
      }
      const qual = await qualityPerformance(ctx.tx, ctx.org, prof.party_id, v.period);
      if (v.quality_score == null) {
        if (qual.score == null) throw validationError('No receiving inspections decided for this supplier in this period — enter a quality score', { field: 'quality_score' });
        v.quality_score = qual.score;
      }
      v.inspected_lots = qual.lots;
      v.rejected_lots = qual.rejected;
      const price = await pricePerformance(ctx.tx, ctx.org, prof.party_id, v.period);
      if (v.price_score == null) {
        if (price.score == null) throw validationError('No purchase orders in this period to benchmark — enter a price score', { field: 'price_score' });
        v.price_score = price.score;
      }
      v.price_index = price.index == null ? null : price.index.toFixed(4);
      v.on_time_receipts = perf.onTime;
      v.total_receipts = perf.total;
      Object.assign(v, weightedScore({ quality: v.quality_score, delivery: v.delivery_score, price: v.price_score, service: v.service_score }));
    },
    beforeUpdate: async (_ctx, row, v) => {
      Object.assign(v, weightedScore({ quality: v.quality_score ?? row.quality_score, delivery: v.delivery_score ?? row.delivery_score, price: v.price_score ?? row.price_score, service: v.service_score ?? row.service_score }));
    },
    commands: { finalise: { from: ['DRAFT'], to: 'FINAL', permission: Permission.SUPPLIER_MANAGE } },
  });

  app.get('/api/sup/summary', authenticate, requireAnyPermission(...VIEW), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const s = (await db.query(`SELECT status, COUNT(*)::int n FROM sup_profiles WHERE organization_id = $1 GROUP BY status`, [org])).rows;
    const exp = (await db.query(`SELECT COUNT(*) FILTER (WHERE expires_on < CURRENT_DATE)::int expired, COUNT(*) FILTER (WHERE expires_on >= CURRENT_DATE AND expires_on < CURRENT_DATE + 30)::int expiring FROM sup_certificates WHERE organization_id = $1 AND status = 'ACTIVE'`, [org])).rows[0];
    const avg = (await db.query(`SELECT ROUND(AVG(weighted_score), 1)::text avg FROM sup_scorecards WHERE organization_id = $1 AND status = 'FINAL'`, [org])).rows[0].avg;
    return ok(req, res, { by_status: Object.fromEntries(s.map((r: any) => [r.status, r.n])), certificates: exp, average_score: avg });
  });
}
