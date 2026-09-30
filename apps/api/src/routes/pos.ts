import type { Express, Request, Response } from 'express';
import crypto from 'node:crypto';
import {
  Money,
  parseScan,
  priceCart,
  settleTenders,
  computeLineRefund,
  allocateRefundToTenders,
  countDenominations,
  expectedDrawer,
  drawerVariance,
  pointsEarned,
  pointsForAmount,
  redemptionValue,
  DEFAULT_LOYALTY,
  DEFAULT_SCALE_CONFIG,
  TENDER_TYPES,
  type CartLineInput,
  type TenderInput,
  type TenderType,
  type PostingIntentLine,
} from '@omnysync/financial-engine';
import { AccountingPurpose, ErrorCode, Permission } from '@omnysync/contracts';
import { AuthService } from '@omnysync/platform';
import { db, auditLogger, outboxService, authenticate, requirePermission } from '../context.js';
import { ok } from '../lib/http.js';
import { ApiError, invalidState, notFound, validationError } from '../lib/errors.js';
import { arrayOf, bool, dateOnly, decimal, oneOf, optionalStr, optionalUuid, str, todayIso, toIsoDate, uuid } from '../lib/validate.js';
import { assertOrgRef, requireOrgRow } from '../lib/scope.js';
import { transition } from '../lib/state.js';
import { postJournal } from '../lib/posting.js';
import { nextDocumentNumber } from '../lib/numbering.js';
import { defaultWarehouseId, lockItems, onHand, postStockMovement } from '../lib/stock.js';
import {
  activePromotions,
  engine,
  isPosManager,
  newCode,
  posEvent,
  POS_ACTIONS,
  recentPinFailures,
  renderReceipt,
  requireApproval,
  verifyManagerPin,
  MAX_PIN_FAILURES,
  LOCK_MINUTES,
} from '../lib/pos-support.js';

/**
 * Retail POS (big-box checkout). Every money path is decimal-exact via the retail
 * engine; each sale / void / return / cash movement is one unit of work that
 * writes the source rows, stock facts, the GL journal (postJournal), POS audit
 * events and the platform audit log atomically.
 *
 * GL model (decisions/ADR-0102-pos-retail-accounting.md):
 *  sale:   Dr 111004 cash clearing | 111005 card/wallet | 211007 gift/store credit | 211008 loyalty
 *          Dr 411004 discounts & promotions; Cr item sales accounts (gross); Cr 212001 output tax
 *          Dr/Cr 911002 cash rounding; Dr COGS / Cr inventory at standard cost
 *  close:  Dr 111001 (counted - float) / Cr 111004 (expected - float) / 521008 short-over
 */

export const TENDER_ACCOUNT: Record<TenderType, string> = {
  CASH: '111004',
  CARD: '111005',
  WALLET: '111005',
  GIFT_CARD: '211007',
  STORE_CREDIT: '211007',
  LOYALTY: '211008',
};

const signed = (code: string, amount: Money, description: string): PostingIntentLine =>
  amount.isNegative() ? { account_code: code, credit: amount.abs().toFixed(8), description } : { account_code: code, debit: amount.toFixed(8), description };

const f2 = (v: unknown) => new Money(String(v ?? '0')).toFixed(2);

async function audit(req: Request, tx: any, action: string, type: string, id: string, after?: unknown, before?: unknown) {
  await auditLogger.record(
    {
      organization_id: req.session!.organization_id,
      user_id: req.session!.user_id,
      action,
      entity_type: type,
      entity_id: id,
      before_state: before as any,
      after_state: after as any,
      correlation_id: req.correlationId,
    },
    tx,
  );
}

async function loadSession(q: any, req: Request, id: unknown, opts: { forUpdate?: boolean; mustBeOpen?: boolean } = {}) {
  const s = await requireOrgRow(q, 'pos_sessions', id, req.session!.organization_id, 'POS session', { forUpdate: opts.forUpdate });
  if (opts.mustBeOpen !== false && s.status !== 'OPEN') throw new ApiError(409, ErrorCode.POS_SESSION_CLOSED, 'POS session is closed');
  // Cashier accountability: only the shift owner (or a POS manager) transacts on a shift.
  if (s.cashier_id !== req.session!.user_id && !isPosManager(req)) {
    throw new ApiError(403, ErrorCode.UNAUTHORIZED, 'This shift belongs to another cashier');
  }
  const reg = await requireOrgRow(q, 'pos_registers', s.register_id, req.session!.organization_id, 'POS register');
  return { session: s, register: reg, businessDate: toIsoDate(s.business_date) || todayIso() };
}

async function stockWarehouse(q: any, org: string, register: any): Promise<string | null> {
  return register.warehouse_id || (await defaultWarehouseId(q, org));
}

function drawerOf(s: any): string {
  return expectedDrawer({
    opening_float: s.opening_float,
    cash_sales: s.cash_sales_total,
    cash_refunds: s.cash_refunds_total,
    paid_in: s.paid_in_total,
    paid_out: s.paid_out_total,
    safe_drops: s.safe_drop_total,
  });
}

