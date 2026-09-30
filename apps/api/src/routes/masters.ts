import type { Express, Request, Response } from 'express';
import crypto from 'node:crypto';
import { Permission } from '@omnysync/contracts';
import { db, auditLogger, authenticate, requirePermission } from '../context.js';
import { ok } from '../lib/http.js';
import { validationError } from '../lib/errors.js';
import { bool, decimal, oneOf, optionalStr, optionalUuid, str } from '../lib/validate.js';
import { requireOrgRow } from '../lib/scope.js';

const PARTY_TYPES = ['CUSTOMER', 'VENDOR', 'BOTH'] as const;
const ITEM_TYPES = ['INVENTORY', 'SERVICE', 'NON_INVENTORY'] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Account references on masters must be active, org-scoped leaf (level 4) accounts. */
async function leafAccount(org: string, id: string | null, field: string) {
  if (!id) return null;
  const r = await db.query(`SELECT id FROM accounts WHERE id = $1 AND organization_id = $2 AND level = 4 AND is_active = true`, [id, org]);
  if (r.rows.length === 0) throw validationError(`${field} must be an active posting (leaf) account in this organisation`, { field });
  return id;
}

function partyInput(b: any, partial = false) {
  const email = optionalStr(b.email, 'email', 255);
  if (email && !EMAIL_RE.test(email)) throw validationError('email is not valid', { field: 'email' });
  return {
    name: partial && b.name === undefined ? undefined : str(b.name, 'name', { max: 255 }),
    party_type: partial && b.party_type === undefined ? undefined : oneOf(b.party_type, 'party_type', PARTY_TYPES),
    tax_identifier: optionalStr(b.tax_identifier, 'tax_identifier', 64),
    email,
    phone: optionalStr(b.phone, 'phone', 64),
    address: optionalStr(b.address, 'address', 2000),
    credit_limit: decimal(b.credit_limit, 'credit_limit', { required: false, defaultValue: '0', scale: 2 }),
  };
}