async function sessionTotals(q: any, sessionId: string) {
  const s = (await q.query(`SELECT * FROM pos_sessions WHERE id = $1`, [sessionId])).rows[0];
  const byTender = await q.query(
    `SELECT t.tender_type, COALESCE(SUM(t.applied_amount),0)::text AS amount, COUNT(*)::int AS n
     FROM pos_tenders t JOIN pos_orders o ON o.id = t.order_id
     WHERE o.session_id = $1 AND o.status <> 'VOIDED' GROUP BY t.tender_type ORDER BY t.tender_type`,
    [sessionId],
  );
  const orders = await q.query(
    `SELECT COUNT(*) FILTER (WHERE status <> 'VOIDED')::int AS sales_count,
            COUNT(*) FILTER (WHERE status = 'VOIDED')::int AS void_count,
            COALESCE(SUM(subtotal) FILTER (WHERE status <> 'VOIDED'),0)::text AS gross,
            COALESCE(SUM(discount_amount) FILTER (WHERE status <> 'VOIDED'),0)::text AS discounts,
            COALESCE(SUM(tax_amount) FILTER (WHERE status <> 'VOIDED'),0)::text AS tax,
            COALESCE(SUM(total_amount + cash_rounding) FILTER (WHERE status <> 'VOIDED'),0)::text AS total
     FROM pos_orders WHERE session_id = $1`,
    [sessionId],
  );
  const returns = await q.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(total_amount),0)::text AS total FROM pos_returns WHERE session_id = $1`, [sessionId]);
  const events = await q.query(`SELECT event_type, COUNT(*)::int AS n FROM pos_audit_events WHERE session_id = $1 GROUP BY event_type ORDER BY event_type`, [sessionId]);
  const o = orders.rows[0];
  return {
    session_id: sessionId,
    status: s.status,
    business_date: toIsoDate(s.business_date),
    cashier_name: s.cashier_name,
    opened_at: s.opened_at,
    closed_at: s.closed_at,
    sales_count: o.sales_count,
    void_count: o.void_count,
    gross_sales: f2(o.gross),
    discounts: f2(o.discounts),
    tax: f2(o.tax),
    net_sales_incl_tax: f2(o.total),
    returns_count: returns.rows[0].n,
    returns_total: f2(returns.rows[0].total),
    tenders: byTender.rows.map((r: any) => ({ type: r.tender_type, amount: f2(r.amount), count: r.n })),
    drawer: {
      opening_float: f2(s.opening_float),
      cash_sales: f2(s.cash_sales_total),
      cash_refunds: f2(s.cash_refunds_total),
      paid_in: f2(s.paid_in_total),
      paid_out: f2(s.paid_out_total),
      safe_drops: f2(s.safe_drop_total),
      expected_cash: drawerOf(s),
    },
    events: Object.fromEntries(events.rows.map((e: any) => [e.event_type, e.n])),
  };
}

interface NormalizedLine {
  item_id: string;
  quantity: string;
  unit_price: string | null;
  override_price: string | null;
  approval_id: string | null;
  line_discount: { type: 'PERCENT' | 'AMOUNT'; value: string } | null;
  scanned_code: string | null;
  fixed_line_total: string | null;
}

const present = (v: unknown) => v !== undefined && v !== null && v !== '';

function parseDiscount(v: any, field: string) {
  if (!v || !present(v.value)) return null;
  const type = oneOf(v.type, `${field}.type`, ['PERCENT', 'AMOUNT'] as const, 'AMOUNT');
  const value = decimal(v.value, `${field}.value`, { sign: 'nonNegative' });
  if (type === 'PERCENT' && new Money(value).gt(100)) throw validationError('Percent discount cannot exceed 100', { field });
  return { type, value };
}

function normalizeLines(body: any): NormalizedLine[] {
  const raw = arrayOf<any>(body.lines ?? body.items, 'lines', { min: 1, max: 500 });
  return raw.map((l, i) => ({
    item_id: uuid(l.item_id, `lines[${i}].item_id`),
    quantity: decimal(l.quantity, `lines[${i}].quantity`, { sign: 'positive', scale: 3 }),
    unit_price: present(l.unit_price) ? decimal(l.unit_price, `lines[${i}].unit_price`, { sign: 'nonNegative' }) : null,
    override_price: present(l.override_price) ? decimal(l.override_price, `lines[${i}].override_price`, { sign: 'nonNegative' }) : null,
    approval_id: optionalUuid(l.approval_id, `lines[${i}].approval_id`),
    line_discount: parseDiscount(l.line_discount, `lines[${i}].line_discount`),
    scanned_code: optionalStr(l.scanned_code, `lines[${i}].scanned_code`, 64),
    fixed_line_total: present(l.fixed_line_total) ? decimal(l.fixed_line_total, `lines[${i}].fixed_line_total`, { sign: 'positive' }) : null,
  }));
}

function normalizeTenders(body: any, grandTotal: string): TenderInput[] {
  if (Array.isArray(body.tenders) && body.tenders.length > 0) {
    return body.tenders.slice(0, 10).map((t: any, i: number) => ({
      type: oneOf(t.type, `tenders[${i}].type`, TENDER_TYPES as unknown as readonly TenderType[]),
      amount: decimal(t.amount, `tenders[${i}].amount`, { sign: 'positive' }),
      reference: optionalStr(t.reference, `tenders[${i}].reference`, 128),
    }));
  }
  // Legacy single-method payload (payment_method + cash_tendered).
  const method = oneOf(body.payment_method, 'payment_method', ['CASH', 'CARD', 'WALLET'] as const, 'CASH');
  if (new Money(grandTotal).isZero()) return [];
  if (method === 'CASH') {
    const cash = present(body.cash_tendered) ? decimal(body.cash_tendered, 'cash_tendered', { sign: 'nonNegative' }) : grandTotal;
    if (new Money(cash).isZero()) throw new ApiError(422, ErrorCode.INSUFFICIENT_PAYMENT_TENDER, 'Cash tendered is less than order total');
    return [{ type: 'CASH', amount: cash }];
  }
  return [{ type: method, amount: grandTotal, reference: optionalStr(body.card_reference, 'card_reference', 128) }];
}

/** Locks and validates a stored-value account (gift card / store credit). */
async function lockStoredValue(q: any, org: string, kind: 'GIFT_CARD' | 'STORE_CREDIT', code: string | null | undefined) {
  if (!code) throw validationError(`${kind} tender requires the card/credit code as reference`, { field: 'reference' });
  const r = await q.query(`SELECT * FROM pos_stored_value_accounts WHERE organization_id = $1 AND kind = $2 AND code = $3 FOR UPDATE`, [org, kind, code.trim().toUpperCase()]);
  if (r.rows.length === 0 || !r.rows[0].is_active) throw notFound(kind === 'GIFT_CARD' ? 'Gift card' : 'Store credit');
  return r.rows[0];
}

async function storedValueMove(q: any, req: Request, account: any, amount: Money, refType: string, refId: string) {
  const upd = await q.query(`UPDATE pos_stored_value_accounts SET balance = balance + $1 WHERE id = $2 AND balance + $1 >= 0 RETURNING balance`, [amount.toFixed(8), account.id]);
  if (upd.rows.length === 0) throw new ApiError(422, ErrorCode.INSUFFICIENT_BALANCE, `Insufficient ${account.kind === 'GIFT_CARD' ? 'gift card' : 'store credit'} balance`);
  await q.query(`INSERT INTO pos_stored_value_ledger (account_id, amount, reference_type, reference_id, created_by) VALUES ($1,$2,$3,$4,$5)`, [
    account.id,
    amount.toFixed(8),
    refType,
    refId,
    req.session!.user_id,
  ]);
  return f2(upd.rows[0].balance);
}

async function loyaltyMove(q: any, org: string, customerId: string, points: number, refType: string, refId: string) {
  if (points === 0) return;
  await q.query(
    `INSERT INTO pos_loyalty_accounts (organization_id, customer_id, points_balance, lifetime_points) VALUES ($1,$2,0,0) ON CONFLICT (organization_id, customer_id) DO NOTHING`,
    [org, customerId],
  );
  const upd = await q.query(
    `UPDATE pos_loyalty_accounts SET points_balance = points_balance + $1, lifetime_points = lifetime_points + GREATEST($1, 0)
     WHERE organization_id = $2 AND customer_id = $3 AND points_balance + $1 >= 0 RETURNING points_balance`,
    [points, org, customerId],
  );
  if (upd.rows.length === 0) throw new ApiError(422, ErrorCode.INSUFFICIENT_BALANCE, 'Insufficient loyalty points');
  await q.query(`INSERT INTO pos_loyalty_ledger (organization_id, customer_id, points, reference_type, reference_id) VALUES ($1,$2,$3,$4,$5)`, [org, customerId, points, refType, refId]);
}

async function loadOrderBundle(q: any, org: string, orderId: string) {
  const o = await q.query(
    `SELECT o.*, p.name AS customer_name, s.cashier_name FROM pos_orders o
     JOIN pos_sessions s ON s.id = o.session_id LEFT JOIN parties p ON p.id = o.customer_id
     WHERE o.id::text = $1 AND o.organization_id = $2`,
    [orderId, org],
  );
  if (o.rows.length === 0) throw notFound('POS order');
  const lines = await q.query(`SELECT * FROM pos_order_lines WHERE order_id = $1 ORDER BY line_number NULLS LAST, created_at`, [o.rows[0].id]);
  const tenders = await q.query(`SELECT * FROM pos_tenders WHERE order_id = $1 ORDER BY created_at, id`, [o.rows[0].id]);
  const register = (await q.query(`SELECT r.* FROM pos_registers r JOIN pos_sessions s ON s.register_id = r.id WHERE s.id = $1`, [o.rows[0].session_id])).rows[0];
  return { order: o.rows[0], lines: lines.rows, tenders: tenders.rows, register };
}

export function registerPosRoutes(app: Express): void {
  const terminal = requirePermission(Permission.POS_TERMINAL);
  const manage = requirePermission(Permission.POS_REGISTER_MANAGE);
  const org = (req: Request) => req.session!.organization_id;

  // ------------------------------------------------------------------ registers
  app.get('/api/pos/registers', authenticate, terminal, async (req: Request, res: Response) => {
    const r = await db.query(
      `SELECT pr.*, w.name AS warehouse_name,
         (SELECT row_to_json(x) FROM (SELECT ps.id, ps.cashier_id, ps.cashier_name, ps.opened_at FROM pos_sessions ps
            WHERE ps.register_id = pr.id AND ps.status = 'OPEN' LIMIT 1) x) AS open_session
       FROM pos_registers pr LEFT JOIN warehouses w ON w.id = pr.warehouse_id
       WHERE pr.organization_id = $1 ORDER BY pr.register_code ASC`,
      [org(req)],
    );
    return ok(req, res, r.rows);
  });

  const registerFields = async (req: Request, body: any) => {
    await assertOrgRef(db, 'warehouses', body.warehouse_id, org(req), 'warehouse_id');
    const pct = (v: unknown, field: string, dflt: string) => {
      const d = present(v) ? decimal(v, field, { sign: 'nonNegative' }) : dflt;
      if (new Money(d).gt(100)) throw validationError(`${field} cannot exceed 100`, { field });
      return new Money(d).toFixed(4);
    };
    return {
      warehouse_id: optionalUuid(body.warehouse_id, 'warehouse_id'),
      default_tax_rate: pct(body.default_tax_rate, 'default_tax_rate', '0'),
      allow_negative_stock: bool(body.allow_negative_stock, false),
      cash_rounding_increment: new Money(present(body.cash_rounding_increment) ? decimal(body.cash_rounding_increment, 'cash_rounding_increment', { sign: 'nonNegative' }) : '0').toFixed(2),
      max_cashier_discount_percent: pct(body.max_cashier_discount_percent, 'max_cashier_discount_percent', '10'),
      receipt_header: optionalStr(body.receipt_header, 'receipt_header', 500),
      receipt_footer: optionalStr(body.receipt_footer, 'receipt_footer', 500),
    };
  };

  app.post('/api/pos/registers', authenticate, manage, async (req: Request, res: Response) => {
    const register_code = str(req.body.register_code, 'register_code', { max: 32 });
    const name = str(req.body.name, 'name', { max: 255 });
    const f = await registerFields(req, req.body);
    await assertOrgRef(db, 'accounts', req.body.cash_account_id, org(req), 'cash_account_id');
    await assertOrgRef(db, 'accounts', req.body.card_clearing_account_id, org(req), 'card_clearing_account_id');
    const id = crypto.randomUUID();
    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO pos_registers (id, register_code, name, warehouse_id, cash_account_id, card_clearing_account_id, organization_id,
           default_tax_rate, allow_negative_stock, cash_rounding_increment, max_cashier_discount_percent, receipt_header, receipt_footer)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [id, register_code, name, f.warehouse_id, req.body.cash_account_id || null, req.body.card_clearing_account_id || null, org(req),
          f.default_tax_rate, f.allow_negative_stock, f.cash_rounding_increment, f.max_cashier_discount_percent, f.receipt_header, f.receipt_footer],
      );
      await audit(req, tx, 'POS_REGISTER_CREATED', 'POS_REGISTER', id, { register_code, name, ...f });
    });
    return ok(req, res, { id, register_code, name, ...f }, 201);
  });

  app.post('/api/pos/registers/:id', authenticate, manage, async (req: Request, res: Response) => {
    const before = await requireOrgRow(db, 'pos_registers', req.params.id, org(req), 'POS register');
    const f = await registerFields(req, { ...before, ...req.body });
    const name = present(req.body.name) ? str(req.body.name, 'name', { max: 255 }) : before.name;
    const is_active = req.body.is_active !== undefined ? bool(req.body.is_active, true) : before.is_active;
    await db.transaction(async (tx) => {
      await tx.query(
        `UPDATE pos_registers SET name=$1, warehouse_id=$2, default_tax_rate=$3, allow_negative_stock=$4, cash_rounding_increment=$5,
           max_cashier_discount_percent=$6, receipt_header=$7, receipt_footer=$8, is_active=$9 WHERE id=$10`,
        [name, f.warehouse_id, f.default_tax_rate, f.allow_negative_stock, f.cash_rounding_increment, f.max_cashier_discount_percent, f.receipt_header, f.receipt_footer, is_active, before.id],
      );
      await audit(req, tx, 'POS_REGISTER_UPDATED', 'POS_REGISTER', before.id, { name, is_active, ...f }, before);
    });
    return ok(req, res, { id: before.id, name, is_active, ...f });
  });

  // ------------------------------------------------------------------ catalogue & lookup (offline cache source)
  app.get('/api/pos/catalog', authenticate, terminal, async (req: Request, res: Response) => {
    const register = req.query.register_id ? await requireOrgRow(db, 'pos_registers', String(req.query.register_id), org(req), 'POS register') : null;
    const wh = register ? await stockWarehouse(db, org(req), register) : await defaultWarehouseId(db, org(req));
    const items = await db.query(
      `SELECT i.id, i.code, i.name, i.item_type, i.uom, i.unit_price::text, i.tax_rate::text, i.barcode, i.plu_code, i.is_weighed, i.category,
         COALESCE((SELECT SUM(sm.quantity) FROM stock_movements sm WHERE sm.item_id = i.id AND sm.organization_id = i.organization_id
           AND (sm.location_id = $2 OR (sm.location_id IS NULL AND EXISTS (SELECT 1 FROM warehouses w WHERE w.id = $2 AND w.is_default)))), 0)::text AS on_hand
       FROM items i WHERE i.organization_id = $1 AND i.is_active = true AND i.item_type <> 'NON_INVENTORY'
       ORDER BY i.name ASC`,
      [org(req), wh],
    );
    const promotions = await activePromotions(db, org(req), todayIso());
    return ok(req, res, { items: items.rows, promotions, loyalty: DEFAULT_LOYALTY, scale_barcodes: DEFAULT_SCALE_CONFIG, register, generated_at: new Date().toISOString() });
  });

  app.get('/api/pos/lookup', authenticate, terminal, async (req: Request, res: Response) => {
    const code = str(req.query.code, 'code', { max: 64 }).trim();
    const parsed = parseScan(code);
    const sel = `SELECT id, code, name, item_type, uom, unit_price::text, tax_rate::text, barcode, plu_code, is_weighed, category FROM items WHERE organization_id = $1 AND is_active = true`;
    if (parsed.kind === 'EMBEDDED_PRICE' || parsed.kind === 'EMBEDDED_WEIGHT') {
      const r = await db.query(`${sel} AND plu_code = $2`, [org(req), parsed.plu]);
      if (r.rows.length === 0) throw notFound(`Item for PLU ${parsed.plu}`);
      const item = r.rows[0];
      if (parsed.kind === 'EMBEDDED_WEIGHT') return ok(req, res, { item, quantity: parsed.quantity, scan: parsed });
      // Price label: the label total is authoritative; quantity is derived for the stock ledger.
      const qty = new Money(item.unit_price).isPositive() ? new Money(parsed.price).div(item.unit_price).round(3).toFixed(3) : '1.000';
      return ok(req, res, { item, quantity: qty, fixed_line_total: parsed.price, scan: parsed });
    }
    const r = await db.query(`${sel} AND (barcode = $2 OR upper(code) = upper($2) OR plu_code = $2) ORDER BY (barcode = $2) DESC LIMIT 1`, [org(req), code]);
    if (r.rows.length === 0) throw notFound(`Item for code ${code}`);
    return ok(req, res, { item: r.rows[0], quantity: '1', scan: parsed });
  });

  // ------------------------------------------------------------------ customers & loyalty
  app.get('/api/pos/customers', authenticate, terminal, async (req: Request, res: Response) => {
    const q = String(req.query.q || '').trim().slice(0, 64);
    const r = await db.query(
      `SELECT p.id, p.code, p.name, p.phone, p.email, COALESCE(la.points_balance,0) AS points_balance, COALESCE(la.tier,'STANDARD') AS tier,
         COALESCE((SELECT SUM(balance) FROM pos_stored_value_accounts sv WHERE sv.customer_id = p.id AND sv.kind = 'STORE_CREDIT'),0)::text AS store_credit
       FROM parties p LEFT JOIN pos_loyalty_accounts la ON la.customer_id = p.id AND la.organization_id = p.organization_id
       WHERE p.organization_id = $1 AND p.party_type IN ('CUSTOMER','BOTH') AND p.is_active = true
         AND ($2 = '' OR p.name ILIKE '%' || $2 || '%' OR p.code ILIKE '%' || $2 || '%' OR p.phone ILIKE '%' || $2 || '%')
       ORDER BY p.name LIMIT 25`,
      [org(req), q],
    );
    return ok(req, res, r.rows);
  });

  app.post('/api/pos/customers', authenticate, terminal, async (req: Request, res: Response) => {
    const name = str(req.body.name, 'name', { max: 255 });
    const phone = str(req.body.phone, 'phone', { max: 32, pattern: /^[0-9+\-\s()]{7,32}$/ });
    const email = optionalStr(req.body.email, 'email', 255);
    const dup = await db.query(`SELECT id FROM parties WHERE organization_id = $1 AND phone = $2`, [org(req), phone]);
    if (dup.rows.length > 0) throw new ApiError(409, ErrorCode.DUPLICATE_RESOURCE, 'A customer with this phone already exists', { id: dup.rows[0].id });
    const id = crypto.randomUUID();
    await db.transaction(async (tx) => {
      const code = await nextDocumentNumber(tx, org(req), 'CUST-POS', todayIso());
      await tx.query(
        `INSERT INTO parties (id, organization_id, legal_entity_id, code, name, party_type, phone, email, credit_limit) VALUES ($1,$2,$3,$4,$5,'CUSTOMER',$6,$7,0)`,
        [id, org(req), req.session!.legal_entity_id, code, name, phone, email],
      );
      await tx.query(`INSERT INTO pos_loyalty_accounts (organization_id, customer_id) VALUES ($1,$2)`, [org(req), id]);
      await audit(req, tx, 'POS_CUSTOMER_CREATED', 'PARTY', id, { code, name, phone });
    });
    return ok(req, res, { id, name, phone, points_balance: 0 }, 201);
  });

  // ------------------------------------------------------------------ promotions
  app.get('/api/pos/promotions', authenticate, terminal, async (req: Request, res: Response) => {
    const r = await db.query(`SELECT * FROM pos_promotions WHERE organization_id = $1 ORDER BY is_active DESC, priority DESC, code`, [org(req)]);
    return ok(req, res, r.rows);
  });

  app.post('/api/pos/promotions', authenticate, manage, async (req: Request, res: Response) => {
    const code = str(req.body.code, 'code', { max: 32, pattern: /^[A-Z0-9_-]+$/i }).toUpperCase();
    const name = str(req.body.name, 'name', { max: 255 });
    const type = oneOf(req.body.promo_type, 'promo_type', ['BOGO', 'MIX_MATCH', 'BUNDLE', 'TIERED', 'COUPON', 'CART_PERCENT'] as const);
    const rule = req.body.rule && typeof req.body.rule === 'object' && !Array.isArray(req.body.rule) ? req.body.rule : null;
    if (!rule) throw validationError('rule is required', { field: 'rule' });
    // Dry-run the rule through the engine so malformed configuration is rejected early.
    engine(() =>
      priceCart([{ line_id: 'x', item_id: 'dry-run', sku: 'X', name: 'x', quantity: '1', unit_price: '1', tax_rate: '0' }], { promotions: [{ ...rule, id: 'dry', code, name, type }], couponCodes: [code] }),
    );
    const starts_on = present(req.body.starts_on) ? dateOnly(req.body.starts_on, 'starts_on') : null;
    const ends_on = present(req.body.ends_on) ? dateOnly(req.body.ends_on, 'ends_on') : null;
    if (starts_on && ends_on && ends_on < starts_on) throw validationError('ends_on must be on or after starts_on', { field: 'ends_on' });
    const id = crypto.randomUUID();
    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO pos_promotions (id, organization_id, code, name, promo_type, rule, priority, starts_on, ends_on, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, org(req), code, name, type, JSON.stringify(rule), Number.parseInt(String(req.body.priority ?? 0), 10) || 0, starts_on, ends_on, req.session!.user_id],
      );
      await audit(req, tx, 'POS_PROMOTION_CREATED', 'POS_PROMOTION', id, { code, type, rule });
    });
    return ok(req, res, { id, code, name, promo_type: type }, 201);
  });

  app.post('/api/pos/promotions/:id/toggle', authenticate, manage, async (req: Request, res: Response) => {
    const p = await requireOrgRow(db, 'pos_promotions', req.params.id, org(req), 'Promotion');
    await db.transaction(async (tx) => {
      await tx.query(`UPDATE pos_promotions SET is_active = NOT is_active WHERE id = $1`, [p.id]);
      await audit(req, tx, 'POS_PROMOTION_TOGGLED', 'POS_PROMOTION', p.id, { is_active: !p.is_active });
    });
    return ok(req, res, { id: p.id, is_active: !p.is_active });
  });

  // ------------------------------------------------------------------ manager PIN & approvals
  app.post('/api/pos/manager-pin', authenticate, manage, async (req: Request, res: Response) => {
    const pin = str(req.body.pin, 'pin', { max: 8, pattern: /^\d{4,8}$/ });
    const password = str(req.body.current_password, 'current_password', { max: 200 });
    const u = await db.query(`SELECT password_hash FROM users WHERE id = $1`, [req.session!.user_id]);
    if (!u.rows[0] || !AuthService.verifyPassword(password, u.rows[0].password_hash)) throw new ApiError(403, ErrorCode.UNAUTHORIZED, 'Current password is incorrect');
    if (/^(\d)\1+$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) throw validationError('PIN is too easy to guess', { field: 'pin' });
    const others = await db.query(`SELECT pin_hash FROM pos_manager_pins WHERE organization_id = $1 AND user_id <> $2`, [org(req), req.session!.user_id]);
    if (others.rows.some((o: any) => AuthService.verifyPassword(pin, o.pin_hash))) throw validationError('PIN already in use; choose another', { field: 'pin' });
    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO pos_manager_pins (user_id, organization_id, pin_hash) VALUES ($1,$2,$3)
         ON CONFLICT (organization_id, user_id) DO UPDATE SET pin_hash = EXCLUDED.pin_hash, failed_attempts = 0, locked_until = NULL, updated_at = NOW()`,
        [req.session!.user_id, org(req), AuthService.hashPassword(pin)],
      );
      await audit(req, tx, 'POS_MANAGER_PIN_SET', 'USER', req.session!.user_id, { set: true });
    });
    return ok(req, res, { updated: true });
  });

  app.post('/api/pos/approvals', authenticate, terminal, async (req: Request, res: Response) => {
    const { session, register } = await loadSession(db, req, req.body.session_id);
    const action = oneOf(req.body.action, 'action', POS_ACTIONS);
    const pin = str(req.body.pin, 'pin', { max: 8 });
    if ((await recentPinFailures(db, req)) >= MAX_PIN_FAILURES) {
      throw new ApiError(423, ErrorCode.PIN_LOCKED, `Too many invalid PIN attempts; approvals are locked for ${LOCK_MINUTES} minutes`);
    }
    let approver: { userId: string; name: string };
    try {
      approver = await verifyManagerPin(db, req, pin);
    } catch (err) {
      // Recorded outside any transaction so the failure survives the error response.
      await posEvent(db, req, { registerId: register.id, sessionId: session.id, type: 'APPROVAL_PIN_FAILED', details: { action } });
      throw err;
    }
    const id = crypto.randomUUID();
    const context = req.body.context && typeof req.body.context === 'object' ? req.body.context : null;
    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO pos_approvals (id, organization_id, session_id, action, requested_by, approved_by, context, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, NOW() + interval '5 minutes')`,
        [id, org(req), session.id, action, req.session!.user_id, approver.userId, context ? JSON.stringify(context) : null],
      );
      await posEvent(tx, req, { registerId: register.id, sessionId: session.id, type: 'APPROVAL_GRANTED', referenceId: id, details: { action, approved_by: approver.userId, context } });
    });
    return ok(req, res, { approval_id: id, action, approved_by: approver.userId, approver_name: approver.name, expires_in_seconds: 300 }, 201);
  });

  // ------------------------------------------------------------------ sessions (shifts)
  app.get('/api/pos/sessions/active', authenticate, terminal, async (req: Request, res: Response) => {
    const params: any[] = [org(req), req.session!.user_id];
    let where = `ps.organization_id = $1 AND ps.status = 'OPEN'`;
    if (req.query.register_id) {
      params.push(String(req.query.register_id));
      where += ` AND ps.register_id::text = $3`;
    } else if (!isPosManager(req)) {
      where += ` AND ps.cashier_id = $2`;
    }
    const r = await db.query(
      `SELECT ps.*, pr.register_code, pr.name AS register_name FROM pos_sessions ps JOIN pos_registers pr ON pr.id = ps.register_id
       WHERE ${where} ORDER BY (ps.cashier_id = $2) DESC, ps.opened_at DESC LIMIT 1`,
      params,
    );
    return ok(req, res, r.rows[0] || null);
  });

  app.post('/api/pos/sessions/open', authenticate, terminal, async (req: Request, res: Response) => {
    const register = await requireOrgRow(db, 'pos_registers', req.body.register_id, org(req), 'POS register');
    if (!register.is_active) throw invalidState('Register is inactive');
    let opening = present(req.body.opening_float) ? decimal(req.body.opening_float, 'opening_float', { sign: 'nonNegative' }) : '0.00';
    let count: any = null;
    if (Array.isArray(req.body.opening_count)) {
      count = req.body.opening_count;
      const counted = engine(() => countDenominations(count));
      if (present(req.body.opening_float) && !new Money(counted).eq(opening)) throw validationError('opening_float does not match the denomination count');
      opening = counted;
    }
    const businessDate = isPosManager(req) && present(req.body.business_date) ? dateOnly(req.body.business_date, 'business_date') : todayIso();
    const id = crypto.randomUUID();
    const floatStr = new Money(opening).toFixed(8);
    try {
      await db.transaction(async (tx) => {
        await tx.query(
          `INSERT INTO pos_sessions (id, register_id, cashier_id, cashier_name, opened_at, opening_float, cash_sales_total, card_sales_total,
             expected_cash_drawer, cash_difference, status, organization_id, business_date, opening_count)
           VALUES ($1,$2,$3,$4,NOW(),$5,0,0,$5,0,'OPEN',$6,$7,$8)`,
          [id, register.id, req.session!.user_id, req.session!.name || req.session!.email, floatStr, org(req), businessDate, count ? JSON.stringify(count) : null],
        );
        await posEvent(tx, req, { registerId: register.id, sessionId: id, type: 'SHIFT_OPENED', details: { opening_float: floatStr, count } });
        await audit(req, tx, 'POS_SESSION_OPENED', 'POS_SESSION', id, { register_id: register.id, opening_float: floatStr });
      });
    } catch (err: any) {
      if (err?.code === '23505') throw new ApiError(409, ErrorCode.POS_SESSION_ALREADY_OPEN, 'Register already has an active open session');
      throw err;
    }
    return ok(req, res, { id, register_id: register.id, opening_float: floatStr, status: 'OPEN', business_date: businessDate }, 201);
  });

  app.get('/api/pos/sessions/:id/x-report', authenticate, terminal, async (req: Request, res: Response) => {
    const { session, register } = await loadSession(db, req, req.params.id, { mustBeOpen: false });
    const totals = await sessionTotals(db, session.id);
    return ok(req, res, { report_type: 'X', register_code: register.register_code, generated_at: new Date().toISOString(), ...totals });
  });

  app.get('/api/pos/sessions/:id/z-report', authenticate, terminal, async (req: Request, res: Response) => {
    const { session } = await loadSession(db, req, req.params.id, { mustBeOpen: false });
    if (!session.z_report) throw invalidState('The Z report is produced when the shift is closed');
    return ok(req, res, typeof session.z_report === 'string' ? JSON.parse(session.z_report) : session.z_report);
  });

  app.get('/api/pos/sessions/:id/audit', authenticate, terminal, async (req: Request, res: Response) => {
    const { session } = await loadSession(db, req, req.params.id, { mustBeOpen: false });
    const r = await db.query(
      `SELECT e.*, u.name AS user_name FROM pos_audit_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.session_id = $1 ORDER BY e.created_at DESC, e.id LIMIT 500`,
      [session.id],
    );
    return ok(req, res, r.rows);
  });

  app.post('/api/pos/sessions/:id/cash-movements', authenticate, terminal, async (req: Request, res: Response) => {
    const type = oneOf(req.body.movement_type, 'movement_type', ['PAID_IN', 'PAID_OUT', 'SAFE_DROP'] as const);
    const amount = decimal(req.body.amount, 'amount', { sign: 'positive' });
    const reason = str(req.body.reason, 'reason', { max: 500 });
    const out = await db.transaction(async (tx) => {
      const { session, register, businessDate } = await loadSession(tx, req, req.params.id, { forUpdate: true });
      const id = crypto.randomUUID();
      const approver = type === 'PAID_OUT' ? await requireApproval(tx, req, 'PAID_OUT', session.id, req.body.approval_id, id) : null;
      if (type !== 'PAID_IN' && new Money(amount).gt(drawerOf(session))) throw validationError(`Drawer only holds ${new Money(drawerOf(session)).format()} expected cash`);
      const amt = new Money(amount).toFixed(8);
      const desc = `${type} ${register.register_code}: ${reason}`;
      const [dr, cr] = type === 'PAID_IN' ? ['111004', '111001'] : type === 'SAFE_DROP' ? ['111001', '111004'] : ['521010', '111004'];
      const j = await postJournal(tx, auditLogger, outboxService, {
        organizationId: org(req), legalEntityId: req.session!.legal_entity_id, userId: req.session!.user_id, postingDate: businessDate,
        purpose: AccountingPurpose.POS_CASH_MOVEMENT, description: desc, sourceType: 'POS_CASH_MOVEMENT', sourceId: id, sourceKey: `POS_CASH_MOVEMENT:${id}`,
        numberPrefix: 'JV-POS', approvedBy: approver, correlationId: req.correlationId,
        lines: [{ account_code: dr, debit: amt, description: desc }, { account_code: cr, credit: amt, description: desc }],
      });
      await tx.query(
        `INSERT INTO pos_cash_movements (id, organization_id, session_id, movement_type, amount, reason, approval_id, journal_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, org(req), session.id, type, amt, reason, type === 'PAID_OUT' && req.body.approval_id ? req.body.approval_id : null, j?.journalId || null, req.session!.user_id],
      );
      const col = type === 'PAID_IN' ? 'paid_in_total' : type === 'PAID_OUT' ? 'paid_out_total' : 'safe_drop_total';
      const sign = type === 'PAID_IN' ? '+' : '-';
      await tx.query(`UPDATE pos_sessions SET ${col} = ${col} + $1, expected_cash_drawer = expected_cash_drawer ${sign} $1 WHERE id = $2`, [amt, session.id]);
      await posEvent(tx, req, { registerId: register.id, sessionId: session.id, type: `CASH_${type}`, referenceId: id, details: { amount, reason, approved_by: approver } });
      await posEvent(tx, req, { registerId: register.id, sessionId: session.id, type: 'DRAWER_OPENED', referenceId: id, details: { reason: type } });
      return { id, movement_type: type, amount: f2(amt), journal_id: j?.journalId || null };
    });
    return ok(req, res, out, 201);
  });

  app.post('/api/pos/sessions/:id/drawer-open', authenticate, terminal, async (req: Request, res: Response) => {
    const reason = str(req.body.reason, 'reason', { max: 200 });
    const out = await db.transaction(async (tx) => {
      const { session, register } = await loadSession(tx, req, req.params.id);
      const ref = crypto.randomUUID();
      const approver = await requireApproval(tx, req, 'NO_SALE', session.id, req.body.approval_id, ref);
      await posEvent(tx, req, { registerId: register.id, sessionId: session.id, type: 'NO_SALE', referenceId: ref, details: { reason, approved_by: approver } });
      await posEvent(tx, req, { registerId: register.id, sessionId: session.id, type: 'DRAWER_OPENED', referenceId: ref, details: { reason: 'NO_SALE' } });
      return { opened: true, reference: ref, approved_by: approver };
    });
    return ok(req, res, out);
  });

  app.post('/api/pos/sessions/:id/close', authenticate, requirePermission(Permission.POS_SESSION_CLOSE), async (req: Request, res: Response) => {
    let counted: string | null = null;
    let count: any = null;
    if (Array.isArray(req.body.closing_count)) {
      count = req.body.closing_count;
      counted = engine(() => countDenominations(count));
    }
    if (present(req.body.actual_cash_drawer)) {
      const a = decimal(req.body.actual_cash_drawer, 'actual_cash_drawer', { sign: 'nonNegative' });
      if (counted !== null && !new Money(counted).eq(a)) throw validationError('actual_cash_drawer does not match the denomination count');
      counted = a;
    }
    if (counted === null) throw validationError('A blind cash count (actual_cash_drawer or closing_count) is required to close the shift', { field: 'actual_cash_drawer' });
    const notes = optionalStr(req.body.variance_notes, 'variance_notes', 1000);
    const countedStr = counted;

    const out = await db.transaction(async (tx) => {
      const { session, register, businessDate } = await loadSession(tx, req, req.params.id, { forUpdate: true });
      const held = await tx.query(`SELECT COUNT(*)::int AS n FROM pos_held_carts WHERE session_id = $1 AND status = 'HELD'`, [session.id]);
      const expected = drawerOf(session);
      const v = drawerVariance(expected, countedStr);
      let approver: string | null = null;
      if (v.status !== 'BALANCED') {
        if (!notes) throw validationError('A drawer variance requires variance_notes', { field: 'variance_notes', variance: v.variance });
        // Material variances (greater of 1% of expected cash or 500) need a manager.
        const material = new Money(v.variance).abs().gt(Money.max(new Money(expected).mul('0.01'), '500'));
        if (material) approver = await requireApproval(tx, req, 'CLOSE_VARIANCE', session.id, req.body.approval_id, session.id);
      }
      const float = new Money(session.opening_float);
      const j = await postJournal(tx, auditLogger, outboxService, {
        organizationId: org(req), legalEntityId: req.session!.legal_entity_id, userId: req.session!.user_id, postingDate: businessDate,
        purpose: AccountingPurpose.POS_SESSION_CLOSE, description: `POS shift close ${register.register_code} (${businessDate})`,
        sourceType: 'POS_SESSION', sourceId: session.id, sourceKey: `POS_SESSION_CLOSE:${session.id}`, numberPrefix: 'JV-POS',
        approvedBy: approver, correlationId: req.correlationId,
        lines: [
          signed('111001', new Money(countedStr).sub(float), `Shift ${register.register_code} cash banked to cash on hand`),
          signed('111004', new Money(expected).sub(float).negated(), `Shift ${register.register_code} cash clearing settled`),
          signed('521008', new Money(v.variance).negated(), `Shift ${register.register_code} cash ${v.status.toLowerCase()}`),
        ],
      });
      const z = await tx.query(`UPDATE pos_registers SET last_z_number = last_z_number + 1 WHERE id = $1 RETURNING last_z_number`, [register.id]);
      const zNumber = z.rows[0].last_z_number;
      await tx.query(`UPDATE pos_held_carts SET status = 'DISCARDED' WHERE session_id = $1 AND status = 'HELD'`, [session.id]);
      await transition(tx, {
        table: 'pos_sessions', id: session.id, organizationId: org(req), from: ['OPEN'], to: 'CLOSED', label: 'POS session',
        set: {
          closed_at: new Date().toISOString(), actual_cash_drawer: new Money(countedStr).toFixed(8), cash_difference: new Money(v.variance).toFixed(8),
          expected_cash_drawer: new Money(expected).toFixed(8), closing_journal_id: j?.journalId || null, closing_count: count ? JSON.stringify(count) : null,
          z_number: zNumber, closed_by: req.session!.user_id, variance_notes: notes,
        },
      });
      const totals = await sessionTotals(tx, session.id);
      const zReport = {
        report_type: 'Z', z_number: zNumber, register_code: register.register_code, ...totals, counted_cash: f2(countedStr), variance: v.variance,
        variance_status: v.status, held_carts_discarded: held.rows[0].n, closing_journal_id: j?.journalId || null,
      };
      await tx.query(`UPDATE pos_sessions SET z_report = $1 WHERE id = $2`, [JSON.stringify(zReport), session.id]);
      await posEvent(tx, req, { registerId: register.id, sessionId: session.id, type: 'SHIFT_CLOSED', details: { expected, counted: countedStr, variance: v.variance, z_number: zNumber, approved_by: approver } });
      await audit(req, tx, 'POS_SESSION_CLOSED', 'POS_SESSION', session.id, { expected, counted: countedStr, variance: v.variance, z_number: zNumber });
      return {
        id: session.id, status: 'CLOSED', expected_cash_drawer: expected, actual_cash_drawer: f2(countedStr), cash_difference: v.variance,
        variance_status: v.status, closing_journal_id: j?.journalId || null, z_number: zNumber, z_report: zReport,
      };
    });
    return ok(req, res, out);
  });

  // ------------------------------------------------------------------ held / parked carts
  app.get('/api/pos/holds', authenticate, terminal, async (req: Request, res: Response) => {
    const params: any[] = [org(req)];
    let where = `h.organization_id = $1 AND h.status = 'HELD'`;
    if (req.query.register_id) {
      params.push(String(req.query.register_id));
      where += ` AND h.register_id::text = $2`;
    }
    const r = await db.query(
      `SELECT h.id, h.label, h.item_count::text, h.estimated_total::text, h.created_at, h.customer_id, u.name AS held_by_name, h.session_id
       FROM pos_held_carts h JOIN users u ON u.id = h.held_by WHERE ${where} ORDER BY h.created_at`,
      params,
    );
    return ok(req, res, r.rows);
  });

  app.post('/api/pos/holds', authenticate, terminal, async (req: Request, res: Response) => {
    const cart = req.body.cart;
    if (!cart || typeof cart !== 'object' || !Array.isArray(cart.lines) || cart.lines.length === 0) throw validationError('cart.lines is required', { field: 'cart' });
    if (JSON.stringify(cart).length > 200_000) throw validationError('cart is too large');
    const label = optionalStr(req.body.label, 'label', 128);
    const out = await db.transaction(async (tx) => {
      const { session, register } = await loadSession(tx, req, req.body.session_id);
      await assertOrgRef(tx, 'parties', req.body.customer_id, org(req), 'customer_id');
      const itemCount = cart.lines.reduce((s: Money, l: any) => s.add(decimal(l.quantity, 'cart.lines.quantity', { sign: 'positive', scale: 3 })), Money.zero());
      const estimated = present(req.body.estimated_total) ? decimal(req.body.estimated_total, 'estimated_total', { sign: 'nonNegative' }) : '0';
      const id = crypto.randomUUID();
      const n = await tx.query(`SELECT COUNT(*)::int AS n FROM pos_held_carts WHERE session_id = $1`, [session.id]);
      const finalLabel = label || `Hold #${n.rows[0].n + 1}`;
      await tx.query(
        `INSERT INTO pos_held_carts (id, organization_id, session_id, register_id, label, customer_id, cart, item_count, estimated_total, held_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, org(req), session.id, register.id, finalLabel, req.body.customer_id || null, JSON.stringify(cart), itemCount.toFixed(8), estimated, req.session!.user_id],
      );
      await posEvent(tx, req, { registerId: register.id, sessionId: session.id, type: 'CART_HELD', referenceId: id, details: { label: finalLabel, lines: cart.lines.length } });
      return { id, label: finalLabel };
    });
    return ok(req, res, out, 201);
  });

  app.post('/api/pos/holds/:id/recall', authenticate, terminal, async (req: Request, res: Response) => {
    const out = await db.transaction(async (tx) => {
      const h = await requireOrgRow(tx, 'pos_held_carts', req.params.id, org(req), 'Held cart', { forUpdate: true });
      const { session, register } = await loadSession(tx, req, req.body.session_id || h.session_id);
      if (register.id !== h.register_id && !isPosManager(req)) throw invalidState('Held carts can only be recalled on the register that parked them');
      const row = await transition(tx, {
        table: 'pos_held_carts', id: h.id, organizationId: org(req), from: ['HELD'], to: 'RECALLED', label: 'Held cart',
        set: { recalled_by: req.session!.user_id, recalled_at: new Date().toISOString() },
      });
      await posEvent(tx, req, { registerId: register.id, sessionId: session.id, type: 'CART_RECALLED', referenceId: h.id });
      return { id: h.id, label: row.label, customer_id: row.customer_id, cart: typeof row.cart === 'string' ? JSON.parse(row.cart) : row.cart };
    });
    return ok(req, res, out);
  });

  app.post('/api/pos/holds/:id/discard', authenticate, terminal, async (req: Request, res: Response) => {
    const out = await db.transaction(async (tx) => {
      const h = await requireOrgRow(tx, 'pos_held_carts', req.params.id, org(req), 'Held cart', { forUpdate: true });
      await loadSession(tx, req, h.session_id, { mustBeOpen: false });
      await transition(tx, { table: 'pos_held_carts', id: h.id, organizationId: org(req), from: ['HELD'], to: 'DISCARDED', label: 'Held cart' });
      await posEvent(tx, req, { registerId: h.register_id, sessionId: h.session_id, type: 'CART_DISCARDED', referenceId: h.id });
      return { id: h.id, status: 'DISCARDED' };
    });
    return ok(req, res, out);
  });

  // ------------------------------------------------------------------ price preview (server-authoritative totals)
  app.post('/api/pos/price', authenticate, terminal, async (req: Request, res: Response) => {
    const lines = normalizeLines(req.body);
    const items = await db.query(`SELECT * FROM items WHERE organization_id = $1 AND id = ANY($2::uuid[])`, [org(req), [...new Set(lines.map((l) => l.item_id))]]);
    const byId = new Map<string, any>(items.rows.map((i: any) => [i.id, i]));
    const cart: CartLineInput[] = lines.map((l, i) => {
      const it = byId.get(l.item_id);
      if (!it) throw validationError(`Item ${l.item_id} not found`, { field: `lines[${i}].item_id` });
      return {
        line_id: String(i), item_id: it.id, sku: it.code, name: it.name, quantity: l.quantity, unit_price: f2(it.unit_price), override_price: l.override_price,
        tax_rate: new Money(it.tax_rate || '0').toFixed(4), category: it.category, line_discount: l.line_discount, fixed_line_total: l.fixed_line_total,
      };
    });
    const promotions = await activePromotions(db, org(req), todayIso());
    const coupons = Array.isArray(req.body.coupon_codes) ? req.body.coupon_codes.slice(0, 10).map((c: unknown) => String(c)) : [];
    const priced = engine(() => priceCart(cart, { promotions, couponCodes: coupons, cartDiscount: parseDiscount(req.body.cart_discount, 'cart_discount') }));
    return ok(req, res, priced);
  });

  // ------------------------------------------------------------------ sale
  app.post('/api/pos/orders', authenticate, terminal, async (req: Request, res: Response) => {
    const lines = normalizeLines(req.body);
    const clientRef = optionalStr(req.body.client_ref, 'client_ref', 64);
    const coupons: string[] = Array.isArray(req.body.coupon_codes)
      ? req.body.coupon_codes.slice(0, 10).map((c: unknown) => String(c).trim().toUpperCase()).filter(Boolean)
      : [];
    let cartDiscount = parseDiscount(req.body.cart_discount, 'cart_discount');
    if (!cartDiscount && present(req.body.discount_amount)) {
      const d = decimal(req.body.discount_amount, 'discount_amount', { sign: 'nonNegative' });
      if (!new Money(d).isZero()) cartDiscount = { type: 'AMOUNT', value: d };
    }
    const legacyTax = present(req.body.tax_percentage) ? decimal(req.body.tax_percentage, 'tax_percentage', { sign: 'nonNegative' }) : null;
    if (legacyTax && new Money(legacyTax).gt(100)) throw validationError('tax_percentage cannot exceed 100');

    const result = await db.transaction(async (tx) => {
      const { session, register, businessDate } = await loadSession(tx, req, req.body.session_id, { forUpdate: true });
      const orgId = org(req);

      // Offline replay: the same client_ref returns the already-recorded sale.
      if (clientRef) {
        const ex = await tx.query(`SELECT id FROM pos_orders WHERE organization_id = $1 AND client_ref = $2`, [orgId, clientRef]);
        if (ex.rows.length > 0) return { replayed: true, orderId: ex.rows[0].id as string };
      }
      if (req.body.customer_id) await assertOrgRef(tx, 'parties', req.body.customer_id, orgId, 'customer_id');
      const customerId: string | null = req.body.customer_id || null;
      const orderId = crypto.randomUUID();
      if (legacyTax !== null && !isPosManager(req)) throw new ApiError(403, ErrorCode.APPROVAL_REQUIRED, 'Tax rate overrides require a POS manager');

      const itemMap = await lockItems(tx, orgId, lines.map((l) => l.item_id));
      const approvals: Record<string, string> = {};
      const cart: CartLineInput[] = [];
      for (const [i, l] of lines.entries()) {
        const it = itemMap.get(l.item_id);
        if (!it.is_active) throw validationError(`${it.name} is inactive`, { field: `lines[${i}].item_id` });
        if (it.item_type === 'NON_INVENTORY') throw validationError(`${it.name} cannot be sold at POS`, { field: `lines[${i}].item_id` });
        if (!it.is_weighed && !l.fixed_line_total && !new Money(l.quantity).eq(new Money(l.quantity).floor(0))) {
          throw validationError(`${it.name} is sold in whole units`, { field: `lines[${i}].quantity` });
        }
        const listPrice = f2(it.unit_price);
        const override = l.override_price ?? (l.unit_price !== null && !new Money(l.unit_price).eq(listPrice) ? l.unit_price : null);
        if (override !== null) approvals[`line${i + 1}`] = await requireApproval(tx, req, 'PRICE_OVERRIDE', session.id, l.approval_id, orderId);
        if (l.fixed_line_total && override === null) {
          // Price-embedded label must agree with quantity x shelf price (tolerance: 0.1% + 0.01).
          const expected = new Money(l.quantity).mul(listPrice).round(2);
          if (new Money(l.fixed_line_total).sub(expected).abs().gt(new Money(listPrice).mul('0.001').add('0.01'))) {
            throw validationError(`Label price for ${it.name} does not match quantity x price`, { field: `lines[${i}].fixed_line_total` });
          }
        }
        cart.push({
          line_id: String(i), item_id: it.id, sku: it.code, name: it.name, quantity: l.quantity, unit_price: listPrice, override_price: override,
          tax_rate: legacyTax ?? new Money(it.tax_rate || '0').toFixed(4), category: it.category, line_discount: l.line_discount, fixed_line_total: l.fixed_line_total,
        });
      }

      const promotions = await activePromotions(tx, orgId, businessDate);
      const priced = engine(() => priceCart(cart, { promotions, couponCodes: coupons, cartDiscount }));
      if (priced.rejected_coupons.length > 0 && req.body.strict_coupons) throw validationError(`Coupon(s) not applicable: ${priced.rejected_coupons.join(', ')}`);

      // Manual discount authority: cashiers up to the register limit, beyond that a manager.
      const couponAmt = priced.applied_promotions
        .filter((p) => promotions.some((x) => x.id === p.id && (x.type === 'COUPON' || x.type === 'CART_PERCENT')))
        .reduce((s, p) => s.add(p.amount), Money.zero());
      const manual = new Money(priced.manual_discount_total).add(priced.cart_discount_total).sub(couponAmt);
      if (manual.isPositive()) {
        const base = new Money(priced.subtotal).sub(priced.promo_discount_total);
        const pct = base.isZero() ? new Money('100') : manual.div(base).mul(100);
        if (pct.gt(register.max_cashier_discount_percent)) {
          approvals.discount = await requireApproval(tx, req, 'DISCOUNT', session.id, req.body.discount_approval_id, orderId);
        }
      }

      const tenders = normalizeTenders(req.body, priced.grand_total);
      const rounding = new Money(register.cash_rounding_increment || '0').isPositive() ? f2(register.cash_rounding_increment) : undefined;
      const settled = engine(() => settleTenders(priced.grand_total, tenders, { cashRoundingIncrement: rounding }));

      const orderNumber = present(req.body.order_number)
        ? str(req.body.order_number, 'order_number', { max: 64 })
        : await nextDocumentNumber(tx, orgId, `POS-${register.register_code}`, businessDate, 6);
      const tenderTotals: Record<string, Money> = {};
      for (const t of settled.tenders) tenderTotals[t.type] = (tenderTotals[t.type] || Money.zero()).add(t.applied_amount);
      const methods = Object.keys(tenderTotals);
      const paymentMethod = methods.length === 0 ? 'CASH' : methods.length === 1 ? methods[0] : 'SPLIT';
      const cashApplied = tenderTotals.CASH || Money.zero();
      const loyaltyPaid = tenderTotals.LOYALTY || Money.zero();
      if (loyaltyPaid.isPositive() && !customerId) throw validationError('Loyalty redemption requires a customer on the sale');
      // Points are earned on the net amount not itself paid with points.
      const earned = customerId ? pointsEarned(Money.max(new Money(priced.net_total).sub(loyaltyPaid), '0').toFixed(2)) : 0;
      const cashTendered = settled.tenders.filter((t) => t.type === 'CASH').reduce((s, t) => s.add(t.amount), Money.zero());

      await tx.query(
        `INSERT INTO pos_orders (id, session_id, order_number, customer_id, subtotal, discount_amount, tax_amount, total_amount, payment_method,
           cash_tendered, change_due, status, organization_id, cashier_id, register_id, business_date, promo_discount, net_amount, cash_rounding,
           total_tendered, coupon_codes, applied_promotions, loyalty_points_earned, client_ref)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'COMPLETED',$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
        [orderId, session.id, orderNumber, customerId, priced.subtotal, priced.discount_total, priced.tax_total, priced.grand_total, paymentMethod,
          cashTendered.toFixed(8), settled.change_due, orgId, req.session!.user_id, register.id, businessDate, priced.promo_discount_total,
          priced.net_total, settled.cash_rounding, settled.total_tendered, coupons.length ? coupons : null, JSON.stringify(priced.applied_promotions), earned, clientRef],
      );

      const wh = await stockWarehouse(tx, orgId, register);
      const salesByAccount = new Map<string, Money>();
      const cogsLines: PostingIntentLine[] = [];
      for (const [i, pl] of priced.lines.entries()) {
        const it = itemMap.get(pl.item_id);
        const discount = new Money(pl.promo_discount).add(pl.manual_discount).add(pl.cart_discount);
        await tx.query(
          `INSERT INTO pos_order_lines (id, order_id, item_id, item_code, item_name, quantity, unit_price, line_total, tax_amount, line_number, list_price,
             gross_amount, discount_amount, net_amount, tax_rate, unit_cost, applied_promotions, scanned_code, override_approval_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
          [crypto.randomUUID(), orderId, it.id, it.code, it.name, pl.quantity, pl.effective_unit_price, pl.total_amount, pl.tax_amount, i + 1, it.unit_price,
            pl.gross_amount, discount.toFixed(8), pl.net_amount, pl.tax_rate, it.unit_cost, pl.applied_promotions.length ? pl.applied_promotions : null,
            lines[i].scanned_code, lines[i].approval_id],
        );
        const key = it.sales_account_id ? `id:${it.sales_account_id}` : 'code:411001';
        salesByAccount.set(key, (salesByAccount.get(key) || Money.zero()).add(pl.gross_amount));
        if (it.item_type === 'INVENTORY') {
          let allowNegative = !!register.allow_negative_stock;
          if (!allowNegative && req.body.negative_stock_approval_id) {
            const avail = await onHand(tx, orgId, it.id, wh);
            if (new Money(avail).lt(pl.quantity)) {
              approvals[`stock${i + 1}`] = await requireApproval(tx, req, 'NEGATIVE_STOCK', session.id, req.body.negative_stock_approval_id, orderId);
              allowNegative = true;
            }
          }
          await postStockMovement(tx, {
            organizationId: orgId, legalEntityId: req.session!.legal_entity_id, itemId: it.id, warehouseId: wh, movementType: 'POS_SALE',
            movementDate: businessDate, quantity: new Money(pl.quantity).negated().toFixed(8), unitCost: it.unit_cost, referenceType: 'POS_ORDER',
            referenceId: orderId, description: `POS sale ${orderNumber}`, allowNegative,
          });
          const cost = new Money(pl.quantity).mul(it.unit_cost).round(2);
          if (cost.isPositive()) {
            cogsLines.push(it.cogs_account_id ? { account_id: it.cogs_account_id, debit: cost.toFixed(8), description: `COGS ${it.code}` } : { account_code: '511001', debit: cost.toFixed(8), description: `COGS ${it.code}` });
            cogsLines.push(it.inventory_account_id ? { account_id: it.inventory_account_id, credit: cost.toFixed(8), description: `Inventory ${it.code}` } : { account_code: '113001', credit: cost.toFixed(8), description: `Inventory ${it.code}` });
          }
        }
      }

      // Tenders and their stored-value / loyalty effects.
      for (const t of settled.tenders) {
        let reference = t.reference || null;
        if (t.type === 'GIFT_CARD' || t.type === 'STORE_CREDIT') {
          const acct = await lockStoredValue(tx, orgId, t.type, t.reference);
          reference = acct.code;
          await storedValueMove(tx, req, acct, new Money(t.applied_amount).negated(), 'POS_SALE', orderId);
        }
        if (t.type === 'LOYALTY') {
          const pts = pointsForAmount(t.applied_amount);
          if (!new Money(redemptionValue(pts)).eq(t.applied_amount)) throw validationError('Loyalty tender must be a whole number of points');
          await loyaltyMove(tx, orgId, customerId!, -pts, 'POS_REDEEM', orderId);
          reference = `${pts} pts`;
        }
        await tx.query(
          `INSERT INTO pos_tenders (organization_id, order_id, tender_type, amount_tendered, applied_amount, reference) VALUES ($1,$2,$3,$4,$5,$6)`,
          [orgId, orderId, t.type, new Money(t.amount).toFixed(8), new Money(t.applied_amount).toFixed(8), reference],
        );
      }
      if (earned > 0) await loyaltyMove(tx, orgId, customerId!, earned, 'POS_EARN', orderId);

      const desc = `POS sale ${orderNumber}`;
      const jl: PostingIntentLine[] = [];
      for (const [type, amt] of Object.entries(tenderTotals)) jl.push({ account_code: TENDER_ACCOUNT[type as TenderType], debit: amt.toFixed(8), description: `${desc} ${type}` });
      if (new Money(priced.discount_total).isPositive()) jl.push({ account_code: '411004', debit: new Money(priced.discount_total).toFixed(8), description: `${desc} discounts & promotions` });
      for (const [key, amt] of salesByAccount) {
        jl.push(key.startsWith('code:') ? { account_code: key.slice(5), credit: amt.toFixed(8), description: desc } : { account_id: key.slice(3), credit: amt.toFixed(8), description: desc });
      }
      if (new Money(priced.tax_total).isPositive()) jl.push({ account_code: '212001', credit: new Money(priced.tax_total).toFixed(8), description: `${desc} output tax` });
      if (!new Money(settled.cash_rounding).isZero()) jl.push(signed('911002', new Money(settled.cash_rounding).negated(), `${desc} cash rounding`));
      if (earned > 0) {
        const v = new Money(redemptionValue(earned)).toFixed(8);
        jl.push({ account_code: '411004', debit: v, description: `${desc} loyalty points deferred` });
        jl.push({ account_code: '211008', credit: v, description: `${desc} loyalty points liability` });
      }
      jl.push(...cogsLines);
      const j = await postJournal(tx, auditLogger, outboxService, {
        organizationId: orgId, legalEntityId: req.session!.legal_entity_id, userId: req.session!.user_id, postingDate: businessDate,
        purpose: AccountingPurpose.POS_SALE, description: desc, sourceType: 'POS_ORDER', sourceId: orderId, sourceKey: `POS_SALE:${orderId}`,
        numberPrefix: 'JV-POS', lines: jl, correlationId: req.correlationId,
      });
      await tx.query(`UPDATE pos_orders SET journal_id = $1 WHERE id = $2`, [j?.journalId || null, orderId]);

      const electronic = (tenderTotals.CARD || Money.zero()).add(tenderTotals.WALLET || Money.zero());
      await tx.query(
        `UPDATE pos_sessions SET cash_sales_total = cash_sales_total + $1, expected_cash_drawer = expected_cash_drawer + $1, card_sales_total = card_sales_total + $2 WHERE id = $3`,
        [cashApplied.toFixed(8), electronic.toFixed(8), session.id],
      );
      await posEvent(tx, req, {
        registerId: register.id, sessionId: session.id, type: 'SALE', referenceId: orderId,
        details: { order_number: orderNumber, total: priced.grand_total, tenders: settled.tenders.map((t) => ({ type: t.type, amount: t.applied_amount })), approvals },
      });
      for (const [target, by] of Object.entries(approvals)) {
        const type = target === 'discount' ? 'DISCOUNT_APPROVED' : target.startsWith('stock') ? 'NEGATIVE_STOCK_APPROVED' : 'PRICE_OVERRIDE';
        await posEvent(tx, req, { registerId: register.id, sessionId: session.id, type, referenceId: orderId, details: { approved_by: by, target } });
      }
      if (cashApplied.isPositive()) await posEvent(tx, req, { registerId: register.id, sessionId: session.id, type: 'DRAWER_OPENED', referenceId: orderId, details: { reason: 'SALE' } });
      await audit(req, tx, 'POS_SALE_COMPLETED', 'POS_ORDER', orderId, { order_number: orderNumber, total: priced.grand_total, journal_id: j?.journalId, approvals });
      return { replayed: false, orderId };
    });

    const b = await loadOrderBundle(db, org(req), result.orderId);
    const o = b.order;
    return ok(
      req,
      res,
      {
        id: o.id, order_number: o.order_number, status: o.status, subtotal: f2(o.subtotal), promo_discount: f2(o.promo_discount), discount_amount: f2(o.discount_amount),
        net_amount: f2(o.net_amount), tax_amount: f2(o.tax_amount), total_amount: f2(o.total_amount), cash_rounding: f2(o.cash_rounding),
        amount_due: f2(new Money(o.total_amount).add(o.cash_rounding)), total_tendered: f2(o.total_tendered), change_due: f2(o.change_due),
        payment_method: o.payment_method, customer_id: o.customer_id, loyalty_points_earned: o.loyalty_points_earned,
        applied_promotions: typeof o.applied_promotions === 'string' ? JSON.parse(o.applied_promotions) : o.applied_promotions,
        journal_id: o.journal_id, lines: b.lines, tenders: b.tenders, receipt: renderReceipt(o, b.lines, b.tenders, b.register), replayed: result.replayed,
      },
      result.replayed ? 200 : 201,
    );
  });

  // ------------------------------------------------------------------ order reads, receipts
  app.get('/api/pos/orders', authenticate, terminal, async (req: Request, res: Response) => {
    const params: any[] = [org(req)];
    let where = 'o.organization_id = $1';
    if (req.query.session_id) {
      params.push(String(req.query.session_id));
      where += ` AND o.session_id::text = $${params.length}`;
    }
    if (req.query.q) {
      params.push(`%${String(req.query.q).slice(0, 64)}%`);
      where += ` AND (o.order_number ILIKE $${params.length} OR p.name ILIKE $${params.length})`;
    }
    const r = await db.query(
      `SELECT o.id, o.order_number, o.status, o.total_amount::text, o.refunded_amount::text, o.payment_method, o.created_at, o.business_date,
         p.name AS customer_name, s.cashier_name
       FROM pos_orders o JOIN pos_sessions s ON s.id = o.session_id LEFT JOIN parties p ON p.id = o.customer_id
       WHERE ${where} ORDER BY o.created_at DESC LIMIT 50`,
      params,
    );
    return ok(req, res, r.rows);
  });

  const resolveOrderId = async (req: Request): Promise<string> => {
    const key = String(req.params.id);
    if (/^[0-9a-f-]{36}$/i.test(key)) return key;
    const r = await db.query(`SELECT id FROM pos_orders WHERE organization_id = $1 AND order_number = $2`, [org(req), key.slice(0, 64)]);
    if (r.rows.length === 0) throw notFound('POS order');
    return r.rows[0].id;
  };

  app.get('/api/pos/orders/:id', authenticate, terminal, async (req: Request, res: Response) => {
    const b = await loadOrderBundle(db, org(req), await resolveOrderId(req));
    const returns = await db.query(`SELECT * FROM pos_returns WHERE original_order_id = $1 ORDER BY created_at`, [b.order.id]);
    return ok(req, res, { ...b.order, lines: b.lines, tenders: b.tenders, returns: returns.rows });
  });

  app.get('/api/pos/orders/:id/receipt', authenticate, terminal, async (req: Request, res: Response) => {
    const b = await loadOrderBundle(db, org(req), await resolveOrderId(req));
    return ok(req, res, renderReceipt(b.order, b.lines, b.tenders, b.register));
  });

  app.post('/api/pos/orders/:id/reprint', authenticate, terminal, async (req: Request, res: Response) => {
    const id = await resolveOrderId(req);
    const out = await db.transaction(async (tx) => {
      const b = await loadOrderBundle(tx, org(req), id);
      const upd = await tx.query(`UPDATE pos_orders SET reprint_count = reprint_count + 1 WHERE id = $1 RETURNING reprint_count`, [b.order.id]);
      await posEvent(tx, req, { registerId: b.register?.id, sessionId: b.order.session_id, type: 'RECEIPT_REPRINT', referenceId: b.order.id, details: { count: upd.rows[0].reprint_count } });
      return { reprint_count: upd.rows[0].reprint_count, ...renderReceipt(b.order, b.lines, b.tenders, b.register, { reprint: true }) };
    });
    return ok(req, res, out);
  });

  // ------------------------------------------------------------------ void (after payment, same open shift)
  app.post('/api/pos/orders/:id/void', authenticate, terminal, async (req: Request, res: Response) => {
    const reason = str(req.body.reason, 'reason', { max: 500 });
    const id = await resolveOrderId(req);
    const out = await db.transaction(async (tx) => {
      const order = await requireOrgRow(tx, 'pos_orders', id, org(req), 'POS order', { forUpdate: true });
      const { session, register, businessDate } = await loadSession(tx, req, order.session_id, { forUpdate: true });
      if (order.status !== 'COMPLETED' || !new Money(order.refunded_amount).isZero()) {
        throw invalidState(`Order ${order.order_number} cannot be voided from ${order.status}; process a return instead`);
      }
      const approver = await requireApproval(tx, req, 'VOID_ORDER', session.id, req.body.approval_id, order.id);
      const lines = (await tx.query(`SELECT ol.*, i.item_type FROM pos_order_lines ol JOIN items i ON i.id = ol.item_id WHERE ol.order_id = $1`, [order.id])).rows;
      const tenders = (await tx.query(`SELECT * FROM pos_tenders WHERE order_id = $1`, [order.id])).rows;
      const wh = await stockWarehouse(tx, org(req), register);
      await lockItems(tx, org(req), lines.map((l: any) => l.item_id));
      for (const l of lines) {
        if (l.item_type !== 'INVENTORY') continue;
        await postStockMovement(tx, {
          organizationId: org(req), legalEntityId: req.session!.legal_entity_id, itemId: l.item_id, warehouseId: wh, movementType: 'POS_RETURN',
          movementDate: businessDate, quantity: new Money(l.quantity).toFixed(8), unitCost: l.unit_cost, referenceType: 'POS_VOID', referenceId: order.id,
          description: `Void ${order.order_number}`,
        });
      }
      for (const t of tenders) {
        if (t.tender_type === 'GIFT_CARD' || t.tender_type === 'STORE_CREDIT') {
          const acct = await lockStoredValue(tx, org(req), t.tender_type, t.reference);
          await storedValueMove(tx, req, acct, new Money(t.applied_amount), 'POS_VOID', order.id);
        }
        if (t.tender_type === 'LOYALTY') await loyaltyMove(tx, org(req), order.customer_id, pointsForAmount(t.applied_amount), 'POS_VOID', order.id);
      }
      if (order.customer_id && order.loyalty_points_earned > 0) {
        const bal = await tx.query(`SELECT points_balance FROM pos_loyalty_accounts WHERE organization_id = $1 AND customer_id = $2`, [org(req), order.customer_id]);
        if ((bal.rows[0]?.points_balance ?? 0) < order.loyalty_points_earned) throw invalidState('Points earned on this sale were already redeemed; process a return instead');
        await loyaltyMove(tx, org(req), order.customer_id, -order.loyalty_points_earned, 'POS_VOID', order.id);
      }
      // Reverse the sale journal line-for-line (posted facts stay immutable).
      let voidJournalId: string | null = null;
      if (order.journal_id) {
        const orig = await tx.query(`SELECT account_id, base_debit::text AS dr, base_credit::text AS cr, description FROM journal_lines WHERE journal_id = $1 ORDER BY line_number`, [order.journal_id]);
        const rev = await postJournal(tx, auditLogger, outboxService, {
          organizationId: org(req), legalEntityId: req.session!.legal_entity_id, userId: req.session!.user_id, postingDate: businessDate,
          purpose: AccountingPurpose.POS_SALE, description: `Void ${order.order_number}: ${reason}`, sourceType: 'POS_ORDER_VOID', sourceId: order.id,
          sourceKey: `POS_VOID:${order.id}`, numberPrefix: 'JV-POS', reversalOfJournalId: order.journal_id, approvedBy: approver, correlationId: req.correlationId,
          lines: orig.rows.map((l: any) =>
            new Money(l.dr).isPositive()
              ? { account_id: l.account_id, credit: l.dr, description: `VOID ${l.description || ''}` }
              : { account_id: l.account_id, debit: l.cr, description: `VOID ${l.description || ''}` },
          ),
        });
        voidJournalId = rev?.journalId || null;
        if (voidJournalId) await tx.query(`UPDATE journals SET status = 'REVERSED', reversed_by_journal_id = $1 WHERE id = $2 AND status = 'POSTED'`, [voidJournalId, order.journal_id]);
      }
      const sum = (types: string[]) => tenders.filter((t: any) => types.includes(t.tender_type)).reduce((s: Money, t: any) => s.add(t.applied_amount), Money.zero());
      const cash = sum(['CASH']);
      const elec = sum(['CARD', 'WALLET']);
      await tx.query(
        `UPDATE pos_sessions SET cash_sales_total = cash_sales_total - $1, expected_cash_drawer = expected_cash_drawer - $1, card_sales_total = card_sales_total - $2 WHERE id = $3`,
        [cash.toFixed(8), elec.toFixed(8), session.id],
      );
      await transition(tx, {
        table: 'pos_orders', id: order.id, organizationId: org(req), from: ['COMPLETED'], to: 'VOIDED', label: 'POS order',
        set: { voided_by: req.session!.user_id, voided_at: new Date().toISOString(), void_reason: reason, void_journal_id: voidJournalId },
      });
      await posEvent(tx, req, { registerId: register.id, sessionId: session.id, type: 'ORDER_VOIDED', referenceId: order.id, details: { reason, approved_by: approver, cash_returned: cash.toFixed(2) } });
      if (cash.isPositive()) await posEvent(tx, req, { registerId: register.id, sessionId: session.id, type: 'DRAWER_OPENED', referenceId: order.id, details: { reason: 'VOID' } });
      await audit(req, tx, 'POS_ORDER_VOIDED', 'POS_ORDER', order.id, { reason, void_journal_id: voidJournalId, approved_by: approver }, { status: order.status });
      return { id: order.id, status: 'VOIDED', void_journal_id: voidJournalId, cash_to_return: cash.toFixed(2), electronic_to_reverse: elec.toFixed(2), approved_by: approver };
    });
    return ok(req, res, out);
  });

  // ------------------------------------------------------------------ returns / exchanges
  app.post('/api/pos/returns', authenticate, terminal, async (req: Request, res: Response) => {
    const reason = str(req.body.reason, 'reason', { max: 500 });
    const restock = bool(req.body.restock, true);
    const refundTo = oneOf(req.body.refund_to, 'refund_to', ['ORIGINAL', 'STORE_CREDIT', 'CASH'] as const, 'ORIGINAL');
    const rawLines = arrayOf<any>(req.body.lines, 'lines', { min: 1, max: 200 });
    const out = await db.transaction(async (tx) => {
      const { session, register, businessDate } = await loadSession(tx, req, req.body.session_id, { forUpdate: true });
      const orgId = org(req);
      const returnId = crypto.randomUUID();
      let original: any = null;
      if (present(req.body.original_order_id) || present(req.body.order_number)) {
        const r = await tx.query(`SELECT * FROM pos_orders WHERE organization_id = $1 AND (id::text = $2 OR order_number = $3) FOR UPDATE`, [
          orgId,
          String(req.body.original_order_id || ''),
          String(req.body.order_number || ''),
        ]);
        if (r.rows.length === 0) throw notFound('Original POS order');
        original = r.rows[0];
        if (original.status === 'VOIDED' || original.status === 'REFUNDED') throw new ApiError(422, ErrorCode.RETURN_NOT_ALLOWED, `Order ${original.order_number} is ${original.status}`);
      }
      const withReceipt = !!original;
      // Receipted returns are within cashier authority; no-receipt returns need a manager.
      let approver: string | null = null;
      if (!withReceipt) approver = await requireApproval(tx, req, 'RETURN_NO_RECEIPT', session.id, req.body.approval_id, returnId);
      else if (present(req.body.approval_id)) approver = await requireApproval(tx, req, 'RETURN', session.id, req.body.approval_id, returnId);
      if (!withReceipt && refundTo === 'ORIGINAL') throw validationError('Returns without a receipt refund to STORE_CREDIT or CASH', { field: 'refund_to' });
      const customerId: string | null = original?.customer_id || (present(req.body.customer_id) ? String(req.body.customer_id) : null);
      if (customerId && !original) await assertOrgRef(tx, 'parties', customerId, orgId, 'customer_id');

      type RL = { original_line_id: string | null; item_id: string; quantity: string; net: string; tax: string; unit_cost: string; item_type: string; code: string };
      const rls: RL[] = [];
      if (withReceipt) {
        for (const [i, l] of rawLines.entries()) {
          const lid = uuid(l.original_line_id, `lines[${i}].original_line_id`);
          const q = decimal(l.quantity, `lines[${i}].quantity`, { sign: 'positive', scale: 3 });
          const ol = (await tx.query(`SELECT ol.*, i.item_type FROM pos_order_lines ol JOIN items i ON i.id = ol.item_id WHERE ol.id::text = $1 AND ol.order_id = $2 FOR UPDATE OF ol`, [lid, original.id])).rows[0];
          if (!ol) throw validationError(`Line ${lid} is not on order ${original.order_number}`, { field: `lines[${i}].original_line_id` });
          const refund = engine(() =>
            computeLineRefund({ line_id: ol.id, quantity: ol.quantity, net_amount: ol.net_amount, tax_amount: ol.tax_amount, returned_quantity: ol.returned_quantity, refunded_net: ol.refunded_net, refunded_tax: ol.refunded_tax }, q),
          );
          await tx.query(`UPDATE pos_order_lines SET returned_quantity = returned_quantity + $1, refunded_net = refunded_net + $2, refunded_tax = refunded_tax + $3 WHERE id = $4`, [q, refund.net, refund.tax, ol.id]);
          rls.push({ original_line_id: ol.id, item_id: ol.item_id, quantity: q, net: refund.net, tax: refund.tax, unit_cost: ol.unit_cost, item_type: ol.item_type, code: ol.item_code });
        }
      } else {
        const ids = rawLines.map((l, i) => uuid(l.item_id, `lines[${i}].item_id`));
        const itemMap = await lockItems(tx, orgId, ids);
        for (const [i, l] of rawLines.entries()) {
          const it = itemMap.get(ids[i]);
          const q = decimal(l.quantity, `lines[${i}].quantity`, { sign: 'positive', scale: 3 });
          // Without a receipt the refund is at the current shelf price (never above it).
          const shelf = new Money(it.unit_price);
          const price = present(l.unit_price) ? Money.min(decimal(l.unit_price, `lines[${i}].unit_price`, { sign: 'nonNegative' }), shelf) : shelf;
          const net = new Money(q).mul(price).round(2);
          const tax = net.mul(it.tax_rate || '0').div(100).round(2);
          rls.push({ original_line_id: null, item_id: it.id, quantity: q, net: net.toFixed(2), tax: tax.toFixed(2), unit_cost: it.unit_cost, item_type: it.item_type, code: it.code });
        }
      }
      const netT = rls.reduce((s, l) => s.add(l.net), Money.zero());
      const taxT = rls.reduce((s, l) => s.add(l.tax), Money.zero());
      const total = netT.add(taxT);
      if (!total.isPositive()) throw validationError('Nothing to refund');

      // Refund routing: back to the original tenders by default.
      let refunds: { type: TenderType; amount: string; reference?: string | null; tender_id?: string }[];
      if (withReceipt && refundTo === 'ORIGINAL') {
        const ot = (await tx.query(`SELECT * FROM pos_tenders WHERE order_id = $1 FOR UPDATE`, [original.id])).rows;
        refunds = engine(() =>
          allocateRefundToTenders(total.toFixed(2), ot.map((t: any) => ({ tender_id: t.id, type: t.tender_type, applied_amount: t.applied_amount, refunded_amount: t.refunded_amount, reference: t.reference }))),
        );
        for (const r of refunds) await tx.query(`UPDATE pos_tenders SET refunded_amount = refunded_amount + $1 WHERE id = $2`, [r.amount, r.tender_id]);
      } else if (refundTo === 'CASH') {
        if (!withReceipt && !approver) throw new ApiError(403, ErrorCode.APPROVAL_REQUIRED, 'Cash refunds without a receipt need a manager');
        refunds = [{ type: 'CASH', amount: total.toFixed(2) }];
      } else {
        refunds = [{ type: 'STORE_CREDIT', amount: total.toFixed(2) }];
      }
      let storeCreditCode: string | null = null;
      for (const r of refunds) {
        if (r.type === 'GIFT_CARD' || r.type === 'STORE_CREDIT') {
          let acct: any;
          if (r.reference) acct = await lockStoredValue(tx, orgId, r.type, r.reference);
          else {
            const code = newCode('SC');
            const sid = crypto.randomUUID();
            await tx.query(`INSERT INTO pos_stored_value_accounts (id, organization_id, kind, code, customer_id, balance) VALUES ($1,$2,'STORE_CREDIT',$3,$4,0)`, [sid, orgId, code, customerId]);
            acct = { id: sid, kind: 'STORE_CREDIT', code };
            r.reference = code;
          }
          if (r.type === 'STORE_CREDIT') storeCreditCode = acct.code;
          await storedValueMove(tx, req, acct, new Money(r.amount), 'POS_RETURN', returnId);
        }
        if (r.type === 'LOYALTY' && customerId) await loyaltyMove(tx, orgId, customerId, pointsForAmount(r.amount), 'POS_RETURN', returnId);
      }
      // Claw back points earned on the refunded portion (bounded by the current balance).
      let clawback = 0;
      if (original?.customer_id && original.loyalty_points_earned > 0 && new Money(original.net_amount).isPositive()) {
        clawback = Math.min(original.loyalty_points_earned, new Money(original.loyalty_points_earned).mul(netT).div(original.net_amount).floor(0).toDecimal().toNumber());
        const bal = (await tx.query(`SELECT points_balance FROM pos_loyalty_accounts WHERE organization_id = $1 AND customer_id = $2`, [orgId, original.customer_id])).rows[0]?.points_balance ?? 0;
        clawback = Math.min(clawback, bal);
        if (clawback > 0) await loyaltyMove(tx, orgId, original.customer_id, -clawback, 'POS_RETURN_CLAWBACK', returnId);
      }

      const wh = await stockWarehouse(tx, orgId, register);
      const number = await nextDocumentNumber(tx, orgId, `RTN-${register.register_code}`, businessDate, 6);
      const desc = `POS return ${number}${original ? ' of ' + original.order_number : ' (no receipt)'}`;
      const jl: PostingIntentLine[] = [{ account_code: '411004', debit: netT.toFixed(8), description: `${desc} sales returns` }];
      if (taxT.isPositive()) jl.push({ account_code: '212001', debit: taxT.toFixed(8), description: `${desc} output tax reversed` });
      const refundByType: Record<string, Money> = {};
      for (const r of refunds) refundByType[r.type] = (refundByType[r.type] || Money.zero()).add(r.amount);
      for (const [type, amt] of Object.entries(refundByType)) jl.push({ account_code: TENDER_ACCOUNT[type as TenderType], credit: amt.toFixed(8), description: `${desc} refund ${type}` });
      if (clawback > 0) {
        const v = new Money(redemptionValue(clawback)).toFixed(8);
        jl.push({ account_code: '211008', debit: v, description: `${desc} loyalty clawback` });
        jl.push({ account_code: '411004', credit: v, description: `${desc} loyalty clawback` });
      }
      await tx.query(
        `INSERT INTO pos_returns (id, organization_id, return_number, session_id, original_order_id, customer_id, with_receipt, net_amount, tax_amount, total_amount,
           refund_tenders, reason, restock, approval_id, journal_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [returnId, orgId, number, session.id, original?.id || null, customerId, withReceipt, netT.toFixed(8), taxT.toFixed(8), total.toFixed(8), JSON.stringify(refunds),
          reason, restock, present(req.body.approval_id) ? req.body.approval_id : null, null, req.session!.user_id],
      );
      for (const l of rls) {
        await tx.query(`INSERT INTO pos_return_lines (return_id, original_line_id, item_id, quantity, net_amount, tax_amount, unit_cost) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [
          returnId, l.original_line_id, l.item_id, l.quantity, l.net, l.tax, l.unit_cost,
        ]);
        if (restock && l.item_type === 'INVENTORY') {
          await postStockMovement(tx, {
            organizationId: orgId, legalEntityId: req.session!.legal_entity_id, itemId: l.item_id, warehouseId: wh, movementType: 'POS_RETURN', movementDate: businessDate,
            quantity: new Money(l.quantity).toFixed(8), unitCost: l.unit_cost, referenceType: 'POS_RETURN', referenceId: returnId, description: desc,
          });
          const cost = new Money(l.quantity).mul(l.unit_cost).round(2);
          if (cost.isPositive()) {
            jl.push({ account_code: '113001', debit: cost.toFixed(8), description: `${desc} restock ${l.code}` });
            jl.push({ account_code: '511001', credit: cost.toFixed(8), description: `${desc} COGS reversal ${l.code}` });
          }
        }
      }
      const j = await postJournal(tx, auditLogger, outboxService, {
        organizationId: orgId, legalEntityId: req.session!.legal_entity_id, userId: req.session!.user_id, postingDate: businessDate,
        purpose: AccountingPurpose.POS_RETURN, description: desc, sourceType: 'POS_RETURN', sourceId: returnId, sourceKey: `POS_RETURN:${returnId}`,
        numberPrefix: 'JV-POS', lines: jl, approvedBy: approver, correlationId: req.correlationId,
      });
      await tx.query(`UPDATE pos_returns SET journal_id = $1 WHERE id = $2`, [j?.journalId || null, returnId]);
      if (original) {
        await tx.query(`UPDATE pos_orders SET refunded_amount = refunded_amount + $1 WHERE id = $2`, [total.toFixed(8), original.id]);
        const left = (await tx.query(`SELECT COALESCE(SUM(quantity - returned_quantity),0)::text AS left FROM pos_order_lines WHERE order_id = $1`, [original.id])).rows[0].left;
        await tx.query(`UPDATE pos_orders SET status = $1 WHERE id = $2`, [new Money(left).isZero() ? 'REFUNDED' : 'PARTIALLY_REFUNDED', original.id]);
      }
      const cashOut = refundByType.CASH || Money.zero();
      if (cashOut.isPositive()) {
        if (cashOut.gt(drawerOf(session))) throw validationError(`Drawer only holds ${new Money(drawerOf(session)).format()}; refund to store credit instead`);
        await tx.query(`UPDATE pos_sessions SET cash_refunds_total = cash_refunds_total + $1, expected_cash_drawer = expected_cash_drawer - $1 WHERE id = $2`, [cashOut.toFixed(8), session.id]);
        await posEvent(tx, req, { registerId: register.id, sessionId: session.id, type: 'DRAWER_OPENED', referenceId: returnId, details: { reason: 'REFUND' } });
      }
      const elecOut = (refundByType.CARD || Money.zero()).add(refundByType.WALLET || Money.zero());
      if (elecOut.isPositive()) await tx.query(`UPDATE pos_sessions SET card_sales_total = card_sales_total - $1 WHERE id = $2`, [elecOut.toFixed(8), session.id]);
      await posEvent(tx, req, { registerId: register.id, sessionId: session.id, type: withReceipt ? 'RETURN' : 'RETURN_NO_RECEIPT', referenceId: returnId, details: { number, total: total.toFixed(2), refunds, approved_by: approver } });
      await audit(req, tx, 'POS_RETURN_POSTED', 'POS_RETURN', returnId, { number, total: total.toFixed(2), original: original?.order_number, journal_id: j?.journalId });
      return {
        id: returnId, return_number: number, with_receipt: withReceipt, net_amount: netT.toFixed(2), tax_amount: taxT.toFixed(2), total_amount: total.toFixed(2),
        refunds: refunds.map(({ tender_id: _t, ...r }) => r), store_credit_code: storeCreditCode, journal_id: j?.journalId || null, loyalty_clawback: clawback,
      };
    });
    return ok(req, res, out, 201);
  });

  // ------------------------------------------------------------------ gift cards & stored value
  app.get('/api/pos/stored-value/:code', authenticate, terminal, async (req: Request, res: Response) => {
    const kind = oneOf(req.query.kind, 'kind', ['GIFT_CARD', 'STORE_CREDIT'] as const, 'GIFT_CARD');
    const r = await db.query(`SELECT id, kind, code, balance::text, is_active, customer_id FROM pos_stored_value_accounts WHERE organization_id = $1 AND kind = $2 AND code = $3`, [
      org(req),
      kind,
      String(req.params.code).toUpperCase().slice(0, 64),
    ]);
    if (r.rows.length === 0) throw notFound(kind === 'GIFT_CARD' ? 'Gift card' : 'Store credit');
    return ok(req, res, r.rows[0]);
  });

  app.post('/api/pos/gift-cards', authenticate, terminal, async (req: Request, res: Response) => {
    const amount = decimal(req.body.amount, 'amount', { sign: 'positive' });
    if (new Money(amount).gt('100000')) throw validationError('Gift card value cannot exceed 100,000', { field: 'amount' });
    const tenderType = oneOf(req.body.tender_type, 'tender_type', ['CASH', 'CARD', 'WALLET'] as const, 'CASH');
    const out = await db.transaction(async (tx) => {
      const { session, register, businessDate } = await loadSession(tx, req, req.body.session_id, { forUpdate: true });
      const code = present(req.body.code) ? str(req.body.code, 'code', { max: 32, pattern: /^[A-Z0-9-]{6,32}$/i }).toUpperCase() : newCode('GC');
      if (req.body.customer_id) await assertOrgRef(tx, 'parties', req.body.customer_id, org(req), 'customer_id');
      const id = crypto.randomUUID();
      await tx.query(`INSERT INTO pos_stored_value_accounts (id, organization_id, kind, code, customer_id, balance) VALUES ($1,$2,'GIFT_CARD',$3,$4,0)`, [id, org(req), code, req.body.customer_id || null]);
      await storedValueMove(tx, req, { id, kind: 'GIFT_CARD' }, new Money(amount), 'GIFT_CARD_ISSUE', id);
      const amt = new Money(amount).toFixed(8);
      const j = await postJournal(tx, auditLogger, outboxService, {
        organizationId: org(req), legalEntityId: req.session!.legal_entity_id, userId: req.session!.user_id, postingDate: businessDate,
        purpose: AccountingPurpose.GIFT_CARD_ISSUE, description: `Gift card ${code} issued`, sourceType: 'POS_GIFT_CARD', sourceId: id, sourceKey: `GIFT_CARD_ISSUE:${id}`,
        numberPrefix: 'JV-POS', correlationId: req.correlationId,
        lines: [{ account_code: TENDER_ACCOUNT[tenderType], debit: amt, description: `Gift card ${code} ${tenderType}` }, { account_code: '211007', credit: amt, description: `Gift card ${code} liability` }],
      });
      if (tenderType === 'CASH') await tx.query(`UPDATE pos_sessions SET cash_sales_total = cash_sales_total + $1, expected_cash_drawer = expected_cash_drawer + $1 WHERE id = $2`, [amt, session.id]);
      else await tx.query(`UPDATE pos_sessions SET card_sales_total = card_sales_total + $1 WHERE id = $2`, [amt, session.id]);
      await posEvent(tx, req, { registerId: register.id, sessionId: session.id, type: 'GIFT_CARD_ISSUED', referenceId: id, details: { code, amount, tender_type: tenderType } });
      return { id, code, balance: f2(amount), journal_id: j?.journalId || null };
    });
    return ok(req, res, out, 201);
  });
}