export function registerMastersRoutes(app: Express): void {
  // Master data lookups are needed by every operational role, so reads only require
  // an authenticated org member; results are always org-scoped.
  app.get('/api/parties', authenticate, async (req: Request, res: Response) => {
    const params: any[] = [req.session!.organization_id];
    let sql = 'SELECT * FROM parties WHERE organization_id = $1 AND is_active = true';
    if (req.query.type) {
      params.push(oneOf(req.query.type, 'type', PARTY_TYPES));
      sql += ` AND (party_type = $${params.length} OR party_type = 'BOTH')`;
    }
    if (req.query.search) {
      params.push(`%${String(req.query.search).slice(0, 100)}%`);
      sql += ` AND (name ILIKE $${params.length} OR code ILIKE $${params.length} OR COALESCE(phone,'') ILIKE $${params.length})`;
    }
    const r = await db.query(`${sql} ORDER BY name ASC LIMIT 1000`, params);
    return ok(req, res, r.rows, 200, { total_count: r.rows.length });
  });

  app.post('/api/parties', authenticate, requirePermission(Permission.PARTIES_MANAGE), async (req: Request, res: Response) => {
    const b = req.body || {};
    const code = str(b.code, 'code', { max: 64 });
    const p = partyInput(b);
    const id = crypto.randomUUID();
    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO parties (id, organization_id, legal_entity_id, code, name, party_type, tax_identifier, email, phone, address, credit_limit, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true)`,
        [id, req.session!.organization_id, req.session!.legal_entity_id, code, p.name, p.party_type, p.tax_identifier, p.email, p.phone, p.address, p.credit_limit],
      );
      await auditLogger.record(
        { organization_id: req.session!.organization_id, user_id: req.session!.user_id, action: 'PARTY_CREATED', entity_type: 'PARTY', entity_id: id, after_state: { code, name: p.name, party_type: p.party_type, credit_limit: p.credit_limit }, correlation_id: req.correlationId },
        tx,
      );
    });
    return ok(req, res, { id, code, name: p.name, party_type: p.party_type }, 201);
  });

  app.post('/api/parties/:id', authenticate, requirePermission(Permission.PARTIES_MANAGE), async (req: Request, res: Response) => {
    const out = await db.transaction(async (tx) => {
      const before = await requireOrgRow(tx, 'parties', req.params.id, req.session!.organization_id, 'Party', { forUpdate: true });
      const p = partyInput({ ...before, ...req.body });
      const is_active = req.body?.is_active === undefined ? before.is_active : bool(req.body.is_active);
      const r = await tx.query(
        `UPDATE parties SET name = $1, party_type = $2, tax_identifier = $3, email = $4, phone = $5, address = $6, credit_limit = $7, is_active = $8, updated_at = CURRENT_TIMESTAMP
         WHERE id = $9 RETURNING *`,
        [p.name, p.party_type, p.tax_identifier, p.email, p.phone, p.address, p.credit_limit, is_active, before.id],
      );
      await auditLogger.record(
        { organization_id: req.session!.organization_id, user_id: req.session!.user_id, action: 'PARTY_UPDATED', entity_type: 'PARTY', entity_id: before.id, before_state: { name: before.name, credit_limit: before.credit_limit, is_active: before.is_active }, after_state: { name: p.name, credit_limit: p.credit_limit, is_active }, correlation_id: req.correlationId },
        tx,
      );
      return r.rows[0];
    });
    return ok(req, res, out);
  });

  app.get('/api/items', authenticate, async (req: Request, res: Response) => {
    const params: any[] = [req.session!.organization_id];
    let where = 'i.organization_id = $1 AND i.is_active = true';
    if (req.query.search) {
      params.push(`%${String(req.query.search).slice(0, 100)}%`);
      where += ` AND (i.name ILIKE $${params.length} OR i.code ILIKE $${params.length} OR COALESCE(i.barcode,'') ILIKE $${params.length})`;
    }
    const r = await db.query(
      `SELECT i.*, COALESCE((SELECT SUM(quantity) FROM stock_movements sm WHERE sm.item_id = i.id), 0) as on_hand_qty
       FROM items i WHERE ${where} ORDER BY i.name ASC LIMIT 2000`,
      params,
    );
    return ok(req, res, r.rows, 200, { total_count: r.rows.length });
  });

  app.post('/api/items', authenticate, requirePermission(Permission.ITEMS_MANAGE), async (req: Request, res: Response) => {
    const b = req.body || {};
    const org = req.session!.organization_id;
    const code = str(b.code, 'code', { max: 64 });
    const name = str(b.name, 'name', { max: 255 });
    const item_type = oneOf(b.item_type, 'item_type', ITEM_TYPES, 'INVENTORY');
    const uom = optionalStr(b.uom, 'uom', 32) || 'UNIT';
    const unit_price = decimal(b.unit_price, 'unit_price', { required: false, defaultValue: '0' });
    const unit_cost = decimal(b.unit_cost, 'unit_cost', { required: false, defaultValue: '0' });
    const sales_account_id = await leafAccount(org, optionalUuid(b.sales_account_id, 'sales_account_id'), 'sales_account_id');
    const cogs_account_id = await leafAccount(org, optionalUuid(b.cogs_account_id, 'cogs_account_id'), 'cogs_account_id');
    const inventory_account_id = await leafAccount(org, optionalUuid(b.inventory_account_id, 'inventory_account_id'), 'inventory_account_id');
    const barcode = optionalStr(b.barcode, 'barcode', 64);
    const tax_rate = decimal(b.tax_rate, 'tax_rate', { required: false, defaultValue: '0', scale: 4 });
    const is_weighed = bool(b.is_weighed, false);
    const reorder_point = decimal(b.reorder_point, 'reorder_point', { required: false, defaultValue: '0' });
    const reorder_qty = decimal(b.reorder_qty, 'reorder_qty', { required: false, defaultValue: '0' });
    const id = crypto.randomUUID();
    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO items (id, organization_id, legal_entity_id, code, name, item_type, uom, unit_price, unit_cost,
           sales_account_id, cogs_account_id, inventory_account_id, is_active, barcode, tax_rate, is_weighed, reorder_point, reorder_qty)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true, $13, $14, $15, $16, $17)`,
        [id, org, req.session!.legal_entity_id, code, name, item_type, uom, unit_price, unit_cost, sales_account_id, cogs_account_id, inventory_account_id, barcode, tax_rate, is_weighed, reorder_point, reorder_qty],
      );
      await auditLogger.record(
        { organization_id: org, user_id: req.session!.user_id, action: 'ITEM_CREATED', entity_type: 'ITEM', entity_id: id, after_state: { code, name, item_type, unit_price, unit_cost }, correlation_id: req.correlationId },
        tx,
      );
    });
    return ok(req, res, { id, code, name }, 201);
  });

  app.post('/api/items/:id', authenticate, requirePermission(Permission.ITEMS_MANAGE), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const out = await db.transaction(async (tx) => {
      const before = await requireOrgRow(tx, 'items', req.params.id, org, 'Item', { forUpdate: true });
      const b = { ...before, ...req.body };
      const name = str(b.name, 'name', { max: 255 });
      const unit_price = decimal(String(b.unit_price), 'unit_price');
      const unit_cost = decimal(String(b.unit_cost), 'unit_cost');
      const barcode = optionalStr(b.barcode, 'barcode', 64);
      const tax_rate = decimal(String(b.tax_rate ?? '0'), 'tax_rate', { scale: 4 });
      const reorder_point = decimal(String(b.reorder_point ?? '0'), 'reorder_point');
      const reorder_qty = decimal(String(b.reorder_qty ?? '0'), 'reorder_qty');
      const is_weighed = bool(b.is_weighed, false);
      const is_active = bool(b.is_active, true);
      const r = await tx.query(
        `UPDATE items SET name = $1, unit_price = $2, unit_cost = $3, barcode = $4, tax_rate = $5, reorder_point = $6, reorder_qty = $7,
           is_weighed = $8, is_active = $9, updated_at = CURRENT_TIMESTAMP WHERE id = $10 RETURNING *`,
        [name, unit_price, unit_cost, barcode, tax_rate, reorder_point, reorder_qty, is_weighed, is_active, before.id],
      );
      await auditLogger.record(
        { organization_id: org, user_id: req.session!.user_id, action: 'ITEM_UPDATED', entity_type: 'ITEM', entity_id: before.id, before_state: { unit_price: before.unit_price, unit_cost: before.unit_cost, is_active: before.is_active }, after_state: { unit_price, unit_cost, is_active }, correlation_id: req.correlationId },
        tx,
      );
      return r.rows[0];
    });
    return ok(req, res, out);
  });
}
